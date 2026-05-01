const { getActivePane, isActivePane, updateStatusBar } = require('./state');
const { settings, isMac } = require('./settings');
const { parseShortcut, formatShortcut } = require('./keybindings');
const { hasLatex, splitLatexSmart } = require('./latex');
const { stripAnsi, lineToColoredSpans } = require('./ansi');
const { isPromptLine } = require('./promptTrack');
const { refreshTabTitle } = require('./titleTrack');
const { isTableBorder, tryParseTableBlock, tryParseMarkdownTable } = require('./tableRender');
const { renderMarkdownBlock, renderMarkdownFile } = require('./markdown');
const { renderKatexInto } = require('./katexRender');
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
  isLikelyDisplayMathBodyText,
  isLikelyCodeFenceBodyText,
  parseFenceLine,
  isClosingFenceLine,
  expandStartForStructure
} = require('./richVirtual');

const SECTION_BUFFER_MAX = 256 * 1024;
const SECTION_ELAPSED_MAX = 30000;

const _katexQueue = [];
let _katexRaf = 0;
const KATEX_CHUNK = 48;
const KATEX_FRAME_BUDGET_MS = 12;


function queueKatex(latex, el, displayMode, opts) {
  el.textContent = latex;
  el.dataset.katexPending = '1';
  let token = null;
  if (opts && opts.renderToken != null) {
    token = String(opts.renderToken);
    el.dataset.richRenderToken = token;
  }
  _katexQueue.push({ latex, el, displayMode, token });
  scheduleKatexFlush();
}

function scheduleKatexFlush() {
  if (_katexRaf) return;
  _katexRaf = requestAnimationFrame(() => {
    _katexRaf = requestAnimationFrame(_flushKatex);
  });
}

function prioritizeKatexQueue(viewportEl) {
  if (!_katexQueue.length || !viewportEl) return;
  const top = Math.max(0, viewportEl.scrollTop - viewportEl.clientHeight);
  const bottom = viewportEl.scrollTop + viewportEl.clientHeight * 2;
  const scored = _katexQueue.map((entry, index) => ({
    entry,
    index,
    score: katexViewportScore(entry.el, top, bottom)
  }));
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  _katexQueue.length = 0;
  for (const item of scored) _katexQueue.push(item.entry);
}

function katexViewportScore(el, top, bottom) {
  if (!el.isConnected) return Number.MAX_SAFE_INTEGER;
  const line = el.closest('.rline, .display-math') || el;
  const elTop = line.offsetTop;
  const elBottom = elTop + line.offsetHeight;
  if (elBottom >= top && elTop <= bottom) return 0;
  return Math.min(Math.abs(elBottom - top), Math.abs(elTop - bottom));
}

function _flushKatex() {
  const started = performance.now();
  let rendered = 0;
  let consumed = 0;
  while (consumed < _katexQueue.length
    && (rendered < KATEX_CHUNK || performance.now() - started < KATEX_FRAME_BUDGET_MS)) {
    const { latex, el, displayMode, token } = _katexQueue[consumed];
    consumed++;
    if (!el.isConnected) continue;
    if (token != null && el.dataset.richRenderToken !== token) continue;
    renderKatexInto(latex, el, displayMode);
    delete el.dataset.katexPending;
    rendered++;
  }
  if (consumed > 0) _katexQueue.splice(0, consumed);
  if (_katexQueue.length > 0) {
    _katexRaf = requestAnimationFrame(_flushKatex);
  } else {
    _katexRaf = 0;
  }
}

function renderLineFromBuffer(line) {
  const text = line.translateToString(true);
  if (!text.trim()) return null;
  const el = document.createElement('div');
  el.className = 'rline';
  if (hasLatex(text)) {
    const parts = splitLatexSmart(text);
    for (const part of parts) {
      if (part.type === 'code') {
        const code = document.createElement('code');
        code.textContent = part.content;
        el.appendChild(code);
      } else if (part.type === 'display' && part.closed) {
        const span = document.createElement('span');
        span.className = 'display-math';
        queueKatex(part.content, span, true);
        el.appendChild(span);
      } else if (part.type === 'inline' && part.closed) {
        const span = document.createElement('span');
        queueKatex(part.content, span, false);
        el.appendChild(span);
      } else if (!part.closed && part.type !== 'text') {
        const span = document.createElement('span');
        span.className = 'latex-pending';
        span.textContent = part.raw;
        el.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.textContent = part.content;
        el.appendChild(span);
      }
    }
  } else {
    el.appendChild(lineToColoredSpans(line));
  }
  return el;
}

function _t(item) { return typeof item === 'string' ? item : (item.text || ''); }

function collectBufferLines(buf, startY, endY) {
  const raw = [];
  for (let y = startY; y <= endY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { continue; }
    if (!line) continue;
    raw.push({ text: line.translateToString(true), _line: line, y, wrapped: !!line.isWrapped });
  }
  const textLines = [];
  for (const item of raw) {
    if (item.wrapped && textLines.length > 0) {
      const prev = textLines[textLines.length - 1];
      prev.text += item.text;
      prev.joined = true;
      prev.yEnd = item.y;
    } else {
      textLines.push({ text: item.text, _line: item._line, y: item.y, yEnd: item.y });
    }
  }
  return textLines;
}

function applyInlineMarkdown(text, el) {
  const parts = [];
  let rest = text;
  const re = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(``.*?``)/;
  while (rest) {
    const m = rest.match(re);
    if (!m) { parts.push({ type: 'text', value: rest }); break; }
    const idx = m.index;
    if (idx > 0) parts.push({ type: 'text', value: rest.slice(0, idx) });
    const raw = m[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      parts.push({ type: 'strong', value: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      parts.push({ type: 'code', value: raw.replace(/^`+|`+$/g, '') });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      parts.push({ type: 'em', value: raw.slice(1, -1) });
    }
    rest = rest.slice(idx + raw.length);
  }
  for (const p of parts) {
    let node;
    if (p.type === 'strong') { node = document.createElement('strong'); node.textContent = p.value; }
    else if (p.type === 'em') { node = document.createElement('em'); node.textContent = p.value; }
    else if (p.type === 'code') { node = document.createElement('code'); node.textContent = p.value; }
    else { node = document.createTextNode(p.value); }
    el.appendChild(node);
  }
}

// Horizontals + dashed + tees, but NOT corners or verticals — corners signal a
// box border (top/bottom edge), which we want to keep as literal text.
const BOX_RULE_RE = /^[─━┄┅┈┉╌╍═├┤┬┴┼\s]+$/;

function isBoxRule(text) {
  const t = text.trim();
  return t.length >= 6 && BOX_RULE_RE.test(t);
}

function filePathToUrl(filePath) {
  if (!filePath.startsWith('/')) return '';
  return 'file://' + filePath.split('/').map(encodeURIComponent).join('/');
}

function markdownImageTargetToSrc(target) {
  let src = target.trim();
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
  const titleMatch = src.match(/^(.*?)\s+["'][^"']*["']$/);
  if (titleMatch) src = titleMatch[1].trim();
  if (!/\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(src)) return '';
  if (/^(?:https?:|data:image\/)/i.test(src)) return src;
  if (src.startsWith('file://')) return src;
  if (src.startsWith('/')
    && typeof window.mathterm?.fs?.existsSync === 'function'
    && window.mathterm.fs.existsSync(src)) return filePathToUrl(src);
  return '';
}

function renderMarkdownImageLine(item, text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
  if (!match) return null;
  const src = markdownImageTargetToSrc(match[2]);
  if (!src) return null;

  const wrap = document.createElement('div');
  wrap.className = 'rline markdown-image-line';
  if (typeof item === 'object' && item.y !== undefined) {
    wrap.dataset.y = item.y;
    wrap.dataset.yEnd = item.yEnd !== undefined ? item.yEnd : item.y;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = match[1] || 'image';
  img.loading = 'lazy';
  wrap.appendChild(img);
  if (match[1]) {
    const caption = document.createElement('div');
    caption.className = 'markdown-image-caption';
    caption.textContent = match[1];
    wrap.appendChild(caption);
  }
  return wrap;
}

function renderRichLine(item, text, isPrompt, opts) {
  const imageEl = renderMarkdownImageLine(item, text);
  if (imageEl) return imageEl;

  const el = document.createElement('div');
  if (typeof item === 'object' && item.y !== undefined) {
    el.dataset.y = item.y;
    el.dataset.yEnd = item.yEnd !== undefined ? item.yEnd : item.y;
  }
  const trimmed = text.trimStart();
  const leading = text.length - trimmed.length;
  el.className = 'rline' + (isPrompt ? ' prompt-line' : '');

  if (!isPrompt && isBoxRule(text)) {
    el.className = 'rline rule';
    el.style.width = text.trim().length + 'ch';
    return el;
  }

  if (/^#{1,6}\s/.test(trimmed)) {
    const level = trimmed.match(/^(#{1,6})\s/)[1].length;
    const hdr = document.createElement(`h${Math.min(level, 6)}`);
    renderInlineLatexOrMd(trimmed.slice(level + 1).trim(), hdr, opts);
    el.appendChild(hdr);
    el.className += ' md-header';
  } else if (/^>\s/.test(trimmed)) {
    const bq = document.createElement('blockquote');
    bq.style.borderLeft = '3px solid var(--accent)';
    bq.style.paddingLeft = '8px';
    bq.style.margin = '2px 0';
    bq.style.color = 'var(--fg-muted)';
    renderInlineLatexOrMd(trimmed.slice(2), bq, opts);
    el.appendChild(bq);
  } else if (/^[-*]\s/.test(trimmed)) {
    const li = document.createElement('div');
    li.style.paddingLeft = '16px';
    li.style.position = 'relative';
    const bullet = document.createElement('span');
    bullet.textContent = trimmed[0] === '*' ? '•' : '•';
    bullet.style.position = 'absolute';
    bullet.style.left = '4px';
    li.appendChild(bullet);
    const span = document.createElement('span');
    span.style.paddingLeft = '12px';
    renderInlineLatexOrMd(trimmed.slice(2), span, opts);
    li.appendChild(span);
    el.appendChild(li);
  } else if (/^\d+\.\s/.test(trimmed)) {
    const numMatch = trimmed.match(/^(\d+\.)\s/);
    const li = document.createElement('div');
    li.style.paddingLeft = '16px';
    li.style.position = 'relative';
    const num = document.createElement('span');
    num.textContent = numMatch[1];
    num.style.position = 'absolute';
    num.style.left = '0';
    num.style.fontWeight = 'bold';
    li.appendChild(num);
    const span = document.createElement('span');
    span.style.paddingLeft = (numMatch[1].length + 1) + 'ch';
    renderInlineLatexOrMd(trimmed.slice(numMatch[0].length), span, opts);
    li.appendChild(span);
    el.appendChild(li);
  } else if (hasLatex(text)) {
    renderInlineLatexToEl(text, el, opts);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else if (typeof item === 'object' && item._line && !item.joined) {
    el.appendChild(lineToColoredSpans(item._line));
  } else {
    el.textContent = text;
  }
  return el;
}

function renderInlineLatexOrMd(text, el, opts) {
  if (hasLatex(text)) {
    renderInlineLatexToEl(text, el, opts);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else {
    el.textContent = text;
  }
}

function previousMeaningfulTextLine(textLines, startIdx) {
  for (let i = startIdx - 1; i >= 0; i--) {
    const item = textLines[i];
    const text = typeof item === 'string' ? item : (item.text || '');
    if (text.trim()) return text;
  }
  return '';
}

function hasDisplayMathCloseAheadInLines(textLines, startIdx, pane, promptLineChecker) {
  let sawBody = false;
  for (let i = startIdx + 1; i < textLines.length; i++) {
    const item = textLines[i];
    const text = typeof item === 'string' ? item : (item.text || '');
    if (typeof item === 'object' && item.y !== undefined
        && pane && promptLineChecker && promptLineChecker(pane, text, item.y)) {
      return false;
    }
    if (text.trim() === '$$') return sawBody;
    if (isLikelyDisplayMathBodyText(text)) sawBody = true;
  }
  return false;
}

function tryParseDisplayMath(textLines, startIdx, opts, pane, promptLineChecker) {
  const startItem = textLines[startIdx];
  const text = typeof startItem === 'string' ? startItem : (startItem.text || '');
  const trimmed = text.trim();
  if (trimmed !== '$$') return null;
  if (opts && opts.displayMathSpanStarts
      && (typeof startItem !== 'object' || !opts.displayMathSpanStarts.has(startItem.y))) {
    return null;
  }
  if (!(opts && opts.displayMathSpanStarts)
      && isLikelyDisplayMathBodyText(previousMeaningfulTextLine(textLines, startIdx))
      && !hasDisplayMathCloseAheadInLines(textLines, startIdx, pane, promptLineChecker)) {
    return null;
  }

  let j = startIdx + 1;
  let mathLines = [];
  while (j < textLines.length) {
    const item = textLines[j];
    const t = typeof item === 'string' ? item : (item.text || '');
    // An unclosed $$ shouldn't swallow shell prompts or command output.
    // A prompt line is a hard command boundary, so bail and let the $$
    // render as literal text.
    if (typeof item === 'object' && item.y !== undefined
        && pane && promptLineChecker && promptLineChecker(pane, t, item.y)) {
      return null;
    }
    if (t.trim() === '$$') {
      const latex = mathLines.join('\n');
      const el = document.createElement('div');
      el.className = 'display-math';
      el.style.textAlign = 'center';
      el.style.margin = '8px 0';
      if (typeof startItem === 'object' && startItem.y !== undefined) {
        el.dataset.y = startItem.y;
      }
      if (typeof item === 'object' && item.y !== undefined) {
        el.dataset.yEnd = item.yEnd !== undefined ? item.yEnd : item.y;
      }
      queueKatex(latex, el, true, opts);
      return { element: el, endIdx: j + 1 };
    }
    mathLines.push(t.trimEnd());
    j++;
  }
  return null;
}

function tagSpan(el, textLines, startIdx, endIdx) {
  const startItem = textLines[startIdx];
  const endItem = textLines[endIdx];
  if (typeof startItem === 'object' && startItem.y !== undefined) {
    el.dataset.y = startItem.y;
  }
  if (typeof endItem === 'object' && endItem.y !== undefined) {
    el.dataset.yEnd = endItem.yEnd !== undefined ? endItem.yEnd : endItem.y;
  }
}

function findFencedCodeSpanForY(spans, y) {
  if (!Array.isArray(spans)) return null;
  return spans.find(span => span.startY <= y && y <= span.endY) || null;
}

function renderFencedCodeElement(textLines, startIdx, endIdx, span) {
  const pre = document.createElement('pre');
  pre.className = 'rich-code-block';
  const code = document.createElement('code');
  const lines = [];
  for (let i = startIdx; i < endIdx; i++) {
    const item = textLines[i];
    const y = typeof item === 'object' ? item.y : undefined;
    if (span) {
      if (y === span.startY) continue;
      if (span.closed && y === span.endY) continue;
    } else {
      const text = typeof item === 'string' ? item : (item.text || '');
      if (i === startIdx && parseFenceLine(text)) continue;
      if (i === endIdx - 1 && isClosingFenceLine(text, parseFenceLine(_t(textLines[startIdx])))) {
        continue;
      }
    }
    lines.push(typeof item === 'string' ? item : (item.text || ''));
  }
  code.textContent = lines.join('\n');
  pre.appendChild(code);
  tagSpan(pre, textLines, startIdx, Math.max(startIdx, endIdx - 1));
  return pre;
}

function tryParseFencedCodeBlock(textLines, startIdx, opts) {
  const item = textLines[startIdx];
  const text = typeof item === 'string' ? item : (item.text || '');
  const y = typeof item === 'object' ? item.y : undefined;
  const span = y !== undefined ? findFencedCodeSpanForY(opts && opts.fencedCodeSpans, y) : null;
  if (opts && opts.fencedCodeSpanStarts
      && (y === undefined || (!span && !opts.fencedCodeSpanStarts.has(y)))) {
    return null;
  }
  if (span) {
    let endIdx = startIdx;
    while (endIdx < textLines.length) {
      const cur = textLines[endIdx];
      const curY = typeof cur === 'object' ? cur.y : undefined;
      if (curY === undefined || curY > span.endY) break;
      endIdx++;
      if (span.closed && curY === span.endY) break;
    }
    return { element: renderFencedCodeElement(textLines, startIdx, endIdx, span), endIdx };
  }

  const fence = parseFenceLine(text);
  if (!fence) return null;
  if (!(opts && opts.fencedCodeSpanStarts)
      && isLikelyCodeFenceBodyText(previousMeaningfulTextLine(textLines, startIdx))) {
    return null;
  }
  let endIdx = startIdx + 1;
  while (endIdx < textLines.length) {
    const curText = _t(textLines[endIdx]);
    endIdx++;
    if (isClosingFenceLine(curText, fence)) break;
  }
  return { element: renderFencedCodeElement(textLines, startIdx, endIdx, null), endIdx };
}

function renderLinesToContainer(textLines, container, promptLineChecker, tab, opts) {
  let i = 0;
  let foundContent = false;

  while (i < textLines.length) {
    const item = textLines[i];
    const text = typeof item === 'string' ? item : (item.text || '');

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

    const mathResult = tryParseDisplayMath(textLines, i, opts, tab, promptLineChecker);
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
  if (!tab || !tab.inlineImages || tab.inlineImages.length === 0) return;
  const relevant = tab.inlineImages.filter(img => img.lineY >= startY && img.lineY <= endY);
  if (relevant.length === 0) return;
  const lineEls = Array.from(container.querySelectorAll('.rline'));
  for (const img of relevant) {
    const wrap = document.createElement('div');
    wrap.className = 'inline-image';
    wrap.dataset.y = img.lineY;
    wrap.dataset.yEnd = img.lineY;
    const imgTag = document.createElement('img');
    imgTag.src = img.dataUrl;
    imgTag.alt = img.params.name || 'image';
    if (img.params.width) imgTag.style.width = img.params.width;
    if (img.params.height) imgTag.style.height = img.params.height;
    if (img.params.preserveAspectRatio === '1') imgTag.style.objectFit = 'contain';
    wrap.appendChild(imgTag);
    let inserted = false;
    for (const lineEl of lineEls) {
      const lineY = parseInt(lineEl.dataset.y);
      if (!isNaN(lineY) && lineY > img.lineY) {
        container.insertBefore(wrap, lineEl);
        inserted = true;
        break;
      }
    }
    if (!inserted) container.appendChild(wrap);
  }
}

function tokenizeInlineMarkdownText(text, tokens) {
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const isStrong = text[i] === '*' && text[i + 1] === '*';
    const isEm = text[i] === '*' && text[i + 1] !== '*' && text[i - 1] !== '*';
    if (!isStrong && !isEm) {
      i++;
      continue;
    }
    if (i > start) tokens.push({ type: 'text', content: text.slice(start, i) });
    if (isStrong) {
      tokens.push({ type: 'marker', kind: 'strong', raw: '**' });
      i += 2;
    } else {
      tokens.push({ type: 'marker', kind: 'em', raw: '*' });
      i++;
    }
    start = i;
  }
  if (start < text.length) tokens.push({ type: 'text', content: text.slice(start) });
}

function inlineRenderTokens(parts) {
  const tokens = [];
  for (const part of parts) {
    if (part.type === 'text') {
      tokenizeInlineMarkdownText(part.content, tokens);
    } else {
      tokens.push(part);
    }
  }

  const open = { strong: [], em: [] };
  for (const token of tokens) {
    if (token.type !== 'marker') continue;
    const stack = open[token.kind];
    if (stack.length > 0) {
      const opener = stack.pop();
      opener.action = 'open';
      token.action = 'close';
    } else {
      stack.push(token);
    }
  }
  for (const kind of Object.keys(open)) {
    for (const token of open[kind]) {
      token.type = 'text';
      token.content = token.raw;
    }
  }
  return tokens;
}

function appendInlineToken(token, el, stack, opts) {
  const parent = stack.length ? stack[stack.length - 1].node : el;
  if (token.type === 'marker') {
    if (token.action === 'open') {
      const node = document.createElement(token.kind);
      parent.appendChild(node);
      stack.push({ kind: token.kind, node });
    } else if (token.action === 'close') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === token.kind) {
          stack.length = i;
          break;
        }
      }
    } else {
      parent.appendChild(document.createTextNode(token.raw));
    }
    return;
  }
  if (token.type === 'code') {
    const code = document.createElement('code');
    code.textContent = token.content;
    parent.appendChild(code);
  } else if (token.type === 'inline' && token.closed) {
    const span = document.createElement('span');
    queueKatex(token.content, span, false, opts);
    parent.appendChild(span);
  } else if (token.type === 'display' && token.closed) {
    const span = document.createElement('span');
    span.className = 'display-math';
    queueKatex(token.content, span, true, opts);
    parent.appendChild(span);
  } else if (!token.closed && token.type !== 'text') {
    const span = document.createElement('span');
    span.className = 'latex-pending';
    span.textContent = token.raw;
    parent.appendChild(span);
  } else {
    parent.appendChild(document.createTextNode(token.content));
  }
}

function renderInlineLatexToEl(text, el, opts) {
  const tokens = inlineRenderTokens(splitLatexSmart(text));
  const stack = [];
  for (const token of tokens) appendInlineToken(token, el, stack, opts);
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

function resetRichSearchSnapshotState(pane, { close = false } = {}) {
  if (!pane) return;
  try { require('./search').clearRichSearchHighlights(pane); } catch {}
  pane.richSearchMatches = [];
  pane.richSearchIndex = -1;
  pane.richSearchCountText = '';
  if (pane.richSearchNormalizeCache) pane.richSearchNormalizeCache.clear();
  if (close) pane.richSearchOpen = false;
}

function renderRichVirtualWindow(pane, targetY, anchor) {
  const v = pane.richVirtual;
  if (!v || !v.active) return;
  const buf = pane.term.buffer.active;

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
  const expandedEndY = displayMathRange.endY;

  pane._richRenderToken = (pane._richRenderToken | 0) + 1;
  const renderToken = pane._richRenderToken;
  v.renderToken = renderToken;

  const opts = {
    renderToken,
    displayMathSpanStarts: v.displayMathSpanStarts,
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
  renderLinesToContainer(textLines, v.windowEl, isPromptLine, pane, opts);
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
  tab.richView.focus();
  tab.term.blur();
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
  if (!tab.richVisible) return;
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
  }
  tab.term.focus();
}

function toggleMathMode() {
  const tab = getActivePane();
  if (!tab) return;
  if (tab.richVisible) tabHideRichView(tab);
  else showManualRichView(tab);
}

function tabResetSection(tab) {
  tab.sectionBuffer = '';
  tab.sectionHasLatex = false;
  tab.sectionStartY = 0;
  tab._sectionStartTime = 0;
  tab._sectionAltScreen = false;
  tab._sectionImageStart = tab.inlineImages ? tab.inlineImages.length : 0;
}

function tabFlushSection(tab) {
  if (tab._sectionAltScreen) { tabResetSection(tab); return; }
  // Flush only if this section actually accumulated something — new LaTeX
  // text or a new image. Old images carrying over from earlier sections
  // shouldn't trigger a re-render (which would clobber the rich view).
  const newImagesInSection = tab.inlineImages.length > (tab._sectionImageStart || 0);
  if (!tab.sectionHasLatex && !newImagesInSection) { tabResetSection(tab); return; }
  const buf = tab.term.buffer.active;
  const endY = buf.baseY + buf.cursorY;
  detachRichScrollListener(tab);
  tab._richRenderToken = (tab._richRenderToken | 0) + 1;
  resetRichSearchSnapshotState(tab, { close: true });
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
    const text = line.translateToString(true);
    if (!text.trim()) continue;
    if (isPromptLine(tab, text, y)) { startY = y; break; }
    break;
  }

  const textLines = collectBufferLines(buf, startY, endY);

  const foundContent = renderLinesToContainer(textLines, tab.richContent, isPromptLine, tab);
  if (foundContent) {
    insertImagesIntoContainer(tab.richContent, tab, startY, endY);
    tabShowRichView(tab, true);
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
    tab.sectionBuffer = tab.sectionBuffer.slice(-SECTION_BUFFER_MAX);
  }
  if (hasLatex(stripAnsi(tab.sectionBuffer))) tab.sectionHasLatex = true;
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
  const buf = pane.term.buffer.active;
  const sourceStartY = 0;
  const sourceEndY = buf.baseY + buf.cursorY;
  const viewportTopY = buf.viewportY;
  const cursorY = sourceEndY;
  const atLiveEdge = sourceEndY >= viewportTopY && sourceEndY <= viewportTopY + pane.term.rows - 1;
  const targetY = atLiveEdge ? cursorY : viewportTopY;

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
    (text, y) => isPromptLine(pane, text, y)
  );
  const displayMathSpans = computeDisplayMathSpans(
    buf, sourceStartY, sourceEndY,
    (text, y) => isPromptLine(pane, text, y),
    y => fencedCodeSpans.some(span => span.startY <= y && y <= span.endY)
  );
  pane.richVirtual = {
    active: true,
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
    fencedCodeSpans,
    fencedCodeSpanStarts: new Set(fencedCodeSpans.map(span => span.startY)),
    topSpacerEl: topSpacer,
    windowEl,
    bottomSpacerEl: bottomSpacer,
    renderToken: pane._richRenderToken
  };

  renderRichVirtualWindow(pane, targetY, null);

  const hasImages = pane.inlineImages && pane.inlineImages.length > 0;
  const hasRendered = windowEl.children.length > 0;
  if (!hasRendered && !hasImages) {
    pane.richVirtual.active = false;
    pane.richVirtual = null;
    pane.richContent.replaceChildren();
    return;
  }

  tabShowRichView(pane, false);

  requestAnimationFrame(() => {
    const v = pane.richVirtual;
    if (!v || !v.active) return;
    const target = findElementForY(windowEl, targetY)
      || findNearestElementForY(windowEl, targetY, atLiveEdge ? 'before' : 'after');
    if (target) {
      if (atLiveEdge) {
        pane.richView.scrollTop = Math.max(0,
          target.offsetTop + target.offsetHeight - pane.richView.clientHeight);
      } else {
        pane.richView.scrollTop = target.offsetTop;
      }
    } else {
      const estimatedTop = Math.max(0,
        (targetY - v.sourceStartY) * v.averageRowHeight);
      pane.richView.scrollTop = atLiveEdge
        ? pane.richView.scrollHeight : estimatedTop;
    }
    prioritizeKatexQueue(pane.richView);
    attachRichScrollListener(pane);
  });
}

async function drainKatexQueue() {
  let guard = 0;
  while (_katexQueue.length > 0 && guard < 600) {
    await new Promise(r => requestAnimationFrame(r));
    guard++;
  }
}

function swapInMaterializedRichView(pane) {
  const v = pane.richVirtual;
  if (!v || !v.active) return () => {};
  const buf = pane.term.buffer.active;
  const sourceStartY = v.sourceStartY;
  const sourceEndY = v.sourceEndY;
  const rowCount = Math.max(0, sourceEndY - sourceStartY + 1);
  if (rowCount > RICH_VIRTUAL_EXPORT_MAX_ROWS) {
    throw new Error(
      `Math view is too large to export (${rowCount} rows; limit ${RICH_VIRTUAL_EXPORT_MAX_ROWS}). `
      + `Reduce the scrollback or export a smaller range.`);
  }

  if (pane._richScrollRaf) {
    cancelAnimationFrame(pane._richScrollRaf);
    pane._richScrollRaf = 0;
  }
  const savedListener = pane._richScrollListener;
  if (savedListener) {
    pane.richView.removeEventListener('scroll', savedListener);
  }
  const savedScrollTop = pane.richView.scrollTop;
  const savedChildren = Array.from(pane.richContent.childNodes);

  pane._richRenderToken = (pane._richRenderToken | 0) + 1;
  pane.richContent.replaceChildren();
  if (rowCount > 0) {
    const textLines = collectBufferLines(buf, sourceStartY, sourceEndY);
    renderLinesToContainer(
      textLines, pane.richContent, isPromptLine, pane, displayMathRenderOptsForPane(pane)
    );
    insertImagesIntoContainer(pane.richContent, pane, sourceStartY, sourceEndY);
  }

  return function restore() {
    pane._richRenderToken = (pane._richRenderToken | 0) + 1;
    pane.richContent.replaceChildren();
    for (const c of savedChildren) pane.richContent.appendChild(c);
    pane.richView.scrollTop = savedScrollTop;
    if (savedListener && pane.richVirtual && pane.richVirtual.active) {
      pane._richScrollListener = savedListener;
      pane.richView.addEventListener('scroll', savedListener, { passive: true });
    }
  };
}

function materializeFullRichView(pane) {
  const buf = pane.term.buffer.active;
  const v = pane.richVirtual;
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
      textLines, content, isPromptLine, pane, displayMathRenderOptsForPane(pane)
    );
    insertImagesIntoContainer(content, pane, sourceStartY, sourceEndY);
  }

  return { container, content };
}

function renderFileContent(tab, content, filePath) {
  detachRichScrollListener(tab);
  tab._richRenderToken = (tab._richRenderToken | 0) + 1;
  resetRichSearchSnapshotState(tab, { close: true });
  if (tab.richVirtual) {
    tab.richVirtual.active = false;
    tab.richVirtual = null;
  }
  tab.richContent.innerHTML = '';
  const isMd = filePath && /\.md$/i.test(filePath);
  let shown = false;
  if (isMd) {
    renderMarkdownFile(content, tab.richContent);
    tabShowRichView(tab, false);
    shown = true;
  } else {
    const lines = content.split('\n');
    const foundContent = renderLinesToContainer(lines, tab.richContent, null, null);
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
  materializeFullRichView, swapInMaterializedRichView, drainKatexQueue,
  SECTION_BUFFER_MAX, SECTION_ELAPSED_MAX,
  // Helpers exported for unit tests
  clampRowRange, scrollTopToRow, computeSpacerHeights,
  applyHeightSmoothing, coerceRenderToken,
  computeDisplayMathSpans, expandRangeForDisplayMathSpans,
  RICH_VIRTUAL_OVERSCAN_ROWS, RICH_VIRTUAL_MAX_RENDERED_ROWS,
  RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS, RICH_VIRTUAL_EXPORT_MAX_ROWS,
  findElementForY
};
