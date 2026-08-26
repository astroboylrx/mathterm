const { bufferLineToSemanticTextPreserveSpaces } = require('./bufferText');

const PROMPT_SNAPSHOT_MAX_CHARS = 16 * 1024;
const PROMPT_TEXT_TOO_LARGE = Symbol('prompt-text-too-large');

function isPromptLine(tab, text, y) {
  if (y !== undefined && tab._promptYSet.has(y)) return true;
  return false;
}

function markerLine(marker) {
  if (!marker || marker.isDisposed || marker.line == null || marker.line < 0) return null;
  return marker.line;
}

function wrappedRangeForLine(buf, y) {
  if (!buf || !Number.isInteger(y) || y < 0) return null;
  try {
    const range = buf.getWrappedRangeForLine?.(y);
    if (range && Number.isInteger(range.first) && Number.isInteger(range.last)) {
      return { first: range.first, last: range.last };
    }
  } catch {}

  let line;
  try { line = buf.getLine(y); } catch { line = null; }
  if (!line) return null;

  let first = y;
  while (first > 0) {
    let current;
    try { current = buf.getLine(first); } catch { current = null; }
    if (!current?.isWrapped) break;
    first--;
  }

  let last = y;
  while (true) {
    let next;
    try { next = buf.getLine(last + 1); } catch { next = null; }
    if (!next?.isWrapped) break;
    last++;
  }
  return { first, last };
}

function promptMarkerTextRange(buf, entry) {
  const start = markerLine(entry?.start);
  const end = markerLine(entry?.end);
  if (start == null || end == null || end < start) return null;
  const firstRange = wrappedRangeForLine(buf, start);
  const lastRange = wrappedRangeForLine(buf, end);
  if (!firstRange || !lastRange) return null;
  return { first: firstRange.first, last: lastRange.last };
}

function normalizePromptLogicalLine(text) {
  return String(text || '').replace(/\s+/gu, ' ').trim();
}

function promptMarkerSemanticText(buf, entry) {
  const range = promptMarkerTextRange(buf, entry);
  if (!range) return null;

  const logicalLines = [];
  let current = '';
  let totalChars = 0;
  for (let y = range.first; y <= range.last; y++) {
    let line;
    try { line = buf.getLine(y); } catch { line = null; }
    if (!line) return null;
    const text = bufferLineToSemanticTextPreserveSpaces(line);
    if (y !== range.first && !line.isWrapped) {
      logicalLines.push(normalizePromptLogicalLine(current));
      current = '';
    }
    current += text;
    totalChars += text.length;
    if (totalChars > PROMPT_SNAPSHOT_MAX_CHARS) return PROMPT_TEXT_TOO_LARGE;
  }
  logicalLines.push(normalizePromptLogicalLine(current));
  const text = logicalLines.join('\n').trim();
  return text.length <= PROMPT_SNAPSHOT_MAX_CHARS ? text : PROMPT_TEXT_TOO_LARGE;
}

function capturePromptMarkerSnapshot(buf, entry) {
  const text = promptMarkerSemanticText(buf, entry);
  if (typeof text !== 'string' || !text) return false;
  entry.snapshotText = text;
  return true;
}

function promptMarkerSnapshotMatches(buf, entry) {
  if (!entry || typeof entry.snapshotText !== 'string') return true;
  const text = promptMarkerSemanticText(buf, entry);
  if (text === PROMPT_TEXT_TOO_LARGE) return false;
  return text == null || text === entry.snapshotText;
}

module.exports = {
  isPromptLine,
  markerLine,
  wrappedRangeForLine,
  promptMarkerTextRange,
  promptMarkerSemanticText,
  capturePromptMarkerSnapshot,
  promptMarkerSnapshotMatches,
  PROMPT_SNAPSHOT_MAX_CHARS
};
