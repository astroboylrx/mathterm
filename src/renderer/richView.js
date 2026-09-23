const { getActivePane, isActivePane, updateStatusBar } = require('./state');
const { settings, isMac } = require('./settings');
const { parseShortcut, formatShortcut } = require('./keybindings');
const { hasLatex } = require('./latex');
const { stripAnsi } = require('./ansi');
const { bufferLineToSemanticText, collectLogicalBufferLines } = require('./bufferText');
const { isPromptLine } = require('./promptTrack');
const { refreshTabTitle } = require('./titleTrack');
const { isTableBorder, tryParseTableBlock, tryParseMarkdownTable } = require('./tableRender');
const { renderMarkdownBlock, renderMarkdownFile } = require('./markdown');
const { prioritizeKatexQueue, drainKatexQueue } = require('./richKatexQueue');
const { renderRichLine, isBoxRule } = require('./richLineRender');
const {
  createRichTerminalSnapshot,
  disposeRichTerminalSnapshot
} = require('./richSnapshot');
const {
  RICH_VIRTUAL_OVERSCAN_ROWS,
  RICH_VIRTUAL_MAX_RENDERED_ROWS,
  RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS,
  RICH_VIRTUAL_HEIGHT_SMOOTHING,
  RICH_VIRTUAL_DEFAULT_LINE_HEIGHT,
  RICH_VIRTUAL_EXPORT_MAX_ROWS,
  clampRowRange,
  scrollTopToRow,
  computeSpacerHeights,
  applyHeightSmoothing,
  coerceRenderToken,
  computeDisplayMathSpans,
  computeFencedCodeSpans,
  expandRangeForDisplayMathSpans,
  expandStartForStructure,
  expandEndForWrappedLine
} = require('./richVirtual');
const { tryParseDisplayMath, renderModelDisplayBlock, tryParseFencedCodeBlock, tagSpan } = require('./richBlockParse');
const { computeModelDisplayMathSpans, modelBlocksForLines } = require('./displayMathBlocks');
const { saveMathCapture, buildMathCapture } = require('./mathCapture');
const DISPLAY_MATH_MODEL_FORMAT = require('./displayMathModel.json').format;

// 'model' (default) uses the trained detector in displayMathModel.js; 'rules'
// keeps the older delimiter-pairing parser.
function useModelDetection() {
  return settings.mathBlockDetection !== 'rules';
}

const SECTION_BUFFER_MAX = 256 * 1024;
const SECTION_ELAPSED_MAX = 30000;
const SECTION_LATEX_SCAN_OVERLAP = 32;

function collectBufferLines(buf, startY, endY) {
  return collectLogicalBufferLines(buf, startY, endY);
}

function richSourceBuffer(pane) {
  return pane?.richVirtual?.sourceBuffer || pane?.term?.buffer?.active || null;
}

function richPromptLineChecker(pane) {
  const promptYSet = pane?.richVirtual?.promptYSet;
  return promptYSet instanceof Set
    ? (_tab, _text, y) => promptYSet.has(y)
    : isPromptLine;
}

function disposeRichSnapshotSource(pane) {
  if (!pane) return;
  pane._richSnapshotGeneration = (pane._richSnapshotGeneration | 0) + 1;
  pane._richSnapshotPending = false;
  pane._richSnapshotPromise = null;
  if (pane.richSnapshot) disposeRichTerminalSnapshot(pane.richSnapshot);
  pane.richSnapshot = null;
}

// Display-math blocks for this list, keyed by the index of their first line:
// taken from the whole-source detection the virtual view already ran (keyed by
// buffer row), or detected here for a list rendered on its own.
function modelBlocksForRender(textLines, promptLineChecker, tab, opts) {
  const byIndex = new Map();
  if (opts && opts.displayMathBlocks) {
    for (let i = 0; i < textLines.length; i++) {
      const item = textLines[i];
      const block = typeof item === 'object' && item.y !== undefined ? opts.displayMathBlocks.get(item.y) : null;
      if (!block) continue;
      let end = i;
      while (end + 1 < textLines.length && textLines[end + 1].y !== undefined
        && textLines[end + 1].y <= block.endY) end++;
      byIndex.set(i, { end, block });
    }
    return byIndex;
  }
  const isPromptIdx = idx => {
    const item = textLines[idx];
    return !!(promptLineChecker && typeof item === 'object' && item.y !== undefined
      && promptLineChecker(tab, item.text || '', item.y));
  };
  for (const block of modelBlocksForLines(textLines, isPromptIdx)) {
    byIndex.set(block.start, { end: block.end, block });
  }
  return byIndex;
}

function renderLinesToContainer(textLines, container, promptLineChecker, tab, opts) {
  let i = 0;
  let foundContent = false;
  const modelBlocks = useModelDetection()
    ? modelBlocksForRender(textLines, promptLineChecker, tab, opts)
    : null;

  while (i < textLines.length) {
    const item = textLines[i];
    const text = typeof item === 'string' ? item : (item.text || '');

    // Checked before the blank-line skip: a block the view entered part-way
    // can start on a blank line inside it.
    const modelBlock = modelBlocks && modelBlocks.get(i);
    if (modelBlock) {
      foundContent = true;
      const result = renderModelDisplayBlock(textLines, i, modelBlock.end, modelBlock.block, opts);
      if (result.prefix) container.appendChild(renderRichLine(item, result.prefix, false, opts));
      container.appendChild(result.element);
      if (result.suffix) {
        container.appendChild(renderRichLine(textLines[modelBlock.end], result.suffix, false, opts));
      }
      i = result.endIdx;
      continue;
    }

    if (!text.trim()) { i++; continue; }

    foundContent = true;

    const codeResult = tryParseFencedCodeBlock(textLines, i, opts);
    if (codeResult) {
      container.appendChild(codeResult.element);
      i = codeResult.endIdx;
      continue;
    }

    const tableResult = tryParseTableBlock(textLines, i)
      || tryParseMarkdownTable(textLines, i);
    if (tableResult) {
      tagSpan(tableResult.element, textLines, i, tableResult.endIdx - 1);
      container.appendChild(tableResult.element);
      i = tableResult.endIdx;
      continue;
    }

    const mathResult = modelBlocks ? null : tryParseDisplayMath(textLines, i, opts, tab, promptLineChecker);
    if (mathResult) {
      container.appendChild(mathResult.element);
      i = mathResult.endIdx;
      continue;
    }

    const isPrompt = typeof item === 'object' && item.y !== undefined
      && promptLineChecker && promptLineChecker(tab, text, item.y);

    container.appendChild(renderRichLine(item, text, isPrompt, opts));

    // If the next non-empty line is a box-rule, merge it into this line as an
    // underline (Setext-style heading). Skips the rule's own div so the line
    // sits flush under the heading text instead of as a separate divider.
    const next = textLines[i + 1];
    if (next) {
      const nextText = typeof next === 'string' ? next : (next.text || '');
      if (isBoxRule(nextText) && !isBoxRule(text)) {
        const lastEl = container.lastElementChild;
        if (lastEl && !lastEl.classList.contains('rule')) {
          lastEl.style.borderBottom = '1px solid var(--border)';
          lastEl.style.width = 'fit-content';
          lastEl.style.maxWidth = '100%';
          i += 2;
          continue;
        }
      }
    }
    i++;
  }
  return foundContent;
}

function insertImagesIntoContainer(container, tab, startY, endY) {
  const images = tab?.richVirtual?.sourceImages || tab?.inlineImages;
  if (!images || images.length === 0) return;
  const relevant = images
    .map((img, index) => ({ img, index }))
    .filter(item => item.img.lineY >= startY && item.img.lineY <= endY)
    .sort((a, b) => a.img.lineY - b.img.lineY || a.index - b.index);
  if (relevant.length === 0) return;
  const lineEls = Array.from(container.querySelectorAll('.rline'));
  const lineYs = lineEls.map(lineEl => parseInt(lineEl.dataset.y));
  let lineIndex = 0;
  for (const { img } of relevant) {
    const wrap = document.createElement('div');
    wrap.className = 'inline-image';
    wrap.dataset.y = img.lineY;
    wrap.dataset.yEnd = img.lineY;
    const imgTag = document.createElement('img');
    imgTag.addEventListener('load', () => {
      requestAnimationFrame(() => refreshRichViewAfterLayout(tab));
    }, { once: true });
    imgTag.src = img.dataUrl;
    imgTag.alt = img.params.name || 'image';
    if (img.params.width) imgTag.style.width = img.params.width;
    if (img.params.height) imgTag.style.height = img.params.height;
    if (img.params.preserveAspectRatio === '1') imgTag.style.objectFit = 'contain';
    wrap.appendChild(imgTag);
    while (lineIndex < lineEls.length && (!Number.isFinite(lineYs[lineIndex]) || lineYs[lineIndex] <= img.lineY)) {
      lineIndex++;
    }
    const before = lineEls[lineIndex] || null;
    if (before) container.insertBefore(wrap, before);
    else container.appendChild(wrap);
  }
}

function getRichEstimatedLineHeight(pane) {
  try {
    const styles = getComputedStyle(pane.richView);
    const parsed = parseFloat(styles.lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fontSize = parseFloat(styles.fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.5;
  } catch {}
  return RICH_VIRTUAL_DEFAULT_LINE_HEIGHT;
}

function findFirstVisibleAnchor(pane) {
  const v = pane.richVirtual;
  if (!v) return null;
  const rv = pane.richView;
  const scrollTop = rv.scrollTop;
  const viewBottom = scrollTop + rv.clientHeight;
  const children = v.windowEl ? v.windowEl.children : [];
  for (const el of children) {
    if (!(el instanceof HTMLElement)) continue;
    const y = parseInt(el.dataset.y);
    if (Number.isNaN(y)) continue;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    if (elBottom > scrollTop && elTop < viewBottom) {
      return { y, offsetWithinViewport: elTop - scrollTop };
    }
  }
  return null;
}

function findElementForY(windowEl, y) {
  for (const el of windowEl.children) {
    if (!(el instanceof HTMLElement)) continue;
    const yStart = parseInt(el.dataset.y);
    const yEnd = parseInt(el.dataset.yEnd || el.dataset.y);
    if (Number.isNaN(yStart)) continue;
    if (y >= yStart && (Number.isNaN(yEnd) ? y === yStart : y <= yEnd)) {
      return el;
    }
  }
  return null;
}

function findNearestElementForY(windowEl, y, direction) {
  let best = null;
  for (const el of windowEl.children) {
    if (!(el instanceof HTMLElement)) continue;
    const yStart = parseInt(el.dataset.y);
    const yEnd = parseInt(el.dataset.yEnd || el.dataset.y);
    if (Number.isNaN(yStart)) continue;
    const spanEnd = Number.isNaN(yEnd) ? yStart : yEnd;
    if (direction === 'before') {
      if (spanEnd <= y && (!best || spanEnd > best.y)) best = { el, y: spanEnd };
    } else if (yStart >= y && (!best || yStart < best.y)) {
      best = { el, y: yStart };
    }
  }
  return best ? best.el : null;
}

function applyCurrentRichSearchHighlights(pane, renderToken) {
  try {
    require('./search').renderRichSearchHighlights(pane, { renderToken });
  } catch {}
}

function resetRichSearchSnapshotState(pane, { close = false, preserveSearch = false } = {}) {
  if (!pane) return;
  try { require('./search').clearRichSearchHighlights(pane); } catch {}
  if (!preserveSearch) {
    pane.richSearchMatches = [];
    pane.richSearchIndex = -1;
    pane.richSearchCountText = '';
  }
  pane.richSearchSource = null;
  if (pane.richSearchNormalizeCache) pane.richSearchNormalizeCache.clear();
  if (close) pane.richSearchOpen = false;
}

function renderRichVirtualWindow(pane, targetY, anchor) {
  const v = pane.richVirtual;
  if (!v || !v.active) return;
  const buf = richSourceBuffer(pane);
  if (!buf) return;

  const range = clampRowRange(
    targetY, v.sourceStartY, v.sourceEndY, v.overscanRows, v.maxRenderedRows
  );
  const startY = range.startY;
  const endY = range.endY;
  const displayMathRange = expandRangeForDisplayMathSpans(
    startY, endY, v.displayMathSpans || []
  );
  const expandedStartY = Math.min(
    displayMathRange.startY,
    expandStartForStructure(buf, startY, v.sourceStartY, v.structureBackscanRows)
  );
  const expandedEndY = expandEndForWrappedLine(
    buf, displayMathRange.endY, v.sourceEndY, v.structureBackscanRows
  );

  pane._richRenderToken = (pane._richRenderToken | 0) + 1;
  const renderToken = pane._richRenderToken;
  v.renderToken = renderToken;

  const opts = {
    renderToken,
    displayMathSpanStarts: v.displayMathSpanStarts,
    displayMathBlocks: v.displayMathBlocks,
    fencedCodeSpans: v.fencedCodeSpans,
    fencedCodeSpanStarts: v.fencedCodeSpanStarts
  };

  if (v.windowEl) v.windowEl.replaceChildren();

  if (endY < startY) {
    if (v.topSpacerEl) v.topSpacerEl.style.height = '0px';
    if (v.bottomSpacerEl) v.bottomSpacerEl.style.height = '0px';
    v.renderedStartY = startY;
    v.renderedEndY = endY;
    v.expandedStartY = expandedStartY;
    return;
  }

  const textLines = collectBufferLines(buf, expandedStartY, expandedEndY);
  renderLinesToContainer(textLines, v.windowEl, richPromptLineChecker(pane), pane, opts);
  insertImagesIntoContainer(v.windowEl, pane, expandedStartY, expandedEndY);

  v.renderedStartY = startY;
  v.renderedEndY = endY;
  v.expandedStartY = expandedStartY;
  v.expandedEndY = expandedEndY;

  const renderedRowCount = expandedEndY - expandedStartY + 1;
  const measuredHeight = v.windowEl.offsetHeight;
  if (renderedRowCount > 0 && measuredHeight > 0) {
    const measuredAvg = measuredHeight / renderedRowCount;
    v.averageRowHeight = applyHeightSmoothing(
      v.averageRowHeight, measuredAvg, RICH_VIRTUAL_HEIGHT_SMOOTHING
    );
  }

  const spacers = computeSpacerHeights(
    v.sourceStartY, v.sourceEndY, startY, endY, v.averageRowHeight
  );
  if (v.topSpacerEl) v.topSpacerEl.style.height = spacers.top + 'px';
  if (v.bottomSpacerEl) v.bottomSpacerEl.style.height = spacers.bottom + 'px';

  if (anchor) {
    const el = findElementForY(v.windowEl, anchor.y);
    if (el) {
      pane.richView.scrollTop = el.offsetTop - anchor.offsetWithinViewport;
    }
  }

  applyCurrentRichSearchHighlights(pane, renderToken);
}

function scrollRichViewToSourceRow(pane, y, opts = {}) {
  if (!pane || !pane.richView) return false;
  const v = pane.richVirtual;

  if (!v || !v.active) {
    const root = pane.richContent || pane.richView;
    const target = findElementForY(root, y);
    if (!target) return false;
    const centeredTop = target.offsetTop - (pane.richView.clientHeight - target.offsetHeight) / 2;
    pane.richView.scrollTop = Math.max(0, centeredTop);
    applyCurrentRichSearchHighlights(pane, null);
    return true;
  }

  if (pane._richScrollRaf) {
    cancelAnimationFrame(pane._richScrollRaf);
    pane._richScrollRaf = 0;
  }

  const existingTarget = v.windowEl ? findElementForY(v.windowEl, y) : null;
  if (existingTarget) {
    const scrollTop = pane.richView.scrollTop;
    const viewBottom = scrollTop + pane.richView.clientHeight;
    const elTop = existingTarget.offsetTop;
    const elBottom = elTop + existingTarget.offsetHeight;
    if (elBottom > scrollTop && elTop < viewBottom) {
      applyCurrentRichSearchHighlights(pane, v.renderToken);
      prioritizeKatexQueue(pane.richView);
      return true;
    }
  }

  renderRichVirtualWindow(pane, y, null);
  const renderToken = v.renderToken;
  const target = findElementForY(v.windowEl, y)
    || findNearestElementForY(v.windowEl, y, 'after')
    || findNearestElementForY(v.windowEl, y, 'before');
  if (target) {
    const centeredTop = target.offsetTop - (pane.richView.clientHeight - target.offsetHeight) / 2;
    pane.richView.scrollTop = Math.max(0, centeredTop);
  } else {
    const estimatedTop = (y - v.sourceStartY) * v.averageRowHeight;
    pane.richView.scrollTop = Math.max(0, estimatedTop - pane.richView.clientHeight / 2);
  }
  prioritizeKatexQueue(pane.richView);
  applyCurrentRichSearchHighlights(pane, renderToken);
  return true;
}

function displayMathRenderOptsForPane(pane) {
  const v = pane.richVirtual;
  return v && (v.displayMathSpanStarts || v.fencedCodeSpans)
    ? {
      displayMathSpanStarts: v.displayMathSpanStarts,
      displayMathBlocks: v.displayMathBlocks,
      fencedCodeSpans: v.fencedCodeSpans,
      fencedCodeSpanStarts: v.fencedCodeSpanStarts
    }
    : undefined;
}

function scheduleRichVirtualRender(pane) {
  if (pane._richScrollRaf) return;
  pane._richScrollRaf = requestAnimationFrame(() => {
    pane._richScrollRaf = 0;
    onRichVirtualScroll(pane);
  });
}

function onRichVirtualScroll(pane) {
  const v = pane.richVirtual;
  if (!v || !v.active) return;
  const rv = pane.richView;
  const anchor = findFirstVisibleAnchor(pane);
  let targetY;
  if (anchor) targetY = anchor.y;
  else targetY = scrollTopToRow(rv.scrollTop, v.sourceStartY, v.averageRowHeight);
  if (v.renderedStartY != null && v.renderedEndY != null) {
    const margin = Math.max(1, Math.floor(v.overscanRows / 2));
    const atTopEdge = v.renderedStartY <= v.sourceStartY;
    const atBottomEdge = v.renderedEndY >= v.sourceEndY;
    const lowerBound = atTopEdge ? v.sourceStartY : v.renderedStartY + margin;
    const upperBound = atBottomEdge ? v.sourceEndY : v.renderedEndY - margin;
    if (targetY >= lowerBound && targetY <= upperBound) return;
  }
  renderRichVirtualWindow(pane, targetY, anchor);
  prioritizeKatexQueue(pane.richView);
  applyCurrentRichSearchHighlights(pane, pane.richVirtual && pane.richVirtual.renderToken);
}

function remeasureRichVirtualWindow(pane, anchor) {
  const v = pane.richVirtual;
  if (!v?.active || !v.windowEl) return;
  const renderedRowCount = Number.isInteger(v.expandedStartY) && Number.isInteger(v.expandedEndY)
    ? Math.max(0, v.expandedEndY - v.expandedStartY + 1)
    : 0;
  const measuredHeight = v.windowEl.offsetHeight;
  if (renderedRowCount > 0 && measuredHeight > 0) {
    v.averageRowHeight = applyHeightSmoothing(
      v.averageRowHeight,
      measuredHeight / renderedRowCount,
      RICH_VIRTUAL_HEIGHT_SMOOTHING
    );
  }
  if (Number.isInteger(v.renderedStartY) && Number.isInteger(v.renderedEndY)) {
    const spacers = computeSpacerHeights(
      v.sourceStartY,
      v.sourceEndY,
      v.renderedStartY,
      v.renderedEndY,
      v.averageRowHeight
    );
    if (v.topSpacerEl) v.topSpacerEl.style.height = spacers.top + 'px';
    if (v.bottomSpacerEl) v.bottomSpacerEl.style.height = spacers.bottom + 'px';
  }
  if (anchor) {
    const el = findElementForY(v.windowEl, anchor.y);
    if (el) pane.richView.scrollTop = Math.max(0, el.offsetTop - anchor.offsetWithinViewport);
  }
}

function refreshRichViewAfterLayout(pane, opts = {}) {
  if (!pane || !pane.richVisible) return;
  const v = pane.richVirtual;
  if (!v || !v.active) {
    prioritizeKatexQueue(pane.richView);
    applyCurrentRichSearchHighlights(pane, null);
    return;
  }
  if (pane._richLayoutRaf) return;
  pane._richLayoutRaf = requestAnimationFrame(() => {
    pane._richLayoutRaf = 0;
    const current = pane.richVirtual;
    if (!pane.richVisible || !current || !current.active) return;
    const anchor = findFirstVisibleAnchor(pane);
    if (current.sourceBuffer) {
      remeasureRichVirtualWindow(pane, anchor);
      prioritizeKatexQueue(pane.richView);
      return;
    }
    if (anchor && !opts.force) {
      prioritizeKatexQueue(pane.richView);
      applyCurrentRichSearchHighlights(pane, current.renderToken);
      return;
    }
    const targetY = anchor ? anchor.y : scrollTopToRow(
      pane.richView.scrollTop, current.sourceStartY, current.averageRowHeight
    );
    renderRichVirtualWindow(pane, targetY, anchor || null);
    prioritizeKatexQueue(pane.richView);
    applyCurrentRichSearchHighlights(pane, current.renderToken);
  });
}

function captureRichViewLayoutState(pane) {
  if (!pane || !pane.richVisible || !pane.richView) return null;
  const v = pane.richVirtual;
  const anchor = v?.active ? findFirstVisibleAnchor(pane) : null;
  const sourceSpan = v?.active ? Math.max(0, v.sourceEndY - v.sourceStartY) : 0;
  return {
    scrollTop: pane.richView.scrollTop,
    anchor,
    atBottom: pane.richView.scrollTop + pane.richView.clientHeight >= pane.richView.scrollHeight - 2,
    sourceCols: v?.sourceCols || null,
    sourceStartY: v?.active ? v.sourceStartY : null,
    sourceEndY: v?.active ? v.sourceEndY : null,
    sourceProgress: anchor && sourceSpan > 0
      ? (anchor.y - v.sourceStartY) / sourceSpan
      : null
  };
}

function restoredRichAnchor(v, saved) {
  if (!saved?.anchor || !v?.active) return saved?.anchor || null;
  const sourceShapeChanged = Number.isFinite(saved.sourceCols)
    && Number.isFinite(v.sourceCols)
    && (saved.sourceCols !== v.sourceCols
      || saved.sourceStartY !== v.sourceStartY
      || saved.sourceEndY !== v.sourceEndY);
  if (!Number.isFinite(saved.sourceProgress) || !sourceShapeChanged) {
    return saved.anchor;
  }
  const span = Math.max(0, v.sourceEndY - v.sourceStartY);
  return {
    ...saved.anchor,
    y: v.sourceStartY + Math.round(Math.max(0, Math.min(1, saved.sourceProgress)) * span)
  };
}

function restoreRichViewLayoutState(pane, saved) {
  if (!pane || !pane.richVisible || !pane.richView || !saved) return;

  const restore = () => {
    if (!pane.richVisible || !pane.richView) return;
    const v = pane.richVirtual;
    if (saved.atBottom) {
      pane.richView.scrollTop = pane.richView.scrollHeight;
      prioritizeKatexQueue(pane.richView);
      return;
    }
    const savedAnchor = restoredRichAnchor(v, saved);
    if (v && v.active && savedAnchor) {
      const el = findElementForY(v.windowEl, savedAnchor.y);
      if (el) {
        pane.richView.scrollTop = Math.max(0, el.offsetTop - savedAnchor.offsetWithinViewport);
        prioritizeKatexQueue(pane.richView);
        applyCurrentRichSearchHighlights(pane, v.renderToken);
      } else {
        renderRichVirtualWindow(pane, savedAnchor.y, savedAnchor);
      }
      return;
    }
    pane.richView.scrollTop = saved.scrollTop || 0;
    prioritizeKatexQueue(pane.richView);
    applyCurrentRichSearchHighlights(pane, v && v.renderToken);
  };

  // Restore immediately, then once more after layout settles from pane DOM moves.
  restore();
  requestAnimationFrame(restore);
}

function attachRichScrollListener(pane) {
  detachRichScrollListener(pane);
  const handler = () => scheduleRichVirtualRender(pane);
  pane._richScrollListener = handler;
  pane.richView.addEventListener('scroll', handler, { passive: true });
}

function detachRichScrollListener(pane) {
  if (pane._richScrollRaf) {
    cancelAnimationFrame(pane._richScrollRaf);
    pane._richScrollRaf = 0;
  }
  if (pane._richScrollListener && pane.richView) {
    pane.richView.removeEventListener('scroll', pane._richScrollListener);
  }
  pane._richScrollListener = null;
}

function tabShowRichView(tab, auto) {
  if (tab.richVisible) return;
  tab.richVisible = true;
  tab.richAutoTriggered = !!auto;
  tab.richView.classList.add('visible');
  if (isActivePane(tab)) {
    tab.richView.focus();
    tab.term.blur();
  }
  const isVirtual = !!(tab.richVirtual && tab.richVirtual.active);
  requestAnimationFrame(() => {
    if (!isVirtual) {
      tab.richView.scrollTop = tab.richView.scrollHeight > tab.richView.clientHeight + 10
        ? 0 : tab.richView.scrollHeight;
    }
    prioritizeKatexQueue(tab.richView);
  });
  const mathChord = formatShortcut(parseShortcut(settings.shortcuts.toggleMath), isMac);
  const hintText = auto
    ? 'Press Esc or q to return to terminal'
    : `Esc/q/${mathChord} to return \u00b7 Select & copy freely`;
  const hintTextEl = tab.richHint.querySelector('.rich-hint-text');
  if (hintTextEl) hintTextEl.textContent = hintText;
  else tab.richHint.textContent = hintText;
  if (isActivePane(tab)) {
    updateStatusBar(tab);
  }
}

function tabHideRichView(tab) {
  const wasVisible = !!tab.richVisible;
  disposeRichSnapshotSource(tab);
  if (!wasVisible) return;
  tab.richVisible = false;
  tab.richAutoTriggered = false;
  tab.richView.classList.remove('visible');
  resetRichSearchSnapshotState(tab, { close: true });
  detachRichScrollListener(tab);
  tab._richRenderToken = (tab._richRenderToken | 0) + 1;
  if (tab.richVirtual) {
    tab.richVirtual.active = false;
    tab.richVirtual = null;
  }
  if (tab.richContent) tab.richContent.replaceChildren();
  if (isActivePane(tab)) {
    updateStatusBar(tab);
    tab.term.focus();
  }
}

function toggleMathMode() {
  const tab = getActivePane();
  if (!tab) return;
  if (tab.richVisible || tab._richSnapshotPending) tabHideRichView(tab);
  else void showManualRichView(tab);
}

function tabResetSection(tab) {
  tab.sectionBuffer = '';
  tab.sectionHasLatex = false;
  tab.sectionStartY = 0;
  tab._sectionStartTime = 0;
  tab._sectionAltScreen = false;
  tab._sectionImageStart = tab.inlineImages ? tab.inlineImages.length : 0;
  tab._sectionLatexCheckedLen = 0;
}

function tabFlushSection(tab) {
  if (tab._sectionAltScreen) { tabResetSection(tab); return; }
  if (tab._richSnapshotPending || (tab.richVisible && !tab.richAutoTriggered)) {
    tabResetSection(tab);
    return;
  }
  // Flush only if this section actually accumulated something — new LaTeX
  // text or a new image. Old images carrying over from earlier sections
  // shouldn't trigger a re-render (which would clobber the rich view).
  const newImagesInSection = tab.inlineImages.length > (tab._sectionImageStart || 0);
  if (!tab.sectionHasLatex && !newImagesInSection) { tabResetSection(tab); return; }
  const buf = tab.term.buffer.active;
  const endY = buf.baseY + buf.cursorY;
  const searchWasOpen = !!tab.richSearchOpen;
  disposeRichSnapshotSource(tab);
  detachRichScrollListener(tab);
  tab._richRenderToken = (tab._richRenderToken | 0) + 1;
  resetRichSearchSnapshotState(tab, { close: !searchWasOpen, preserveSearch: searchWasOpen });
  if (tab.richVirtual) {
    tab.richVirtual.active = false;
    tab.richVirtual = null;
  }
  tab.richContent.innerHTML = '';

  let startY = tab.sectionStartY;
  for (let y = tab.sectionStartY - 1; y >= Math.max(0, tab.sectionStartY - 10); y--) {
    let line;
    try { line = buf.getLine(y); } catch { break; }
    if (!line) break;
    const text = bufferLineToSemanticText(line);
    if (!text.trim()) continue;
    if (isPromptLine(tab, text, y)) { startY = y; break; }
    break;
  }

  const textLines = collectBufferLines(buf, startY, endY);

  const foundContent = renderLinesToContainer(textLines, tab.richContent, isPromptLine, tab);
  if (foundContent) {
    insertImagesIntoContainer(tab.richContent, tab, startY, endY);
    tab.richSearchSource = {
      type: 'snapshot',
      sourceStartY: startY,
      sourceEndY: endY,
      lines: textLines.map(item => ({
        y: item.y,
        text: item.text || '',
        yEnd: item.yEnd !== undefined ? item.yEnd : item.y
      }))
    };
    tabShowRichView(tab, true);
    if (searchWasOpen && tab.richSearchQuery && isActivePane(tab)) {
      try { require('./search').refreshRichSearch(tab); } catch {}
    }
  }
  tabResetSection(tab);
}

function tabFeedSection(tab, data) {
  if (!tab.autoRender) return;
  const enteringAlt = /\x1b\[\?(?:1049|1047|47)h/.test(data);
  const leavingAlt = /\x1b\[\?(?:1049|1047|47)l/.test(data);
  if (enteringAlt && !tab._sectionAltScreen) {
    // Discard pre-alt-screen state so a stale sectionHasLatex can't trigger
    // an autoflush against the alt buffer's coord space.
    clearTimeout(tab.sectionTimer);
    tab.sectionHasLatex = false;
    tab.sectionBuffer = '';
    tab._sectionLatexCheckedLen = 0;
  }
  if (enteringAlt || leavingAlt) tab._sectionAltScreen = true;
  if (tab._sectionAltScreen) return;
  if (!tab.sectionBuffer) {
    const buf = tab.term.buffer.active;
    tab.sectionStartY = buf.baseY + buf.cursorY;
    tab._sectionStartTime = Date.now();
  }
  tab.sectionBuffer += data;
  if (tab.sectionBuffer.length > SECTION_BUFFER_MAX) {
    const trimmed = tab.sectionBuffer.length - SECTION_BUFFER_MAX;
    tab.sectionBuffer = tab.sectionBuffer.slice(-SECTION_BUFFER_MAX);
    tab._sectionLatexCheckedLen = Math.max(0, (tab._sectionLatexCheckedLen || 0) - trimmed);
  }
  if (!tab.sectionHasLatex) {
    const checkedLen = Math.max(0, tab._sectionLatexCheckedLen || 0);
    const scanStart = Math.max(0, checkedLen - SECTION_LATEX_SCAN_OVERLAP);
    if (hasLatex(stripAnsi(tab.sectionBuffer.slice(scanStart)))) tab.sectionHasLatex = true;
    tab._sectionLatexCheckedLen = tab.sectionBuffer.length;
  }
  const elapsed = Date.now() - tab._sectionStartTime;
  if (tab.sectionHasLatex && (tab.sectionBuffer.length >= SECTION_BUFFER_MAX || elapsed >= SECTION_ELAPSED_MAX)) {
    clearTimeout(tab.sectionTimer);
    tabFlushSection(tab);
  } else {
    clearTimeout(tab.sectionTimer);
    tab.sectionTimer = setTimeout(() => tabFlushSection(tab), settings.autoRenderDelay);
  }
}

function showManualRichView(pane) {
  if (!pane?.term || !pane.serializeAddon || pane._closing) return Promise.resolve(false);
  if (pane.richVisible) return Promise.resolve(true);
  if (pane._richSnapshotPromise) return pane._richSnapshotPromise;

  disposeRichSnapshotSource(pane);
  const generation = pane._richSnapshotGeneration;
  pane._richSnapshotPending = true;
  const liveBuffer = pane.term.buffer.active;
  const capturedViewportTopY = liveBuffer.viewportY;
  const capturedSourceEndY = liveBuffer.baseY + liveBuffer.cursorY;
  const capturedRows = pane.term.rows;
  const promptYSet = new Set(pane._promptYSet || []);
  const sourceImages = Array.isArray(pane.inlineImages) ? pane.inlineImages.slice() : [];

  const snapshotPromise = createRichTerminalSnapshot({
    liveTerm: pane.term,
    serializeAddon: pane.serializeAddon,
    scrollback: settings.scrollback
  }).then(snapshot => {
    if (pane._closing || pane._richSnapshotGeneration !== generation) {
      disposeRichTerminalSnapshot(snapshot);
      return false;
    }
    pane.richSnapshot = snapshot;
    pane._richSnapshotPending = false;
    return showManualRichViewFromSnapshot(pane, {
      snapshot,
      promptYSet,
      sourceImages,
      capturedViewportTopY,
      capturedSourceEndY,
      capturedRows
    });
  }).catch(err => {
    if (pane._richSnapshotGeneration === generation) {
      console.error('Failed to create Math Mode snapshot:', err);
      if (pane.richVisible) {
        tabHideRichView(pane);
      } else {
        if (pane.richVirtual) {
          pane.richVirtual.active = false;
          pane.richVirtual = null;
        }
        if (pane.richContent) pane.richContent.replaceChildren();
        disposeRichSnapshotSource(pane);
      }
    }
    return false;
  }).finally(() => {
    if (pane._richSnapshotPromise === snapshotPromise) pane._richSnapshotPromise = null;
  });

  pane._richSnapshotPromise = snapshotPromise;
  return snapshotPromise;
}

function showManualRichViewFromSnapshot(pane, captured) {
  const {
    snapshot,
    promptYSet,
    sourceImages,
    capturedViewportTopY,
    capturedSourceEndY,
    capturedRows
  } = captured;
  const buf = snapshot.buffer;
  const sourceStartY = 0;
  const snapshotEndY = buf.baseY + buf.cursorY;
  const sourceEndY = Math.min(capturedSourceEndY, snapshotEndY);
  const viewportTopY = Math.max(sourceStartY, Math.min(capturedViewportTopY, sourceEndY));
  const cursorY = sourceEndY;
  const atLiveEdge = sourceEndY >= viewportTopY
    && sourceEndY <= viewportTopY + capturedRows - 1;
  const targetY = atLiveEdge ? cursorY : viewportTopY;
  const promptChecker = (_tab, _text, y) => promptYSet.has(y);

  detachRichScrollListener(pane);
  pane._richRenderToken = (pane._richRenderToken | 0) + 1;
  resetRichSearchSnapshotState(pane, { close: true });
  pane.richContent.replaceChildren();

  const topSpacer = document.createElement('div');
  topSpacer.className = 'rich-virtual-top-spacer';
  topSpacer.style.height = '0px';
  const windowEl = document.createElement('div');
  windowEl.className = 'rich-window';
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'rich-virtual-bottom-spacer';
  bottomSpacer.style.height = '0px';
  pane.richContent.appendChild(topSpacer);
  pane.richContent.appendChild(windowEl);
  pane.richContent.appendChild(bottomSpacer);

  const lineHeight = getRichEstimatedLineHeight(pane);
  const fencedCodeSpans = computeFencedCodeSpans(
    buf, sourceStartY, sourceEndY,
    (text, y) => promptChecker(pane, text, y)
  );
  const isPromptRow = (text, y) => promptChecker(pane, text, y);
  const isFencedRow = y => fencedCodeSpans.some(span => span.startY <= y && y <= span.endY);
  const rulesSpans = () => computeDisplayMathSpans(buf, sourceStartY, sourceEndY, isPromptRow, isFencedRow);
  let displayMathSpans;
  let displayMathBlocks = null;
  if (useModelDetection()) {
    const detected = computeModelDisplayMathSpans(buf, sourceStartY, sourceEndY, isPromptRow, isFencedRow);
    displayMathSpans = detected.spans;
    displayMathBlocks = new Map(detected.spans.map(span => [span.startY, span]));
    if (settings.captureMathViews) {
      saveMathCapture(buildMathCapture({
        lines: detected.lines,
        promptIdx: detected.lines.map((l, i) => (isPromptRow(l.text, l.y) ? i : -1)).filter(i => i >= 0),
        fencedIdx: detected.lines.map((l, i) => (isFencedRow(l.y) ? i : -1)).filter(i => i >= 0),
        modelSpans: detected.raw,
        rulesSpans: rulesSpans(),
        cols: snapshot.cols,
        rows: capturedRows,
        detection: 'model',
        modelFormat: DISPLAY_MATH_MODEL_FORMAT
      }));
    }
  } else {
    displayMathSpans = rulesSpans();
  }
  pane.richVirtual = {
    active: true,
    sourceBuffer: buf,
    sourceCols: snapshot.cols,
    promptYSet,
    sourceImages,
    sourceStartY,
    sourceEndY,
    cursorY,
    viewportTopY,
    targetY,
    atLiveEdge,
    estimatedLineHeight: lineHeight,
    averageRowHeight: lineHeight,
    overscanRows: RICH_VIRTUAL_OVERSCAN_ROWS,
    maxRenderedRows: RICH_VIRTUAL_MAX_RENDERED_ROWS,
    structureBackscanRows: RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS,
    renderedStartY: null,
    renderedEndY: null,
    expandedStartY: null,
    expandedEndY: null,
    displayMathSpans,
    displayMathSpanStarts: new Set(displayMathSpans.map(span => span.startY)),
    displayMathBlocks,
    fencedCodeSpans,
    fencedCodeSpanStarts: new Set(fencedCodeSpans.map(span => span.startY)),
    topSpacerEl: topSpacer,
    windowEl,
    bottomSpacerEl: bottomSpacer,
    renderToken: pane._richRenderToken
  };
  pane.richSearchSource = { type: 'virtual' };

  renderRichVirtualWindow(pane, targetY, null);

  const hasImages = sourceImages.length > 0;
  const hasRendered = windowEl.children.length > 0;
  if (!hasRendered && !hasImages) {
    pane.richVirtual.active = false;
    pane.richVirtual = null;
    pane.richContent.replaceChildren();
    disposeRichSnapshotSource(pane);
    return false;
  }

  tabShowRichView(pane, false);

  requestAnimationFrame(() => {
    const renderToken = pane._richRenderToken;
    const v = pane.richVirtual;
    if (!v || !v.active) return;
    const target = findElementForY(windowEl, targetY)
      || findNearestElementForY(windowEl, targetY, atLiveEdge ? 'before' : 'after');
    if (atLiveEdge) {
      pane.richView.scrollTop = pane.richView.scrollHeight;
    } else if (target) {
        pane.richView.scrollTop = target.offsetTop;
    } else {
      const estimatedTop = Math.max(0,
        (targetY - v.sourceStartY) * v.averageRowHeight);
      pane.richView.scrollTop = estimatedTop;
    }
    prioritizeKatexQueue(pane.richView);
    if (!atLiveEdge) {
      attachRichScrollListener(pane);
      return;
    }
    drainKatexQueue().then(() => {
      requestAnimationFrame(() => {
        if (!pane.richVisible || pane._richRenderToken !== renderToken) return;
        pane.richView.scrollTop = pane.richView.scrollHeight;
        attachRichScrollListener(pane);
      });
    });
  });
  return true;
}

function materializeFullRichView(pane) {
  const v = pane.richVirtual;
  const buf = richSourceBuffer(pane);
  if (!buf) throw new Error('Math view source is unavailable');
  const sourceStartY = v ? v.sourceStartY : 0;
  const sourceEndY = v ? v.sourceEndY : buf.baseY + buf.cursorY;
  const rowCount = Math.max(0, sourceEndY - sourceStartY + 1);
  if (rowCount > RICH_VIRTUAL_EXPORT_MAX_ROWS) {
    throw new Error(
      `Math view is too large to export (${rowCount} rows; limit ${RICH_VIRTUAL_EXPORT_MAX_ROWS}). `
      + `Reduce the scrollback or export a smaller range.`);
  }

  const liveStyles = getComputedStyle(pane.richView);
  const container = document.createElement('div');
  container.className = 'rich-view rich-view-export visible';
  container.style.position = 'absolute';
  container.style.left = '-100000px';
  container.style.top = '0';
  container.style.width = pane.richView.clientWidth + 'px';
  container.style.height = 'auto';
  container.style.maxHeight = 'none';
  container.style.overflow = 'visible';
  container.style.opacity = '1';
  container.style.pointerEvents = 'none';
  container.style.background = liveStyles.backgroundColor;
  container.style.color = liveStyles.color;

  const content = document.createElement('div');
  content.className = 'rich-content';
  container.appendChild(content);

  document.body.appendChild(container);

  if (rowCount > 0) {
    const textLines = collectBufferLines(buf, sourceStartY, sourceEndY);
    renderLinesToContainer(
      textLines, content, richPromptLineChecker(pane), pane, displayMathRenderOptsForPane(pane)
    );
    insertImagesIntoContainer(content, pane, sourceStartY, sourceEndY);
  }

  return { container, content };
}

function renderFileContent(tab, content, filePath) {
  disposeRichSnapshotSource(tab);
  detachRichScrollListener(tab);
  tab._richRenderToken = (tab._richRenderToken | 0) + 1;
  resetRichSearchSnapshotState(tab, { close: true });
  if (tab.richVirtual) {
    tab.richVirtual.active = false;
    tab.richVirtual = null;
  }
  tab.richContent.innerHTML = '';
  const sourceLines = String(content || '').split('\n').map((text, y) => ({ y, text }));
  tab.richSearchSource = {
    type: 'file',
    sourceStartY: 0,
    sourceEndY: Math.max(0, sourceLines.length - 1),
    lines: sourceLines
  };
  const isMd = filePath && /\.md$/i.test(filePath);
  let shown = false;
  if (isMd) {
    renderMarkdownFile(content, tab.richContent);
    const wrapper = tab.richContent.lastElementChild;
    if (wrapper) {
      wrapper.dataset.y = '0';
      wrapper.dataset.yEnd = String(Math.max(0, sourceLines.length - 1));
    }
    tabShowRichView(tab, false);
    shown = true;
  } else {
    const foundContent = renderLinesToContainer(sourceLines, tab.richContent, null, null);
    if (foundContent) { tabShowRichView(tab, false); shown = true; }
  }
  if (shown) {
    requestAnimationFrame(() => {
      tab.richView.scrollTop = 0;
      prioritizeKatexQueue(tab.richView);
    });
  }
}

function tabFlushSectionOnCommandEnd(tab) {
  if (!tab.autoRender) return;
  clearTimeout(tab.sectionTimer);
  if (tab._sectionAltScreen) {
    tab._sectionAltScreen = false;
    tabResetSection(tab);
    return;
  }
  const newImagesInSection = tab.inlineImages.length > (tab._sectionImageStart || 0);
  if (tab.sectionHasLatex || newImagesInSection) {
    tabFlushSection(tab);
  } else {
    tabResetSection(tab);
  }
}

module.exports = {
  tabShowRichView, tabHideRichView, toggleMathMode,
  tabResetSection, tabFlushSection, tabFeedSection,
  tabFlushSectionOnCommandEnd,
  showManualRichView, renderFileContent,
  scrollRichViewToSourceRow,
  refreshRichViewAfterLayout,
  captureRichViewLayoutState, restoreRichViewLayoutState,
  materializeFullRichView, drainKatexQueue,
  disposeRichSnapshotSource,
  SECTION_BUFFER_MAX, SECTION_ELAPSED_MAX,
  // Helpers exported for unit tests
  clampRowRange, scrollTopToRow, computeSpacerHeights,
  applyHeightSmoothing, coerceRenderToken,
  computeDisplayMathSpans, expandRangeForDisplayMathSpans,
  RICH_VIRTUAL_OVERSCAN_ROWS, RICH_VIRTUAL_MAX_RENDERED_ROWS,
  RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS, RICH_VIRTUAL_EXPORT_MAX_ROWS,
  findElementForY
};
