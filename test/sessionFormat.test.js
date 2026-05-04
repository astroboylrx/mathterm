const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  SESSION_VERSION,
  makeCwdAdapter,
  fallbackCwd,
  validCwd,
  normalizeSizes,
  cloneLayout,
  pruneLayoutToPaneRecords,
  sanitizeWindow,
  normalizeSessionData
} = require('../src/shared/sessionFormat');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mathterm-session-format-test-'));
const tmpFallback = path.join(tmpRoot, 'fallback');
const regularFile = path.join(tmpRoot, 'not-a-directory.txt');
fs.mkdirSync(tmpFallback);
fs.writeFileSync(regularFile, 'x');

const adapter = makeCwdAdapter({
  fs,
  path,
  os: { homedir: () => null, tmpdir: () => tmpFallback },
  fallbackCwd: tmpRoot
});

function testAdapterValidation() {
  assert.throws(() => makeCwdAdapter(), /requires fs, path, and os/);
  assert.throws(() => validCwd(tmpRoot), /adapter is required/);
  assert.strictEqual(fallbackCwd(adapter), tmpFallback);
  assert.strictEqual(validCwd(tmpRoot, adapter), tmpRoot);
  assert.strictEqual(validCwd(regularFile, adapter), tmpFallback);
  assert.strictEqual(validCwd(path.join(tmpRoot, 'missing'), adapter), tmpFallback);

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

  const noFallback = makeCwdAdapter({
    fs: { existsSync: () => false },
    path,
    os: { homedir: () => null, tmpdir: () => null }
  });
  assert.throws(() => fallbackCwd(noFallback), /No valid cwd fallback/);
}

function testNormalizeSizes() {
  assert.deepStrictEqual(normalizeSizes([2, 6], 2), [0.25, 0.75]);
  assert.deepStrictEqual(normalizeSizes([0.01, 0.01], 2), [0.5, 0.5]);
  assert.deepStrictEqual(normalizeSizes([-1, 3], 2), [0.5, 0.5]);
  assert.deepStrictEqual(normalizeSizes([1], 2), [0.5, 0.5]);
}

function testCloneLayout() {
  assert.deepStrictEqual(cloneLayout({ type: 'pane', paneId: 7 }), { type: 'pane', paneId: 7 });
  assert.strictEqual(cloneLayout({ type: 'pane', paneId: '7' }), null);
  assert.deepStrictEqual(cloneLayout({
    type: 'split',
    direction: 'column',
    sizes: [2, 2],
    children: [
      { type: 'pane', paneId: 1 },
      { type: 'pane', paneId: 2 },
      { type: 'bad' }
    ]
  }), {
    type: 'split',
    direction: 'column',
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', paneId: 1 },
      { type: 'pane', paneId: 2 }
    ]
  });
}

function testPruneLayoutToPaneRecords() {
  const rawPanes = new Map([[10, {}], [11, {}]]);
  const pruned = pruneLayoutToPaneRecords({
    type: 'split',
    direction: 'row',
    sizes: [0.2, 0.6, 0.2],
    children: [
      { type: 'pane', paneId: 10 },
      { type: 'pane', paneId: 99 },
      { type: 'pane', paneId: 11 }
    ]
  }, rawPanes);
  assert.deepStrictEqual(pruned, {
    type: 'split',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', paneId: 10 },
      { type: 'pane', paneId: 11 }
    ]
  });

  assert.deepStrictEqual(pruneLayoutToPaneRecords({
    type: 'split',
    direction: 'row',
    children: [{ type: 'pane', paneId: 99 }, { type: 'pane', paneId: 10 }]
  }, rawPanes), { type: 'pane', paneId: 10 });
}

function testSanitizeWindow() {
  const counts = { workspaces: 0, panes: 0 };
  const win = sanitizeWindow({
    id: 'alpha',
    bounds: { width: 100, height: 100, x: 2.4, y: 3.6 },
    isMaximized: true,
    isFullScreen: false,
    activeWorkspaceId: 1,
    workspaces: [{
      id: 1,
      cwd: regularFile,
      activePaneId: 99,
      maximizedPaneId: 99,
      customTitle: '  useful title  ',
      layout: {
        type: 'split',
        direction: 'row',
        children: [{ type: 'pane', paneId: 10 }, { type: 'pane', paneId: 11 }]
      },
      panes: [
        { id: 10, cwd: regularFile, zoomFactor: 10, autoRender: true },
        { id: 11, cwd: tmpRoot, zoomFactor: 0.1 }
      ]
    }]
  }, counts, adapter, 'fallback');

  assert.strictEqual(win.id, 'alpha');
  assert.deepStrictEqual(win.bounds, { width: 360, height: 240, x: 2, y: 4 });
  assert.strictEqual(win.isMaximized, true);
  assert.strictEqual(win.workspaces[0].cwd, tmpFallback);
  assert.strictEqual(win.workspaces[0].activePaneId, 10);
  assert.strictEqual(win.workspaces[0].maximizedPaneId, null);
  assert.strictEqual(win.workspaces[0].customTitle, 'useful title');
  assert.deepStrictEqual(win.workspaces[0].panes.map(pane => pane.cwd), [tmpFallback, tmpRoot]);
  assert.deepStrictEqual(win.workspaces[0].panes.map(pane => pane.zoomFactor), [3, 0.4]);
}

function testNormalizeSessionData() {
  assert.strictEqual(normalizeSessionData({ version: 99, windows: [] }, adapter), null);
  assert.strictEqual(normalizeSessionData({ version: SESSION_VERSION, windows: [] }, adapter), null);

  const normalized = normalizeSessionData({
    version: SESSION_VERSION,
    activeWindowId: 'missing',
    windows: [{
      id: 'one',
      activeWorkspaceId: 1,
      workspaces: [{
        id: 1,
        cwd: tmpRoot,
        activePaneId: 1,
        layout: { type: 'pane', paneId: 1 },
        panes: [{ id: 1, cwd: tmpRoot }]
      }]
    }]
  }, adapter);
  assert.strictEqual(normalized.version, SESSION_VERSION);
  assert.strictEqual(normalized.activeWindowId, 'one');
  assert.strictEqual(normalized.windows.length, 1);
}

testAdapterValidation();
testNormalizeSizes();
testCloneLayout();
testPruneLayoutToPaneRecords();
testSanitizeWindow();
testNormalizeSessionData();

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('session format tests passed');
