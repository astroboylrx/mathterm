const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SHIM_PREFIX,
  createShellShim,
  buildShellArgs,
  removeShellShim,
  sweepStaleShellShims
} = require('../src/main/shellShim');

// Keep the real ~/.cache out of the tests: createShellShim reads homedir() off
// the injected os.
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mathterm-shimtest-'));
const sandboxOs = Object.assign(Object.create(os), { homedir: () => sandboxHome });

function testBashShimLifecycle() {
  const env = { HOME: sandboxHome, PATH: process.env.PATH };
  const shim = createShellShim({ fs, path, os: sandboxOs, shellCmd: '/bin/bash', env });
  assert.strictEqual(shim.shimDir, path.join(sandboxHome, '.cache', 'mathterm'));
  assert.deepStrictEqual(shim.shellArgs, ['--rcfile', path.join(shim.shimDir, 'bashrc.sh'), '-i']);
  assert.strictEqual(shim.shellEnv, env);
  const bashrc = fs.readFileSync(path.join(shim.shimDir, 'bashrc.sh'), 'utf8');
  assert.ok(bashrc.includes('PROMPT_COMMAND='));
  assert.ok(bashrc.includes('133;A'));
  assert.ok(bashrc.includes('1337;File='));
}

function testZshShimLifecycle() {
  const env = { HOME: '/home/example', ZDOTDIR: '/home/example/.config/zsh' };
  const shim = createShellShim({ fs, path, os: sandboxOs, shellCmd: '/bin/zsh', env });
  assert.strictEqual(shim.shimDir, path.join(sandboxHome, '.cache', 'mathterm', 'zsh'));
  assert.deepStrictEqual(shim.shellArgs, ['-l', '-i']);
  assert.strictEqual(shim.shellEnv.ZDOTDIR, shim.shimDir);
  assert.strictEqual(shim.shellEnv._MT_USER_ZDOTDIR, env.ZDOTDIR);
  for (const name of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
    assert.ok(fs.existsSync(path.join(shim.shimDir, name)), `${name} missing`);
  }
  const zshrc = fs.readFileSync(path.join(shim.shimDir, '.zshrc'), 'utf8');
  assert.ok(zshrc.includes('add-zsh-hook preexec'));
  assert.ok(zshrc.includes('133;D'));
}

// The dir is shared, so a pane closing must leave it for the other panes; the
// compinit dump living there is the whole point of keeping it.
function testShimDirSurvivesPaneClose() {
  const env = { HOME: sandboxHome };
  const a = createShellShim({ fs, path, os: sandboxOs, shellCmd: '/bin/zsh', env });
  const b = createShellShim({ fs, path, os: sandboxOs, shellCmd: '/bin/zsh', env });
  assert.strictEqual(a.shimDir, b.shimDir);
  const dump = path.join(a.shimDir, '.zcompdump');
  fs.writeFileSync(dump, 'cached');
  removeShellShim({ fs, shimDir: a.shimDir });
  assert.ok(fs.existsSync(b.shimDir), 'shared shim dir must survive a pane close');
  assert.ok(fs.existsSync(dump), 'the completion dump must survive a pane close');
  // Legacy per-pane dirs are still cleaned up by name.
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), SHIM_PREFIX));
  removeShellShim({ fs, shimDir: legacy });
  assert.strictEqual(fs.existsSync(legacy), false);
}

function testBuildShellArgsValidation() {
  assert.throws(() => buildShellArgs({ shellCmd: '/bin/bash', shimDir: '/tmp/x' }), /require path/);
}

function testSweepStaleShellShims() {
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), SHIM_PREFIX));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), SHIM_PREFIX));
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(stale, oldDate, oldDate);
  const removed = sweepStaleShellShims({ fs, path, os, olderThanMs: 60 * 60 * 1000, now: Date.now() });
  assert.ok(removed >= 1);
  assert.strictEqual(fs.existsSync(stale), false);
  assert.strictEqual(fs.existsSync(fresh), true);
  removeShellShim({ fs, shimDir: fresh });
}

testBashShimLifecycle();
testZshShimLifecycle();
testBuildShellArgsValidation();
testShimDirSurvivesPaneClose();
testSweepStaleShellShims();

console.log('shellShim tests passed');
