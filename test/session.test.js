const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseCliOptions } = require('../src/shared/cliOptions');
const {
  SESSION_VERSION,
  makeCwdAdapter,
  normalizeSessionData,
  normalizeSizes,
  validCwd,
  windowToRendererSession
} = require('../src/shared/sessionFormat');

function collectPaneIds(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node.paneId);
  else for (const child of node.children || []) collectPaneIds(child, out);
  return out;
}

const fixturePath = path.join(__dirname, 'complex_session.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mathterm-session-test-'));
const regularFile = path.join(tmpRoot, 'not-a-directory.txt');
fs.writeFileSync(regularFile, 'x');
const adapter = makeCwdAdapter({
  fs,
  path,
  os: { homedir: () => tmpRoot, tmpdir: () => tmpRoot },
  fallbackCwd: tmpRoot
});

assert.throws(() => makeCwdAdapter(), /requires fs, path, and os/);
assert.throws(() => normalizeSessionData({ version: SESSION_VERSION, windows: [] }), /adapter is required/);

const bridgeAdapter = makeCwdAdapter({
  fs: {
    existsSync: p => p === tmpRoot,
    isDirectorySync: p => p === tmpRoot,
    statSync: () => ({})
  },
  path,
  os: { homedir: () => tmpRoot, tmpdir: () => tmpRoot }
});
assert.strictEqual(validCwd(tmpRoot, bridgeAdapter), tmpRoot);

assert.strictEqual(fixture.version, SESSION_VERSION);
assert.strictEqual(fixture.activeWindowId, '20');
assert.strictEqual(fixture.windows.length, 3);
assert.ok(fixture.windows.every(win => win.bounds && win.bounds.width && win.bounds.height));
assert.deepStrictEqual(fixture.windows.map(win => win.workspaces.length), [3, 3, 2]);
assert.deepStrictEqual(
  fixture.windows.map(win => win.workspaces.map(workspace => workspace.panes.length)),
  [[5, 1, 3], [6, 2, 1], [4, 3]]
);

let totalPanes = 0;
for (const win of fixture.windows) {
  assert.ok(win.id);
  assert.ok(win.workspaces.some(workspace => workspace.id === win.activeWorkspaceId));
  for (const workspace of win.workspaces) {
    const layoutIds = collectPaneIds(workspace.layout);
    const paneIds = new Set(workspace.panes.map(pane => pane.id));
    assert.ok(layoutIds.length > 0);
    assert.ok(layoutIds.includes(workspace.activePaneId));
    if (workspace.maximizedPaneId != null) assert.ok(layoutIds.includes(workspace.maximizedPaneId));
    for (const id of layoutIds) assert.ok(paneIds.has(id), `missing pane record ${id}`);
    for (const pane of workspace.panes) assert.ok(layoutIds.includes(pane.id), `orphan pane record ${pane.id}`);
    totalPanes += layoutIds.length;
  }
}

assert.ok(totalPanes <= 64);
assert.strictEqual(totalPanes, 25);

const normalizedFixture = normalizeSessionData(fixture, adapter);
assert.strictEqual(normalizedFixture.version, SESSION_VERSION);
assert.deepStrictEqual(normalizedFixture.windows.map(win => win.workspaces.length), [3, 3, 2]);
assert.strictEqual(normalizedFixture.windows[0].bounds.width, 1180);

assert.strictEqual(normalizeSessionData({
  version: SESSION_VERSION,
  activeWorkspaceId: 7,
  workspaces: []
}, adapter), null);
assert.strictEqual(normalizeSessionData({ version: 99, windows: [] }, adapter), null);
assert.deepStrictEqual(normalizeSizes([0.01, 0.01], 2), [0.5, 0.5]);

const malformed = normalizeSessionData({
  version: SESSION_VERSION,
  activeWindowId: 'bad',
  windows: [{
    id: 'bad',
    activeWorkspaceId: 1,
    workspaces: [{
      id: 1,
      cwd: regularFile,
      activePaneId: 999,
      maximizedPaneId: 999,
      layout: {
        type: 'split',
        direction: 'row',
        sizes: [-1, 3],
        children: [{ type: 'pane', paneId: 10 }, { type: 'pane', paneId: 11 }]
      },
      panes: [
        { id: 10, cwd: regularFile, zoomFactor: 99 },
        { id: 11, cwd: path.join(tmpRoot, 'missing'), zoomFactor: 0.1 },
        { id: 12, cwd: tmpRoot }
      ]
    }, {
      id: 2,
      cwd: tmpRoot,
      activePaneId: 20,
      layout: { type: 'pane', paneId: 20 },
      panes: []
    }]
  }]
}, adapter);
assert.strictEqual(malformed.windows.length, 1);
assert.strictEqual(malformed.windows[0].workspaces.length, 1);
const repaired = malformed.windows[0].workspaces[0];
assert.strictEqual(repaired.cwd, tmpRoot);
assert.strictEqual(repaired.activePaneId, 10);
assert.strictEqual(repaired.maximizedPaneId, null);
assert.deepStrictEqual(repaired.layout.sizes, [0.5, 0.5]);
assert.deepStrictEqual(repaired.panes.map(pane => pane.id), [10, 11]);
assert.deepStrictEqual(repaired.panes.map(pane => pane.cwd), [tmpRoot, tmpRoot]);
assert.deepStrictEqual(repaired.panes.map(pane => pane.zoomFactor), [3, 0.4]);

const pruned = normalizeSessionData({
  version: SESSION_VERSION,
  activeWindowId: 'prune',
  windows: [{
    id: 'prune',
    activeWorkspaceId: 1,
    workspaces: [{
      id: 1,
      cwd: tmpRoot,
      activePaneId: 99,
      layout: {
        type: 'split',
        direction: 'row',
        sizes: [0.2, 0.6, 0.2],
        children: [
          { type: 'pane', paneId: 10 },
          { type: 'pane', paneId: 99 },
          { type: 'pane', paneId: 11 }
        ]
      },
      panes: [
        { id: 10, cwd: tmpRoot },
        { id: 11, cwd: tmpRoot }
      ]
    }]
  }]
}, adapter);
const prunedWorkspace = pruned.windows[0].workspaces[0];
assert.deepStrictEqual(prunedWorkspace.panes.map(pane => pane.id), [10, 11]);
assert.deepStrictEqual(prunedWorkspace.layout.children.map(child => child.paneId), [10, 11]);
assert.deepStrictEqual(prunedWorkspace.layout.sizes, [0.5, 0.5]);
assert.strictEqual(prunedWorkspace.activePaneId, 10);

const rendererSession = windowToRendererSession(normalizedFixture.windows[1], adapter);
assert.strictEqual(rendererSession.workspaces.length, 3);
assert.ok(rendererSession.workspaces[0].panesById instanceof Map);

assert.deepStrictEqual(parseCliOptions(['electron', '.', '--session', 'test/complex_session.json']).sessionPath, 'test/complex_session.json');
assert.deepStrictEqual(parseCliOptions(['mathterm', '--session=test/complex_session.json']).sessionPath, 'test/complex_session.json');
assert.strictEqual(parseCliOptions(['mathterm', '--help']).help, true);

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('session tests passed');
