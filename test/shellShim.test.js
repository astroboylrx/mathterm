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

function testBashShimLifecycle() {
  const env = { HOME: os.homedir(), PATH: process.env.PATH };
  const shim = createShellShim({ fs, path, os, shellCmd: '/bin/bash', env });
  assert.ok(path.basename(shim.shimDir).startsWith(SHIM_PREFIX));
  assert.deepStrictEqual(shim.shellArgs, ['--rcfile', path.join(shim.shimDir, 'bashrc.sh'), '-i']);
  assert.strictEqual(shim.shellEnv, env);
  const bashrc = fs.readFileSync(path.join(shim.shimDir, 'bashrc.sh'), 'utf8');
  assert.ok(bashrc.includes('PROMPT_COMMAND='));
  assert.ok(bashrc.includes('133;A'));
  assert.ok(bashrc.includes('1337;File='));
  removeShellShim({ fs, shimDir: shim.shimDir });
  assert.strictEqual(fs.existsSync(shim.shimDir), false);
}

function testZshShimLifecycle() {
  const env = { HOME: '/home/example', ZDOTDIR: '/home/example/.config/zsh' };
  const shim = createShellShim({ fs, path, os, shellCmd: '/bin/zsh', env });
  assert.deepStrictEqual(shim.shellArgs, ['-l', '-i']);
  assert.strictEqual(shim.shellEnv.ZDOTDIR, shim.shimDir);
  assert.strictEqual(shim.shellEnv._MT_USER_ZDOTDIR, env.ZDOTDIR);
  for (const name of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
    assert.ok(fs.existsSync(path.join(shim.shimDir, name)), `${name} missing`);
  }
  const zshrc = fs.readFileSync(path.join(shim.shimDir, '.zshrc'), 'utf8');
  assert.ok(zshrc.includes('add-zsh-hook preexec'));
  assert.ok(zshrc.includes('133;D'));
  removeShellShim({ fs, shimDir: shim.shimDir });
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
testSweepStaleShellShims();

console.log('shellShim tests passed');
