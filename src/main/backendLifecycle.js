const DEFAULT_ORPHAN_GRACE_MS = 3000;

function cloneView(view) {
  if (!view) return null;
  return {
    viewId: String(view.viewId),
    windowId: String(view.windowId),
    capabilities: Array.isArray(view.capabilities) ? [...view.capabilities] : []
  };
}

function createWorkspaceBackend({ id, attachedView, now = Date.now() }) {
  if (!id) throw new Error('workspace backend id is required');
  const view = cloneView(attachedView);
  return {
    id: String(id),
    state: view ? 'attached' : 'orphaned',
    attachedView: view,
    transfer: null,
    orphanedAt: view ? null : now,
    graceDeadline: view ? null : now + DEFAULT_ORPHAN_GRACE_MS,
    closedAt: null
  };
}

function assertState(backend, expected) {
  if (!backend || backend.state !== expected) {
    throw new Error(`expected ${expected} backend state`);
  }
}

function beginTransfer(backend, targetView, { now = Date.now() } = {}) {
  assertState(backend, 'attached');
  if (!backend.attachedView) throw new Error('attached backend has no attached view');
  const target = cloneView(targetView);
  if (!target) throw new Error('target view is required');
  backend.state = 'transferring';
  backend.transfer = {
    sourceView: cloneView(backend.attachedView),
    targetView: target,
    startedAt: now,
    sourceInputAuthoritative: true
  };
  return backend;
}

function completeTransfer(backend) {
  assertState(backend, 'transferring');
  backend.attachedView = cloneView(backend.transfer.targetView);
  backend.transfer = null;
  backend.state = 'attached';
  backend.orphanedAt = null;
  backend.graceDeadline = null;
  return backend;
}

function failTransfer(backend, { sourceAlive = true, now = Date.now(), graceMs = DEFAULT_ORPHAN_GRACE_MS } = {}) {
  assertState(backend, 'transferring');
  const sourceView = cloneView(backend.transfer.sourceView);
  backend.transfer = null;
  if (sourceAlive && sourceView) {
    backend.attachedView = sourceView;
    backend.state = 'attached';
    backend.orphanedAt = null;
    backend.graceDeadline = null;
  } else {
    backend.attachedView = null;
    backend.state = 'orphaned';
    backend.orphanedAt = now;
    backend.graceDeadline = now + graceMs;
  }
  return backend;
}

function detachToOrphan(backend, { now = Date.now(), graceMs = DEFAULT_ORPHAN_GRACE_MS } = {}) {
  if (backend.state === 'closed' || backend.state === 'closing') return backend;
  backend.attachedView = null;
  backend.transfer = null;
  backend.state = 'orphaned';
  backend.orphanedAt = now;
  backend.graceDeadline = now + graceMs;
  return backend;
}

function attachOrphan(backend, view) {
  assertState(backend, 'orphaned');
  backend.attachedView = cloneView(view);
  if (!backend.attachedView) throw new Error('view is required');
  backend.transfer = null;
  backend.state = 'attached';
  backend.orphanedAt = null;
  backend.graceDeadline = null;
  return backend;
}

function closeBackend(backend, { now = Date.now() } = {}) {
  if (!backend || backend.state === 'closed') return backend;
  backend.state = 'closed';
  backend.attachedView = null;
  backend.transfer = null;
  backend.closedAt = now;
  return backend;
}

function isOrphanExpired(backend, now = Date.now()) {
  return backend?.state === 'orphaned' && backend.graceDeadline != null && now >= backend.graceDeadline;
}

function inputAuthorityView(backend) {
  if (!backend) return null;
  if (backend.state === 'attached') return cloneView(backend.attachedView);
  if (backend.state === 'transferring' && backend.transfer?.sourceInputAuthoritative) {
    return cloneView(backend.transfer.sourceView);
  }
  return null;
}

function canAcceptInput(backend, viewId) {
  const view = inputAuthorityView(backend);
  return Boolean(view && String(view.viewId) === String(viewId));
}

function sessionOwnerView(backend) {
  if (!backend) return null;
  if (backend.state === 'attached') return cloneView(backend.attachedView);
  if (backend.state === 'transferring') return cloneView(backend.transfer?.sourceView);
  return null;
}

module.exports = {
  DEFAULT_ORPHAN_GRACE_MS,
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
};
