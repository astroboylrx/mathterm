const assert = require('assert');
const {
  normalizeMathSearchText,
  collectRichSearchMatches
} = require('../src/renderer/mathSearch');

function lines(...text) {
  return text.map((line, y) => ({ y, text: line }));
}

function spans(matches) {
  return matches.map(m => ({ y: m.y, col: m.col, length: m.length, text: m.text }));
}

function testRawSearchFindsLiteralText() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('Alpha beta'), 'alpha')), [
    { y: 0, col: 0, length: 5, text: 'Alpha' }
  ]);
}

function testLiteralLatexAndUnicode() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\alpha'), '\\alpha')), [
    { y: 0, col: 0, length: 6, text: '\\alpha' }
  ]);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('α'), 'α')), [
    { y: 0, col: 0, length: 1, text: 'α' }
  ]);
}

function testSymbolSearchCouplesLatexAndUnicode() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\alpha and α'), '\\alpha')), [
    { y: 0, col: 0, length: 6, text: '\\alpha' },
    { y: 0, col: 11, length: 1, text: 'α' }
  ]);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\alpha and α'), 'α')), [
    { y: 0, col: 0, length: 6, text: '\\alpha' },
    { y: 0, col: 11, length: 1, text: 'α' }
  ]);
}

function testSymbolSearchDisabledIsLiteralOnly() {
  assert.deepStrictEqual(
    spans(collectRichSearchMatches(lines('\\alpha and α'), '\\alpha', { mathSymbolSearch: false })),
    [{ y: 0, col: 0, length: 6, text: '\\alpha' }]
  );
  assert.deepStrictEqual(
    spans(collectRichSearchMatches(lines('\\alpha and α'), 'α', { mathSymbolSearch: false })),
    [{ y: 0, col: 11, length: 1, text: 'α' }]
  );
}

function testDeduplicationAndSpanMapping() {
  const matches = collectRichSearchMatches(lines('\\alpha α'), 'α');
  assert.deepStrictEqual(spans(matches), [
    { y: 0, col: 0, length: 6, text: '\\alpha' },
    { y: 0, col: 7, length: 1, text: 'α' }
  ]);
  assert.strictEqual(matches[0].normalized, 'α');
  assert.strictEqual(matches.length, 2);
}

function testMultipleMatchesSortedByColumn() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('x α y \\alpha'), 'α')), [
    { y: 0, col: 2, length: 1, text: 'α' },
    { y: 0, col: 6, length: 6, text: '\\alpha' }
  ]);
}

function testUppercaseAndBoundaryHandling() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\Delta Δ'), 'Δ')), [
    { y: 0, col: 0, length: 6, text: '\\Delta' },
    { y: 0, col: 7, length: 1, text: 'Δ' }
  ]);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\alphabet α'), '\\alpha')), [
    { y: 0, col: 10, length: 1, text: 'α' }
  ]);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\alpha alpha'), 'alpha')), [
    { y: 0, col: 7, length: 5, text: 'alpha' }
  ]);
}

function testCaseSensitiveNormalizedMatching() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\Delta Δ'), '\\delta')), []);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\delta δ'), 'Δ')), []);
}

function testVariants() {
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\varepsilon \\varphi'), 'ε')), [
    { y: 0, col: 0, length: 11, text: '\\varepsilon' }
  ]);
  assert.deepStrictEqual(spans(collectRichSearchMatches(lines('\\varepsilon \\varphi'), 'φ')), [
    { y: 0, col: 12, length: 7, text: '\\varphi' }
  ]);
}

function testNormalizeMap() {
  assert.deepStrictEqual(normalizeMathSearchText('\\alpha + α'), {
    normalizedText: 'α + α',
    map: [
      { col: 0, length: 6 },
      { col: 6, length: 1 },
      { col: 7, length: 1 },
      { col: 8, length: 1 },
      { col: 9, length: 1 }
    ]
  });
}

function run() {
  testRawSearchFindsLiteralText();
  testLiteralLatexAndUnicode();
  testSymbolSearchCouplesLatexAndUnicode();
  testSymbolSearchDisabledIsLiteralOnly();
  testDeduplicationAndSpanMapping();
  testMultipleMatchesSortedByColumn();
  testUppercaseAndBoundaryHandling();
  testCaseSensitiveNormalizedMatching();
  testVariants();
  testNormalizeMap();
  console.log('math search tests passed');
}

run();
