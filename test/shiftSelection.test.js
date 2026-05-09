const assert = require('assert');
const {
  orderedSelectionPoints,
  selectionLength,
  shouldForceMouseSelection
} = require('../src/renderer/shiftSelection');

function testShouldForceMouseSelection() {
  const term = { modes: { mouseTrackingMode: 'drag' } };
  assert.strictEqual(shouldForceMouseSelection(term, { button: 0, shiftKey: true }), true);
  assert.strictEqual(shouldForceMouseSelection(term, { button: 0, shiftKey: false }), false);
  assert.strictEqual(shouldForceMouseSelection(term, { button: 2, shiftKey: true }), false);
  assert.strictEqual(shouldForceMouseSelection({ modes: { mouseTrackingMode: 'none' } }, { button: 0, shiftKey: true }), false);
}

function testOrderedSelectionPoints() {
  assert.deepStrictEqual(
    orderedSelectionPoints({ x: 2, y: 3 }, { x: 5, y: 3 }),
    { anchor: { x: 2, y: 3 }, focus: { x: 5, y: 3 } }
  );
  assert.deepStrictEqual(
    orderedSelectionPoints({ x: 8, y: 5 }, { x: 3, y: 4 }),
    { anchor: { x: 3, y: 4 }, focus: { x: 8, y: 5 } }
  );
}

function testSelectionLength() {
  const term = { cols: 80 };
  assert.strictEqual(selectionLength(term, { x: 2, y: 3 }, { x: 7, y: 3 }), 5);
  assert.strictEqual(selectionLength(term, { x: 70, y: 3 }, { x: 5, y: 4 }), 15);
}

testShouldForceMouseSelection();
testOrderedSelectionPoints();
testSelectionLength();

console.log('shift selection tests passed');
