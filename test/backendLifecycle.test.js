const assert = require('assert');
const {
  createWorkspaceBackend,
  beginTransfer,
  completeTransfer,
  failTransfer,
  detachToOrphan,
  attachOrphan,
  closeBackend,
  isOrphanExpired,
  inputAuthorityView,
  canAcceptInput,
  sessionOwnerView
} = require('../src/main/backendLifecycle');

const source = { viewId: 'view-a', windowId: 'win-a', capabilities: ['interactive'] };
const target = { viewId: 'view-b', windowId: 'win-b', capabilities: ['interactive'] };

function testTransferAuthorityAndSessionOwner() {
  const backend = createWorkspaceBackend({ id: 'workspace-1', attachedView: source, now: 100 });
  assert.strictEqual(backend.state, 'attached');
  assert.strictEqual(canAcceptInput(backend, 'view-a'), true);
  assert.deepStrictEqual(sessionOwnerView(backend), source);

  beginTransfer(backend, target, { now: 200 });
  assert.strictEqual(backend.state, 'transferring');
  assert.deepStrictEqual(inputAuthorityView(backend), source);
  assert.strictEqual(canAcceptInput(backend, 'view-a'), true);
  assert.strictEqual(canAcceptInput(backend, 'view-b'), false);
  assert.deepStrictEqual(sessionOwnerView(backend), source);

  completeTransfer(backend);
  assert.strictEqual(backend.state, 'attached');
  assert.deepStrictEqual(backend.attachedView, target);
  assert.strictEqual(canAcceptInput(backend, 'view-b'), true);
  assert.deepStrictEqual(sessionOwnerView(backend), target);
}

function testTransferFailureReturnsToSourceOrOrphans() {
  const recover = createWorkspaceBackend({ id: 'workspace-2', attachedView: source });
  beginTransfer(recover, target, { now: 10 });
  failTransfer(recover, { sourceAlive: true, now: 20 });
  assert.strictEqual(recover.state, 'attached');
  assert.deepStrictEqual(recover.attachedView, source);

  const orphan = createWorkspaceBackend({ id: 'workspace-3', attachedView: source });
  beginTransfer(orphan, target, { now: 30 });
  failTransfer(orphan, { sourceAlive: false, now: 40, graceMs: 2500 });
  assert.strictEqual(orphan.state, 'orphaned');
  assert.strictEqual(orphan.attachedView, null);
  assert.strictEqual(orphan.graceDeadline, 2540);
  assert.strictEqual(sessionOwnerView(orphan), null);
  assert.strictEqual(isOrphanExpired(orphan, 2539), false);
  assert.strictEqual(isOrphanExpired(orphan, 2540), true);
}

function testOrphanAttachAndClose() {
  const backend = createWorkspaceBackend({ id: 'workspace-4', attachedView: source });
  detachToOrphan(backend, { now: 50, graceMs: 3000 });
  assert.strictEqual(backend.state, 'orphaned');
  assert.strictEqual(backend.graceDeadline, 3050);

  attachOrphan(backend, target);
  assert.strictEqual(backend.state, 'attached');
  assert.deepStrictEqual(backend.attachedView, target);
  assert.strictEqual(backend.graceDeadline, null);

  closeBackend(backend, { now: 90 });
  assert.strictEqual(backend.state, 'closed');
  assert.strictEqual(backend.attachedView, null);
  assert.strictEqual(backend.closedAt, 90);
}

testTransferAuthorityAndSessionOwner();
testTransferFailureReturnsToSourceOrOrphans();
testOrphanAttachAndClose();

console.log('backendLifecycle tests passed');
