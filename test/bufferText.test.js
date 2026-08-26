const assert = require('assert');
const {
  bufferLineToLayoutText,
  bufferLineToSemanticText,
  bufferLineToSemanticTextPreserveSpaces,
  collectLogicalBufferLines
} = require('../src/renderer/bufferText');

function cell(chars, width = 1) {
  return {
    getChars: () => chars,
    getWidth: () => width
  };
}

function line(cells, layoutText = null) {
  return {
    length: cells.length,
    getCell: (x) => cells[x] || null,
    translateToString: () => layoutText == null
      ? cells.map(c => c.getChars() || ' ').join('').trimEnd()
      : layoutText
  };
}

function wide(ch) {
  return [cell(ch, 2), cell('', 0)];
}

function testWideCjkHasNoInsertedSpaces() {
  const l = line([...wide('中'), ...wide('文'), ...wide('测'), ...wide('试')], '中 文 测 试 ');
  assert.strictEqual(bufferLineToSemanticText(l), '中文测试');
}

function testMixedAsciiAndCjk() {
  const l = line([cell('A'), ...wide('中'), ...wide('文'), cell('B')], 'A中 文 B');
  assert.strictEqual(bufferLineToSemanticText(l), 'A中文B');
}

function testRealAsciiSpacesArePreserved() {
  const l = line([...wide('中'), cell(' '), cell('t'), cell('e'), cell('s'), cell('t'), cell(' '), ...wide('文')]);
  assert.strictEqual(bufferLineToSemanticText(l), '中 test 文');
}

function testRepeatedAsciiSpacesArePreserved() {
  const l = line([cell('A'), cell(''), cell(''), cell('B')]);
  assert.strictEqual(bufferLineToSemanticText(l), 'A  B');
}

function testFullWidthSpaceIsOneSemanticCharacter() {
  const l = line([cell('A'), ...wide('　'), cell('B')]);
  assert.strictEqual(bufferLineToSemanticText(l), 'A　B');
}

function testEmojiWideContinuationIsSkipped() {
  const l = line([...wide('🙂'), ...wide('🙂')]);
  assert.strictEqual(bufferLineToSemanticText(l), '🙂🙂');
}

function testRightPaddingIsTrimmed() {
  const l = line([cell('A'), cell(''), cell(''), cell('')]);
  assert.strictEqual(bufferLineToSemanticText(l), 'A');
}

function testLayoutTextKeepsTranslateToStringBehavior() {
  const l = line([...wide('中'), ...wide('文')], '中 文 ');
  assert.strictEqual(bufferLineToLayoutText(l), '中 文 ');
}

function testSnapshotTextPreservesExplicitTrailingSpacesOnly() {
  const l = line([cell('A'), cell(' '), cell(''), cell('')]);
  assert.strictEqual(bufferLineToSemanticTextPreserveSpaces(l), 'A ');
}

function asciiLine(text, isWrapped = false, padding = 0) {
  const result = line([
    ...Array.from(text, ch => cell(ch)),
    ...Array.from({ length: padding }, () => cell(''))
  ]);
  result.isWrapped = isWrapped;
  return result;
}

function testWrappedLatexControlWordSeparatorsArePreserved() {
  const lines = [
    asciiLine('$2\\Omega \\eta ', false),
    asciiLine('v_{\\rm ', true),
    asciiLine('g}$', true, 4)
  ];
  const logical = collectLogicalBufferLines({ getLine: y => lines[y] }, 0, 2);
  assert.strictEqual(logical.length, 1);
  assert.strictEqual(logical[0].text, '$2\\Omega \\eta v_{\\rm g}$');
  assert.strictEqual(logical[0].y, 0);
  assert.strictEqual(logical[0].yEnd, 2);
  assert.strictEqual(logical[0].joined, true);
}

testWideCjkHasNoInsertedSpaces();
testMixedAsciiAndCjk();
testRealAsciiSpacesArePreserved();
testRepeatedAsciiSpacesArePreserved();
testFullWidthSpaceIsOneSemanticCharacter();
testEmojiWideContinuationIsSkipped();
testRightPaddingIsTrimmed();
testLayoutTextKeepsTranslateToStringBehavior();
testSnapshotTextPreservesExplicitTrailingSpacesOnly();
testWrappedLatexControlWordSeparatorsArePreserved();

console.log('bufferText tests passed');
