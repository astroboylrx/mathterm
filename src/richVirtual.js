// Pure helpers used by the rich-view virtualization code in richView.js.
// Kept DOM-free so they can be unit-tested directly under node.

const RICH_VIRTUAL_OVERSCAN_ROWS = 80;
const RICH_VIRTUAL_MAX_RENDERED_ROWS = 320;
const RICH_VIRTUAL_STRUCTURE_BACKSCAN_ROWS = 50;
const RICH_VIRTUAL_HEIGHT_SMOOTHING = 0.2;
const RICH_VIRTUAL_DEFAULT_LINE_HEIGHT = 24;
const RICH_VIRTUAL_EXPORT_MAX_ROWS = 50000;

function clampRowRange(targetY, sourceStartY, sourceEndY, overscanRows, maxRenderedRows) {
  if (sourceEndY < sourceStartY) {
    return { startY: sourceStartY, endY: sourceStartY - 1 };
  }
  const totalRows = sourceEndY - sourceStartY + 1;
  const window = Math.min(maxRenderedRows, totalRows);
  let startY = Math.max(sourceStartY, targetY - overscanRows);
  if (startY + window - 1 > sourceEndY) startY = sourceEndY - window + 1;
  if (startY < sourceStartY) startY = sourceStartY;
  const endY = Math.min(sourceEndY, startY + window - 1);
  return { startY, endY };
}

function scrollTopToRow(scrollTop, sourceStartY, averageRowHeight) {
  if (!Number.isFinite(averageRowHeight) || averageRowHeight <= 0) return sourceStartY;
  return sourceStartY + Math.floor(Math.max(0, scrollTop) / averageRowHeight);
}

function computeSpacerHeights(sourceStartY, sourceEndY, renderedStartY, renderedEndY, averageRowHeight) {
  const ah = Number.isFinite(averageRowHeight) && averageRowHeight > 0
    ? averageRowHeight : RICH_VIRTUAL_DEFAULT_LINE_HEIGHT;
  const topRows = Math.max(0, renderedStartY - sourceStartY);
  const bottomRows = Math.max(0, sourceEndY - renderedEndY);
  return { top: topRows * ah, bottom: bottomRows * ah };
}

function applyHeightSmoothing(prev, measured, alpha) {
  if (!Number.isFinite(measured) || measured <= 0) return prev;
  if (!Number.isFinite(prev) || prev <= 0) return measured;
  return prev + alpha * (measured - prev);
}

function coerceRenderToken(token) {
  if (token == null) return null;
  return String(token);
}

function lineInfo(buf, y) {
  let line;
  try { line = buf.getLine(y); } catch { return null; }
  if (!line) return null;
  const text = line.translateToString(true);
  return { y, isWrapped: !!line.isWrapped, text, trimmed: text.trim() };
}

function isTableStructureLine(trimmed) {
  return /^[┌┬┐└┴┘├┼┤─━\s]+$/.test(trimmed)
    || /^[│┃]/.test(trimmed)
    || (/^\|/.test(trimmed) && /\|$/.test(trimmed));
}

function parseFenceLine(text) {
  const match = String(text || '').match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const marker = match[1];
  return { char: marker[0], length: marker.length };
}

function isClosingFenceLine(text, fence) {
  if (!fence) return false;
  const raw = String(text || '');
  const leading = raw.match(/^ */)[0].length;
  if (leading > 3) return false;
  const trimmed = raw.trim();
  if (trimmed.length < fence.length) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== fence.char) return false;
  }
  return true;
}

function isLikelyCodeFenceBodyText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^(`{3,}|~{3,})/.test(trimmed)) return false;
  if (/^(#{1,6}\s|>\s|[-*]\s|\d+\.\s|\|)/.test(trimmed)) return false;
  if (/[{};]/.test(trimmed)) return true;
  if (/(=>|==|!=|<=|>=|&&|\|\||::)/.test(trimmed)) return true;
  if (/\$\(|\$\{|`/.test(trimmed)) return true;
  if (/^\s{4,}/.test(String(text || ''))) return true;
  if (/^(const|let|var|function|return|if|else|for|while|class|def|import|from|echo|export|cd|git|npm|python|node|cargo|make)\b/.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z_][A-Za-z0-9_ .-]*\s*=/.test(trimmed)) return true;
  return false;
}

function isLikelyDisplayMathBodyText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || trimmed === '$$') return false;
  if (/^[#>|-]|\|/.test(trimmed)) return false;
  if (/\s/.test(trimmed) && !/[\\_^=]/.test(trimmed)) return false;
  return /[\\_^=]/.test(trimmed);
}

function previousMeaningfulLineInfo(buf, fromY, stopY) {
  for (let y = fromY; y >= stopY; y--) {
    const info = lineInfo(buf, y);
    if (!info) break;
    if (!info.trimmed) continue;
    return info;
  }
  return null;
}

function findDisplayMathOpenInRange(buf, startY, stopY) {
  let openY = null;
  for (let y = stopY; y < startY; y++) {
    const info = lineInfo(buf, y);
    if (!info) continue;
    if (info.trimmed !== '$$') continue;
    openY = openY == null ? y : null;
  }
  return openY;
}

function findPreviousDisplayMathOpen(buf, fromY, stopY) {
  for (let y = fromY; y >= stopY; y--) {
    const info = lineInfo(buf, y);
    if (!info) break;
    if (info.trimmed === '$$') return y;
  }
  return null;
}

function computeDisplayMathSpans(buf, sourceStartY, sourceEndY, isBoundaryLine, isIgnoredLine) {
  const spans = [];
  let openY = null;
  for (let y = sourceStartY; y <= sourceEndY; y++) {
    const info = lineInfo(buf, y);
    if (!info) continue;
    if (isIgnoredLine && isIgnoredLine(y)) {
      openY = null;
      continue;
    }
    if (openY != null && isBoundaryLine && isBoundaryLine(info.text, y)) {
      openY = null;
    }
    if (info.trimmed !== '$$') continue;
    if (openY == null) {
      const prev = previousMeaningfulLineInfo(buf, y - 1, sourceStartY);
      if (prev && isLikelyDisplayMathBodyText(prev.text)) continue;
      openY = y;
    } else {
      spans.push({ startY: openY, endY: y });
      openY = null;
    }
  }
  return spans;
}

function computeFencedCodeSpans(buf, sourceStartY, sourceEndY, isBoundaryLine) {
  const spans = [];
  let open = null;
  for (let y = sourceStartY; y <= sourceEndY; y++) {
    const info = lineInfo(buf, y);
    if (!info) continue;
    if (open) {
      if (isClosingFenceLine(info.text, open.fence)) {
        spans.push({ startY: open.startY, endY: y, closed: true, fence: open.fence });
        open = null;
      } else if (isBoundaryLine && isBoundaryLine(info.text, y)) {
        if (y > open.startY) {
          spans.push({ startY: open.startY, endY: y - 1, closed: false, fence: open.fence });
        }
        open = null;
      }
      continue;
    }
    const fence = parseFenceLine(info.text);
    if (fence) {
      const prev = previousMeaningfulLineInfo(buf, y - 1, sourceStartY);
      if (prev && isLikelyCodeFenceBodyText(prev.text)) continue;
      open = { startY: y, fence };
    }
  }
  if (open) {
    spans.push({ startY: open.startY, endY: sourceEndY, closed: false, fence: open.fence });
  }
  return spans;
}

function expandRangeForDisplayMathSpans(startY, endY, spans) {
  let expandedStartY = startY;
  let expandedEndY = endY;
  for (const span of spans || []) {
    if (!span || span.endY < expandedStartY || span.startY > expandedEndY) continue;
    expandedStartY = Math.min(expandedStartY, span.startY);
    expandedEndY = Math.max(expandedEndY, span.endY);
  }
  return { startY: expandedStartY, endY: expandedEndY };
}

// Expand the render start backward to cover the start of multi-line
// structures (display math, box tables, markdown tables, wrapped rows).
// `buf.getLine(y)` is expected to return either falsy (out of range) or
// `{ isWrapped, translateToString(trimRight) }`.
function expandStartForStructure(buf, startY, sourceStartY, maxBackscan) {
  let expanded = startY;
  const stopY = Math.max(sourceStartY, startY - maxBackscan);

  // If the window starts inside, or immediately after, a wrapped logical row,
  // include the row where that logical line began.
  for (let y = startY; y > stopY; y--) {
    const current = lineInfo(buf, y);
    if (!current || !current.isWrapped) break;
    expanded = y - 1;
  }
  for (let y = startY - 1; y >= stopY; y--) {
    const current = lineInfo(buf, y);
    if (!current) break;
    if (current.isWrapped) {
      expanded = y;
      continue;
    }
    const below = lineInfo(buf, y + 1);
    if (below && below.isWrapped) expanded = y;
    break;
  }

  // If startY lands inside a display-math block, include the opener. If it
  // lands immediately after a closing delimiter, include the whole block as
  // bounded context so the parser does not render a stray closing "$$".
  const openMathY = findDisplayMathOpenInRange(buf, startY, stopY);
  if (openMathY != null) {
    expanded = Math.min(expanded, openMathY);
  } else {
    const prev = lineInfo(buf, startY - 1);
    if (prev && prev.trimmed === '$$') {
      const opener = findPreviousDisplayMathOpen(buf, startY - 2, stopY);
      if (opener != null) expanded = Math.min(expanded, opener);
    }
  }

  // Expand over contiguous table-like rows.
  for (let y = startY - 1; y >= stopY; y--) {
    const current = lineInfo(buf, y);
    if (!current) break;
    if (isTableStructureLine(current.trimmed)) {
      expanded = y;
      continue;
    }
    break;
  }

  return expanded;
}

module.exports = {
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
};
