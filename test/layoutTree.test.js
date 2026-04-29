const assert = require('assert');
const {
  paneIdsInLayout,
  findLeafPath,
  replaceNodeAtPath,
  getNodeAtPath,
  normalizedSizes,
  updateSplitSizesAtPath,
  firstPaneIdInLayout,
  removePaneFromLayout
} = require('../src/layoutTree');

function nearlyEqual(a, b) {
  assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);
}

function testFindReplaceAndOrder() {
  const root = {
    type: 'split',
    direction: 'row',
    sizes: [0.4, 0.6],
    children: [
      { type: 'pane', paneId: 1 },
      {
        type: 'split',
        direction: 'column',
        sizes: [0.25, 0.75],
        children: [
          { type: 'pane', paneId: 2 },
          { type: 'pane', paneId: 3 }
        ]
      }
    ]
  };

  assert.deepStrictEqual(paneIdsInLayout(root), [1, 2, 3]);
  assert.deepStrictEqual(findLeafPath(root, 3), [1, 1]);
  assert.strictEqual(findLeafPath(root, 99), null);
  assert.deepStrictEqual(getNodeAtPath(root, [1]).children.map(c => c.paneId), [2, 3]);

  const next = replaceNodeAtPath(root, [1, 0], { type: 'pane', paneId: 4 });
  assert.deepStrictEqual(paneIdsInLayout(next), [1, 4, 3]);
  assert.deepStrictEqual(paneIdsInLayout(root), [1, 2, 3]);
}

function testRemoveCollapsesLocalSplitAndChoosesSibling() {
  const root = {
    type: 'split',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', paneId: 1 },
      {
        type: 'split',
        direction: 'column',
        sizes: [0.5, 0.5],
        children: [
          { type: 'pane', paneId: 2 },
          { type: 'pane', paneId: 3 }
        ]
      }
    ]
  };

  const removal = removePaneFromLayout(root, 2);
  assert.strictEqual(removal.replacementPaneId, 3);
  assert.deepStrictEqual(removal.layout, {
    type: 'split',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', paneId: 1 },
      { type: 'pane', paneId: 3 }
    ]
  });
}

function testRemovePreservesAndRenormalizesRatios() {
  const root = {
    type: 'split',
    direction: 'row',
    sizes: [0.2, 0.3, 0.5],
    children: [
      { type: 'pane', paneId: 1 },
      { type: 'pane', paneId: 2 },
      { type: 'pane', paneId: 3 }
    ]
  };

  const removal = removePaneFromLayout(root, 2);
  assert.deepStrictEqual(paneIdsInLayout(removal.layout), [1, 3]);
  nearlyEqual(removal.layout.sizes[0], 2 / 7);
  nearlyEqual(removal.layout.sizes[1], 5 / 7);
}

function testUpdateSplitSizesAndNormalization() {
  const root = {
    type: 'split',
    direction: 'row',
    sizes: [2, 6],
    children: [
      { type: 'pane', paneId: 1 },
      { type: 'pane', paneId: 2 }
    ]
  };

  assert.deepStrictEqual(normalizedSizes(root), [0.25, 0.75]);
  const next = updateSplitSizesAtPath(root, [], [0.6, 0.4]);
  assert.deepStrictEqual(next.sizes, [0.6, 0.4]);
  assert.deepStrictEqual(root.sizes, [2, 6]);
}

function testFirstPaneId() {
  assert.strictEqual(firstPaneIdInLayout(null), null);
  assert.strictEqual(firstPaneIdInLayout({ type: 'pane', paneId: 0 }), 0);
}

function run() {
  testFindReplaceAndOrder();
  testRemoveCollapsesLocalSplitAndChoosesSibling();
  testRemovePreservesAndRenormalizesRatios();
  testUpdateSplitSizesAndNormalization();
  testFirstPaneId();
  console.log('layoutTree tests passed');
}

run();
