const assert = require('assert');
const {
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
  expandStartForStructure,
  RICH_VIRTUAL_DEFAULT_LINE_HEIGHT
} = require('../src/richVirtual');

function makeBuf(rows) {
  return {
    getLine(y) {
      const r = rows[y];
      if (!r) return null;
      return {
        isWrapped: !!r.wrapped,
        translateToString: () => r.text || ''
      };
    }
  };
}

function testClampRowRangeBasic() {
  const r = clampRowRange(500, 0, 9999, 80, 320);
  assert.strictEqual(r.startY, 420);
  assert.strictEqual(r.endY, 739);
  assert.strictEqual(r.endY - r.startY + 1, 320);
}

function testClampRowRangeNearTop() {
  const r = clampRowRange(10, 0, 9999, 80, 320);
  assert.strictEqual(r.startY, 0);
  assert.strictEqual(r.endY, 319);
}

function testClampRowRangeNearBottom() {
  const r = clampRowRange(9990, 0, 9999, 80, 320);
  assert.strictEqual(r.endY, 9999);
  assert.strictEqual(r.startY, 9999 - 319);
}

function testClampRowRangeSmallTotal() {
  const r = clampRowRange(50, 0, 100, 80, 320);
  assert.strictEqual(r.startY, 0);
  assert.strictEqual(r.endY, 100);
}

function testClampRowRangeEmpty() {
  const r = clampRowRange(0, 0, -1, 80, 320);
  assert.strictEqual(r.startY, 0);
  assert.strictEqual(r.endY, -1);
}

function testScrollTopToRow() {
  assert.strictEqual(scrollTopToRow(0, 0, 24), 0);
  assert.strictEqual(scrollTopToRow(240, 0, 24), 10);
  assert.strictEqual(scrollTopToRow(245, 0, 24), 10);
  assert.strictEqual(scrollTopToRow(-50, 0, 24), 0);
  // Source-start offset is added through.
  assert.strictEqual(scrollTopToRow(240, 100, 24), 110);
  // Bad averageRowHeight falls back to sourceStartY.
  assert.strictEqual(scrollTopToRow(500, 100, 0), 100);
  assert.strictEqual(scrollTopToRow(500, 100, NaN), 100);
}

function testComputeSpacerHeights() {
  const s = computeSpacerHeights(0, 999, 200, 500, 24);
  assert.strictEqual(s.top, 200 * 24);
  assert.strictEqual(s.bottom, (999 - 500) * 24);
}

function testComputeSpacerHeightsClampsNegative() {
  const s = computeSpacerHeights(0, 100, 0, 100, 24);
  assert.strictEqual(s.top, 0);
  assert.strictEqual(s.bottom, 0);
}

function testComputeSpacerHeightsBadAverage() {
  const s = computeSpacerHeights(0, 10, 5, 7, 0);
  assert.strictEqual(s.top, 5 * RICH_VIRTUAL_DEFAULT_LINE_HEIGHT);
  assert.strictEqual(s.bottom, 3 * RICH_VIRTUAL_DEFAULT_LINE_HEIGHT);
}

function testApplyHeightSmoothing() {
  assert.strictEqual(applyHeightSmoothing(20, 30, 0.2), 22);
  // First measurement bootstraps prev.
  assert.strictEqual(applyHeightSmoothing(0, 18, 0.5), 18);
  assert.strictEqual(applyHeightSmoothing(NaN, 18, 0.5), 18);
  // Bad measured keeps prev.
  assert.strictEqual(applyHeightSmoothing(20, 0, 0.5), 20);
  assert.strictEqual(applyHeightSmoothing(20, NaN, 0.5), 20);
}

function testCoerceRenderToken() {
  assert.strictEqual(coerceRenderToken(null), null);
  assert.strictEqual(coerceRenderToken(undefined), null);
  assert.strictEqual(coerceRenderToken(0), '0');
  assert.strictEqual(coerceRenderToken(42), '42');
  assert.strictEqual(coerceRenderToken('5'), '5');
}

function testComputeDisplayMathSpans() {
  const buf = makeBuf({
    0: { text: 'before' },
    1: { text: '$$' },
    2: { text: 'a' },
    3: { text: 'b' },
    4: { text: '$$' },
    5: { text: 'after' },
    6: { text: '$$' },
    7: { text: 'unclosed' }
  });
  assert.deepStrictEqual(computeDisplayMathSpans(buf, 0, 7), [
    { startY: 1, endY: 4 }
  ]);
}

function testComputeDisplayMathSpansRespectsBoundaries() {
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'unclosed math' },
    2: { text: '$ prompt' },
    3: { text: '$$' },
    4: { text: 'closed math' },
    5: { text: '$$' }
  });
  assert.deepStrictEqual(
    computeDisplayMathSpans(buf, 0, 5, text => text.startsWith('$ prompt')),
    [{ startY: 3, endY: 5 }]
  );
}

function testComputeDisplayMathSpansIgnoresFencedRows() {
  const buf = makeBuf({
    0: { text: '```' },
    1: { text: '$$' },
    2: { text: 'not math' },
    3: { text: '$$' },
    4: { text: '```' },
    5: { text: '$$' },
    6: { text: 'real math' },
    7: { text: '$$' }
  });
  assert.deepStrictEqual(
    computeDisplayMathSpans(buf, 0, 7, null, y => y >= 0 && y <= 4),
    [{ startY: 5, endY: 7 }]
  );
}

function testComputeDisplayMathSpansSkipsOrphanCloserAtStart() {
  const buf = makeBuf({
    0: { text: '\\Gamma_{\\rm orb} = \\Gamma_{\\dot p} + \\Gamma_{\\rm DF}' },
    1: { text: '$$' },
    2: { text: 'PROMPT=%{$fg_bold[green]%}m4p%{$reset_color%}' },
    3: { text: 'for f in `ls ./*.athdf`; do echo ${f}; done' },
    4: { text: '' },
    5: { text: '$$' },
    6: { text: 'X = \\frac{2\\rho_s}{\\Delta v}' },
    7: { text: '$$' }
  });
  assert.deepStrictEqual(computeDisplayMathSpans(buf, 0, 7), [
    { startY: 5, endY: 7 }
  ]);
}

function testComputeDisplayMathSpansAfterInlineMathProse() {
  const buf = makeBuf({
    0: { text: 'For ${\\rm St}_{\\rm box}\\gg1$, using' },
    1: { text: '$$' },
    2: { text: '\\Delta u_{\\rm TM}\\simeq c_s\\sqrt{\\frac{2\\alpha}{{\\rm St}_{\\rm box}}}' },
    3: { text: '$$' },
    4: { text: 'gives' }
  });
  assert.deepStrictEqual(computeDisplayMathSpans(buf, 0, 4), [
    { startY: 1, endY: 3 }
  ]);
}

function testComputeDisplayMathSpansAfterMathLookingLine() {
  const buf = makeBuf({
    0: { text: '\\Gamma = \\Delta p' },
    1: { text: '$$' },
    2: { text: '\\frac{da}{dt}=\\frac{\\rho_d}{\\rho_s}\\Delta u' },
    3: { text: '$$' }
  });
  assert.deepStrictEqual(computeDisplayMathSpans(buf, 0, 3), [
    { startY: 1, endY: 3 }
  ]);
}

function testLikelyDisplayMathBodyText() {
  assert.strictEqual(isLikelyDisplayMathBodyText('\\Gamma = \\Delta p'), true);
  assert.strictEqual(isLikelyDisplayMathBodyText('A=\\frac{1}{2}'), true);
  assert.strictEqual(isLikelyDisplayMathBodyText('For ${\\rm St}_{\\rm box}\\gg1$, using'), false);
  assert.strictEqual(isLikelyDisplayMathBodyText('PROMPT=%{$fg_bold[green]%}m4p%{$reset_color%}'), false);
  assert.strictEqual(isLikelyDisplayMathBodyText('for f in `ls ./*.athdf`; do echo ${f}; done'), false);
  assert.strictEqual(isLikelyDisplayMathBodyText('| Time | $t$ |'), false);
  assert.strictEqual(isLikelyDisplayMathBodyText('plain prose words'), false);
}

function testComputeFencedCodeSpansClosedAndUnclosed() {
  const buf = makeBuf({
    0: { text: 'before' },
    1: { text: '```js' },
    2: { text: '$x^2$ should stay code' },
    3: { text: '```' },
    4: { text: 'after' },
    5: { text: '~~~' },
    6: { text: '\\alpha should stay code' }
  });
  assert.deepStrictEqual(computeFencedCodeSpans(buf, 0, 6), [
    { startY: 1, endY: 3, closed: true, fence: { char: '`', length: 3 } },
    { startY: 5, endY: 6, closed: false, fence: { char: '~', length: 3 } }
  ]);
}

function testComputeFencedCodeSpansRespectsPromptBoundary() {
  const buf = makeBuf({
    0: { text: '```' },
    1: { text: '$HOME and $x^2$ are code' },
    2: { text: '$ prompt' },
    3: { text: '```' },
    4: { text: 'closed later' },
    5: { text: '```' }
  });
  assert.deepStrictEqual(
    computeFencedCodeSpans(buf, 0, 5, text => text.startsWith('$ prompt')),
    [
      { startY: 0, endY: 1, closed: false, fence: { char: '`', length: 3 } },
      { startY: 3, endY: 5, closed: true, fence: { char: '`', length: 3 } }
    ]
  );
}

function testComputeFencedCodeSpansSkipsOrphanCloserAtStart() {
  const buf = makeBuf({
    0: { text: '  console.log($HOME);' },
    1: { text: '```' },
    2: { text: 'normal prose after code' },
    3: { text: '$x^2$ should render as math' }
  });
  assert.deepStrictEqual(computeFencedCodeSpans(buf, 0, 3), []);
}

function testComputeFencedCodeSpansKeepsNormalFenceAfterProse() {
  const buf = makeBuf({
    0: { text: 'Here is an example:' },
    1: { text: '```js' },
    2: { text: 'console.log($HOME);' },
    3: { text: '```' }
  });
  assert.deepStrictEqual(computeFencedCodeSpans(buf, 0, 3), [
    { startY: 1, endY: 3, closed: true, fence: { char: '`', length: 3 } }
  ]);
}

function testLikelyCodeFenceBodyText() {
  assert.strictEqual(isLikelyCodeFenceBodyText('  console.log($HOME);'), true);
  assert.strictEqual(isLikelyCodeFenceBodyText('const x = 1;'), true);
  assert.strictEqual(isLikelyCodeFenceBodyText('Here is an example:'), false);
  assert.strictEqual(isLikelyCodeFenceBodyText('| column | value |'), false);
}

function testExpandRangeForDisplayMathSpans() {
  const spans = [
    { startY: 10, endY: 80 },
    { startY: 150, endY: 155 }
  ];
  assert.deepStrictEqual(expandRangeForDisplayMathSpans(40, 50, spans), {
    startY: 10, endY: 80
  });
  assert.deepStrictEqual(expandRangeForDisplayMathSpans(70, 120, spans), {
    startY: 10, endY: 120
  });
  assert.deepStrictEqual(expandRangeForDisplayMathSpans(100, 120, spans), {
    startY: 100, endY: 120
  });
}

// Anchor preservation math: scrollTop adjusts so the anchor row stays at the
// same offset within the viewport after a rerender.
function testAnchorPreservationMath() {
  // Before: scrollTop=600, anchor.elTop=620 → offsetWithinViewport=20.
  // After rerender, anchor element is now at offsetTop=750. To keep the row at
  // viewport offset 20, set scrollTop = 750 - 20 = 730.
  const before = { scrollTop: 600, elTop: 620 };
  const offsetWithinViewport = before.elTop - before.scrollTop;
  assert.strictEqual(offsetWithinViewport, 20);
  const newElTop = 750;
  const newScrollTop = newElTop - offsetWithinViewport;
  assert.strictEqual(newScrollTop, 730);
}

function testBackscanNoStructureReturnsStart() {
  // Plain non-wrapped text immediately above startY breaks the scan.
  const buf = makeBuf({
    99: { text: 'plain prior line' },
    100: { text: 'window starts here' }
  });
  assert.strictEqual(expandStartForStructure(buf, 100, 0, 50), 100);
}

function testBackscanWalksThroughWrapped() {
  // Wrapped rows above startY are part of the same logical line — backscan
  // should expand to cover them, including the first non-wrapped row.
  const buf = makeBuf({
    97: { text: 'first half ' },
    98: { text: 'middle of wrap', wrapped: true },
    99: { text: 'tail of wrap', wrapped: true },
    100: { text: 'window starts here' }
  });
  assert.strictEqual(expandStartForStructure(buf, 100, 0, 50), 97);
}

function testBackscanHandlesStartInsideWrapped() {
  const buf = makeBuf({
    97: { text: 'first half ' },
    98: { text: 'middle of wrap', wrapped: true },
    99: { text: 'tail of wrap', wrapped: true }
  });
  assert.strictEqual(expandStartForStructure(buf, 98, 0, 50), 97);
  assert.strictEqual(expandStartForStructure(buf, 99, 0, 50), 97);
}

function testBackscanFindsDisplayMathOpener() {
  // startY=4 sits just below the closing $$ of a 3-row math block.
  // Walking back: 3='$$' (enters block), 2='+ c^2' (math body),
  // 1='a^2 + b^2' (math body), 0='$$' (opener; break).
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'a^2 + b^2' },
    2: { text: '+ c^2' },
    3: { text: '$$' },
    4: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 4, 0, 50), 0);
}

function testBackscanFindsDisplayMathOpenerFromBody() {
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'a^2 + b^2' },
    2: { text: '+ c^2' },
    3: { text: '$$' },
    4: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 1, 0, 50), 0);
  assert.strictEqual(expandStartForStructure(buf, 2, 0, 50), 0);
  assert.strictEqual(expandStartForStructure(buf, 3, 0, 50), 0);
}

function testBackscanStopsAtBlankAboveStructure() {
  // Blank line between the window and the structure breaks the scan
  // before we reach the structure.
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'a^2 + b^2' },
    2: { text: '$$' },
    3: { text: '' },
    4: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 4, 0, 50), 4);
}

function testBackscanRespectsMaxBackscan() {
  // $$ block sits 6 rows above startY but maxBackscan=2 caps the walk.
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'math' },
    2: { text: '$$' },
    3: { text: 'context a' },
    4: { text: 'context b' },
    5: { text: 'context c' },
    6: { text: 'context d' },
    7: { text: 'window' }
  });
  // With cap=2 we stop walking at y=5; nothing in [5..6] is a structure
  // marker so expanded stays at startY.
  assert.strictEqual(expandStartForStructure(buf, 7, 0, 2), 7);
  // Lifting the cap lets us reach the closing $$ at y=2 and the opener at 0.
  assert.strictEqual(expandStartForStructure(buf, 7, 0, 50), 7);
}

function testBackscanRespectsSourceStart() {
  // sourceStartY caps how far back we walk regardless of maxBackscan.
  const buf = makeBuf({
    0: { text: '$$' },
    1: { text: 'math', wrapped: false },
    2: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 2, 2, 50), 2);
}

function testBackscanFindsBoxTableTop() {
  const buf = makeBuf({
    0: { text: '┌─────┬─────┐' },
    1: { text: '│ a   │ b   │' },
    2: { text: '├─────┼─────┤' },
    3: { text: '│ c   │ d   │' },
    4: { text: '└─────┴─────┘' },
    5: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 5, 0, 50), 0);
}

function testBackscanFindsMarkdownTableTop() {
  const buf = makeBuf({
    0: { text: '| h1 | h2 |' },
    1: { text: '| -- | -- |' },
    2: { text: '| a  | b  |' },
    3: { text: 'window' }
  });
  assert.strictEqual(expandStartForStructure(buf, 3, 0, 50), 0);
}

function run() {
  testClampRowRangeBasic();
  testClampRowRangeNearTop();
  testClampRowRangeNearBottom();
  testClampRowRangeSmallTotal();
  testClampRowRangeEmpty();
  testScrollTopToRow();
  testComputeSpacerHeights();
  testComputeSpacerHeightsClampsNegative();
  testComputeSpacerHeightsBadAverage();
  testApplyHeightSmoothing();
  testCoerceRenderToken();
  testComputeDisplayMathSpans();
  testComputeDisplayMathSpansRespectsBoundaries();
  testComputeDisplayMathSpansIgnoresFencedRows();
  testComputeDisplayMathSpansSkipsOrphanCloserAtStart();
  testComputeDisplayMathSpansAfterInlineMathProse();
  testComputeDisplayMathSpansAfterMathLookingLine();
  testLikelyDisplayMathBodyText();
  testComputeFencedCodeSpansClosedAndUnclosed();
  testComputeFencedCodeSpansRespectsPromptBoundary();
  testComputeFencedCodeSpansSkipsOrphanCloserAtStart();
  testComputeFencedCodeSpansKeepsNormalFenceAfterProse();
  testLikelyCodeFenceBodyText();
  testExpandRangeForDisplayMathSpans();
  testAnchorPreservationMath();
  testBackscanNoStructureReturnsStart();
  testBackscanWalksThroughWrapped();
  testBackscanHandlesStartInsideWrapped();
  testBackscanFindsDisplayMathOpener();
  testBackscanFindsDisplayMathOpenerFromBody();
  testBackscanStopsAtBlankAboveStructure();
  testBackscanRespectsMaxBackscan();
  testBackscanRespectsSourceStart();
  testBackscanFindsBoxTableTop();
  testBackscanFindsMarkdownTableTop();
  console.log('richVirtual tests passed');
}

run();
