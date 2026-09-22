const { queueKatex } = require('./richKatexQueue');
const {
  isLikelyDisplayMathBodyText,
  matchDisplayMathOpen,
  matchDisplayMathClose,
  looksLikeDisplayMath,
  isLikelyCodeFenceBodyText,
  parseFenceLine,
  isClosingFenceLine
} = require('./richVirtual');

function _t(item) { return typeof item === 'string' ? item : (item.text || ''); }

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
    if (matchDisplayMathClose(text)) return sawBody;
    if (typeof item === 'object' && item.y !== undefined
        && pane && promptLineChecker && promptLineChecker(pane, text, item.y)
        && !isLikelyDisplayMathBodyText(text)) {
      return false;
    }
    // isLikelyDisplayMathBodyText rejects `|` and a leading `-`, both ordinary
    // in real formulas, so a plain LaTeX body counts here too.
    if (isLikelyDisplayMathBodyText(text) || looksLikeDisplayMath(text)) sawBody = true;
  }
  return false;
}

function tryParseDisplayMath(textLines, startIdx, opts, pane, promptLineChecker) {
  const startItem = textLines[startIdx];
  const text = typeof startItem === 'string' ? startItem : (startItem.text || '');
  const opener = matchDisplayMathOpen(text);
  if (!opener) return null;
  // `$$x$$` on one line stays with the inline renderer, as it always has.
  if (!opener.bare && matchDisplayMathClose(text)) return null;
  if (opts && opts.displayMathSpanStarts
      && (typeof startItem !== 'object' || !opts.displayMathSpanStarts.has(startItem.y))) {
    return null;
  }
  if (opener.bare && !(opts && opts.displayMathSpanStarts)
      && isLikelyDisplayMathBodyText(previousMeaningfulTextLine(textLines, startIdx))
      && !hasDisplayMathCloseAheadInLines(textLines, startIdx, pane, promptLineChecker)) {
    return null;
  }

  let j = startIdx + 1;
  let mathLines = opener.bare ? [] : [opener.rest.trimEnd()];
  while (j < textLines.length) {
    const item = textLines[j];
    const t = typeof item === 'string' ? item : (item.text || '');
    // An unclosed $$ shouldn't swallow shell prompts or command output.
    // A real prompt line is a hard command boundary, so bail and let the $$
    // render as literal text. If prompt tracking falsely tags a math body row,
    // keep parsing so a valid display block still renders.
    const closer = matchDisplayMathClose(t);
    if (closer) {
      if (!closer.bare) mathLines.push(closer.prefix.trimEnd());
      const latex = mathLines.join('\n');
      // A delimiter carrying math is the relaxed form, and `$$` is also the
      // shell's pid and Make's escaped `$`, so that form has to read like math.
      // The bare-to-bare form is the long-standing one and is left alone.
      if (!(opener.bare && closer.bare) && !looksLikeDisplayMath(latex)) return null;
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
    // A loaded opener may not span a blank line, or two stray `$$` in ordinary
    // output merge across the text between them.
    if (!opener.bare && !t.trim()) return null;
    if (typeof item === 'object' && item.y !== undefined
        && pane && promptLineChecker && promptLineChecker(pane, t, item.y)
        && !isLikelyDisplayMathBodyText(t)) {
      return null;
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

module.exports = {
  tryParseDisplayMath,
  tryParseFencedCodeBlock,
  tagSpan,
  previousMeaningfulTextLine,
  hasDisplayMathCloseAheadInLines,
  findFencedCodeSpanForY,
  renderFencedCodeElement
};
