// Glue between displayMathModel (which labels logical lines) and the rich view
// (which renders buffer rows): row spans for the virtual view, line spans for
// directly rendered lists, and the LaTeX a block's lines carry.

const { collectLogicalBufferLines } = require('./bufferText');
const { parseFenceLine, isClosingFenceLine } = require('./richVirtual');
const { detectDisplayMathSpans } = require('./displayMathModel');

function fencedLineMask(texts) {
  const mask = new Array(texts.length).fill(false);
  let fence = null;
  for (let i = 0; i < texts.length; i++) {
    if (fence) {
      mask[i] = true;
      if (isClosingFenceLine(texts[i], fence)) fence = null;
      continue;
    }
    const opened = parseFenceLine(texts[i]);
    if (opened) {
      fence = opened;
      mask[i] = true;
    }
  }
  return mask;
}

// A one-line `$$x$$` or `\[x\]` stays with the inline renderer, which already
// draws it and keeps the line's markdown context (a blockquote, a list item).
// A one-line bare \begin{..}...\end{..} has no other renderer, so it is kept.
function keepSpan(texts, span) {
  if (span.start !== span.end) return true;
  const t = texts[span.start];
  return !t.includes('$$') && !t.includes('\\[');
}

function describe(span) {
  const first = span.tags[0];
  const last = span.tags[span.tags.length - 1];
  return {
    // the view starts past the block's opener / stops before its closer
    partialStart: first === 'I' || first === 'E',
    partialEnd: last === 'B' || last === 'I',
    tags: span.tags.join('')
  };
}

// Directly rendered lists (a command's output section, an opened file).
// items: strings or { text, y } logical lines. Returns [{ start, end, ... }].
function modelBlocksForLines(items, isPromptIdx = () => false) {
  const texts = items.map(it => (typeof it === 'string' ? it : (it.text || '')));
  const fenced = fencedLineMask(texts);
  return detectDisplayMathSpans(texts, { isPrompt: isPromptIdx, isForcedOutside: i => fenced[i] })
    .filter(span => keepSpan(texts, span))
    .map(span => ({ start: span.start, end: span.end, ...describe(span) }));
}

// The virtual view: decide once over the whole source, in buffer rows, so a
// window that opens mid-block can still find where the block began.
function computeModelDisplayMathSpans(buf, sourceStartY, sourceEndY, isPromptY, isIgnoredY) {
  const lines = collectLogicalBufferLines(buf, sourceStartY, sourceEndY);
  const texts = lines.map(l => l.text || '');
  const spans = detectDisplayMathSpans(texts, {
    isPrompt: i => !!(isPromptY && isPromptY(texts[i], lines[i].y)),
    isForcedOutside: i => !!(isIgnoredY && isIgnoredY(lines[i].y))
  });
  return {
    texts,
    lines,
    raw: spans,
    spans: spans
      .filter(span => keepSpan(texts, span))
      .map(span => ({
        startY: lines[span.start].y,
        endY: lines[span.end].yEnd !== undefined ? lines[span.end].yEnd : lines[span.end].y,
        ...describe(span)
      }))
  };
}

const MARKER_ONLY_RE = /^\s*(?:#{1,6}|>|[-*+]|\d+[.)])?\s*$/;

function firstIndexOfAny(s, needles) {
  let best = -1;
  for (const n of needles) {
    const i = s.indexOf(n);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

function lastIndexOfAny(s, needles) {
  let best = -1;
  for (const n of needles) best = Math.max(best, s.lastIndexOf(n));
  return best;
}

// Split a block's lines into the LaTeX to render and any prose sharing its
// first or last line ("where $$\begin{aligned}", "\end{aligned}$$ so that").
// A delimiter is only stripped from a side whose opener/closer is in view: in
// a block the view entered part-way, a `$$` on the first line is its closer.
function splitBlockLatex(texts, { partialStart = false, partialEnd = false } = {}) {
  const lines = texts.slice();
  let prefix = '';
  let suffix = '';
  if (!partialStart) {
    const i = firstIndexOfAny(lines[0], ['$$', '\\[']);
    if (i !== -1) {
      prefix = lines[0].slice(0, i);
      lines[0] = lines[0].slice(i + 2);
    }
  }
  if (!partialEnd) {
    const k = lines.length - 1;
    const j = lastIndexOfAny(lines[k], ['$$', '\\]']);
    if (j !== -1) {
      suffix = lines[k].slice(j + 2);
      lines[k] = lines[k].slice(0, j);
    }
  }
  return {
    prefix: MARKER_ONLY_RE.test(prefix) ? '' : prefix.trim(),
    latex: lines.join('\n'),
    suffix: suffix.trim()
  };
}

module.exports = {
  fencedLineMask,
  modelBlocksForLines,
  computeModelDisplayMathSpans,
  splitBlockLatex
};
