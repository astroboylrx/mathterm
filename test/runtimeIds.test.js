const assert = require('assert');
const { createRuntimeIdFactory } = require('../src/shared/runtimeIds');

function testDeterministicRuntimeIds() {
  const ids = createRuntimeIdFactory({
    now: () => 123456,
    random: () => 0.25
  });
  assert.strictEqual(ids.nextWorkspaceBackendId(), 'workspace-2n9c-1-2hwcg');
  assert.strictEqual(ids.nextPaneBackendId(), 'pane-2n9c-2-2hwcg');
}

function testUniquenessAndKindValidation() {
  const ids = createRuntimeIdFactory({ now: () => 1, random: () => 0 });
  const values = new Set([
    ids.nextWorkspaceBackendId(),
    ids.nextWorkspaceBackendId(),
    ids.nextPaneBackendId(),
    ids.nextPaneBackendId()
  ]);
  assert.strictEqual(values.size, 4);
  assert.throws(() => ids.next(''), /kind is required/);
}

testDeterministicRuntimeIds();
testUniquenessAndKindValidation();

console.log('runtimeIds tests passed');
