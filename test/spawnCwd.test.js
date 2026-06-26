const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isRemoteDisplayHost,
  choosePaneSpawnCwd
} = require('../src/shared/spawnCwd');
const { makeCwdAdapter } = require('../src/shared/sessionFormat');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mathterm-spawn-cwd-test-'));
const home = path.join(tmpRoot, 'home');
const localProject = path.join(tmpRoot, 'project');
const remoteMirror = path.join(tmpRoot, 'remote-mirror');
fs.mkdirSync(home);
fs.mkdirSync(localProject);
fs.mkdirSync(remoteMirror);

const adapter = makeCwdAdapter({
  fs,
  path,
  os: { homedir: () => home, tmpdir: () => tmpRoot },
  fallbackCwd: home
});

assert.strictEqual(isRemoteDisplayHost('localbox', 'localbox'), false);
assert.strictEqual(isRemoteDisplayHost('localbox.example.com', 'localbox'), false);
assert.strictEqual(isRemoteDisplayHost('localhost', 'localbox'), false);
assert.strictEqual(isRemoteDisplayHost('remote', 'localbox'), true);

assert.strictEqual(choosePaneSpawnCwd({
  pane: { cwd: localProject, localCwd: home },
  inheritCwd: true,
  adapter,
  localHost: 'localbox'
}), localProject);

assert.strictEqual(choosePaneSpawnCwd({
  pane: { cwd: remoteMirror, localCwd: localProject, displayHost: 'remote' },
  inheritCwd: true,
  adapter,
  localHost: 'localbox'
}), localProject);

assert.strictEqual(choosePaneSpawnCwd({
  pane: { cwd: remoteMirror, localCwd: path.join(tmpRoot, 'missing'), displayHost: 'remote' },
  inheritCwd: true,
  adapter,
  localHost: 'localbox'
}), home);

assert.strictEqual(choosePaneSpawnCwd({
  pane: { cwd: localProject, localCwd: localProject },
  inheritCwd: false,
  adapter,
  localHost: 'localbox'
}), home);

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('spawn cwd tests passed');
