function bufferLineToLayoutText(line) {
  return line && typeof line.translateToString === 'function'
    ? line.translateToString(true)
    : '';
}

function isNulChars(chars) {
  return chars && chars.length === 1 && chars.charCodeAt(0) === 0;
}

function bufferLineToSemanticText(line) {
  if (!line) return '';
  if (typeof line.getCell !== 'function' || !Number.isFinite(Number(line.length))) {
    return bufferLineToLayoutText(line);
  }
  const cols = Number(line.length) || 0;
  let reusableCell = null;
  try { reusableCell = line.getCell(0); } catch { reusableCell = null; }
  if (!reusableCell) return '';

  let text = '';
  for (let x = 0; x < cols; x++) {
    let cell;
    try { cell = line.getCell(x, reusableCell); } catch { cell = null; }
    if (!cell) break;
    const width = typeof cell.getWidth === 'function' ? cell.getWidth() : null;
    if (width === 0) continue;
    const chars = typeof cell.getChars === 'function' ? cell.getChars() : '';
    text += !chars || isNulChars(chars) ? ' ' : chars;
  }
  return text.trimEnd();
}

function bufferLineToSemanticTextPreserveSpaces(line) {
  if (!line) return '';
  if (typeof line.getCell !== 'function' || !Number.isFinite(Number(line.length))) {
    return typeof line.translateToString === 'function' ? line.translateToString(false) : '';
  }
  const cols = Number(line.length) || 0;
  let reusableCell = null;
  try { reusableCell = line.getCell(0); } catch { reusableCell = null; }
  if (!reusableCell) return '';

  let text = '';
  let contentEnd = 0;
  for (let x = 0; x < cols; x++) {
    let cell;
    try { cell = line.getCell(x, reusableCell); } catch { cell = null; }
    if (!cell) break;
    const width = typeof cell.getWidth === 'function' ? cell.getWidth() : null;
    if (width === 0) continue;
    const chars = typeof cell.getChars === 'function' ? cell.getChars() : '';
    const isPadding = !chars || isNulChars(chars);
    text += isPadding ? ' ' : chars;
    if (!isPadding) contentEnd = text.length;
  }
  return text.slice(0, contentEnd);
}

module.exports = {
  bufferLineToLayoutText,
  bufferLineToSemanticText,
  bufferLineToSemanticTextPreserveSpaces
};
