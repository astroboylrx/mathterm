const { createRuntimeIdFactory } = require('../shared/runtimeIds');

const runtimeIds = createRuntimeIdFactory();

function nextWorkspaceBackendId() {
  return runtimeIds.nextWorkspaceBackendId();
}

function nextPaneBackendId() {
  return runtimeIds.nextPaneBackendId();
}

function ensureWorkspaceBackendId(workspace) {
  if (!workspace.workspaceBackendId) workspace.workspaceBackendId = nextWorkspaceBackendId();
  return workspace.workspaceBackendId;
}

function ensurePaneBackendId(pane) {
  if (!pane.paneBackendId) pane.paneBackendId = nextPaneBackendId();
  return pane.paneBackendId;
}

module.exports = {
  nextWorkspaceBackendId,
  nextPaneBackendId,
  ensureWorkspaceBackendId,
  ensurePaneBackendId
};
