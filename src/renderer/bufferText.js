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

function collectLogicalBufferLines(buf, startY, endY) {
  const raw = [];
  for (let y = startY; y <= endY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { continue; }
    if (!line) continue;
    raw.push({ _line: line, y, wrapped: !!line.isWrapped });
  }

  const textLines = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    // A real space in the final column separates TeX control words from the
    // next wrapped segment. Preserve it, while still dropping blank padding at
    // the end of a completed logical line.
    const continues = i + 1 < raw.length && raw[i + 1].wrapped;
    const text = continues
      ? bufferLineToSemanticTextPreserveSpaces(item._line)
      : bufferLineToSemanticText(item._line);
    if (item.wrapped && textLines.length > 0) {
      const prev = textLines[textLines.length - 1];
      prev.text += text;
      prev.joined = true;
      prev.yEnd = item.y;
    } else {
      textLines.push({ text, _line: item._line, y: item.y, yEnd: item.y });
    }
  }
  return textLines;
}

module.exports = {
  bufferLineToLayoutText,
  bufferLineToSemanticText,
  bufferLineToSemanticTextPreserveSpaces,
  collectLogicalBufferLines
};
