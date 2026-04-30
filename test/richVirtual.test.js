const assert = require('assert');
const {
  clampRowRange,
  scrollTopToRow,
  computeSpacerHeights,
  applyHeightSmoothing,
  coerceRenderToken,
  RICH_VIRTUAL_DEFAULT_LINE_HEIGHT
} = require('../src/richVirtual');

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
  testAnchorPreservationMath();
  console.log('richVirtual tests passed');
}

run();
