const assert = require('assert');
const {
  PROXY_SCRIPT,
  PROXY_STAMP,
  createWslVtProxy,
  maybeWrapWslProfile,
  maybeWrapWslSpawn,
  wslPaneEnvExtras
} = require('../src/main/wslVtProxy');

// Fake execFileSync that understands the three wsl.exe invocations the
// installer makes: the python3 probe, the version-stamp cat, and the write.
function makeFakeExec({ pythonOk = true, installedScript = null } = {}) {
  const calls = [];
  function exec(cmd, args, opts = {}) {
    const argv = (args || []).map(String);
    calls.push({ cmd, args: argv, opts });
    const bashPayload = argv.includes('-c') ? argv[argv.length - 1] : '';
    if (argv.includes('python3')) {
      if (!pythonOk) throw new Error('python3 not found');
      return Buffer.from('');
    }
    if (bashPayload.startsWith('cat ')) {
      if (installedScript == null) throw new Error('cat: No such file or directory');
      return installedScript;
    }
    if (bashPayload.startsWith('mkdir ')) {
      return Buffer.from('');
    }
    throw new Error(`unexpected invocation: ${argv.join(' ')}`);
  }
  return { exec, calls };
}

const UBUNTU_PROFILE = {
  id: 'auto:wsl:Ubuntu',
  name: 'Ubuntu',
  command: 'wsl.exe',
  args: ['-d', 'Ubuntu', '--cd', '~'],
  useShim: false
};

function testScriptStamp() {
  assert.ok(PROXY_SCRIPT.includes(PROXY_STAMP));
  assert.strictEqual(PROXY_STAMP, '# MT-VT-PROXY v1');
}

function testWrapsWslProfile() {
  const proxy = createWslVtProxy({ execFileSync: makeFakeExec({ installedScript: PROXY_SCRIPT }).exec });
  const wrapped = proxy.maybeWrapWslProfile(UBUNTU_PROFILE);
  assert.notStrictEqual(wrapped, UBUNTU_PROFILE);
  // id/name/useShim/command survive the wrap untouched.
  assert.strictEqual(wrapped.id, UBUNTU_PROFILE.id);
  assert.strictEqual(wrapped.name, UBUNTU_PROFILE.name);
  assert.strictEqual(wrapped.useShim, false);
  assert.strictEqual(wrapped.command, 'wsl.exe');
  assert.deepStrictEqual(wrapped.args, [
    '-d', 'Ubuntu', '--cd', '~',
    '--exec', 'bash', '-lc', 'exec python3 "$HOME/.cache/mathterm/vt-proxy.py"'
  ]);
  // Dedupe keys on '-d <distro>'; it must still be there after wrapping.
  assert.strictEqual(wrapped.args.indexOf('-d'), 0);
  assert.strictEqual(wrapped.args[1], 'Ubuntu');
  // The original profile object is not mutated.
  assert.deepStrictEqual(UBUNTU_PROFILE.args, ['-d', 'Ubuntu', '--cd', '~']);
}

function testBasenameVariants() {
  const proxy = createWslVtProxy({ execFileSync: makeFakeExec({ installedScript: PROXY_SCRIPT }).exec });
  for (const command of ['wsl.exe', 'WSL.EXE', 'wsl', 'C:\\Windows\\System32\\wsl.exe', 'wsl.exe']) {
    const wrapped = proxy.maybeWrapWslProfile({ ...UBUNTU_PROFILE, command });
    assert.ok(wrapped.args.includes('--exec'), `expected wrap for ${command}`);
  }
}

function testNonWslProfilesPassThrough() {
  const { exec, calls } = makeFakeExec({ installedScript: PROXY_SCRIPT });
  const proxy = createWslVtProxy({ execFileSync: exec });
  const powershell = { id: 'auto:powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: [], useShim: false };
  assert.strictEqual(proxy.maybeWrapWslProfile(powershell), powershell);
  // wsl.exe without '-d <distro>' cannot be wrapped.
  const noDistro = { ...UBUNTU_PROFILE, args: ['--cd', '~'] };
  assert.strictEqual(proxy.maybeWrapWslProfile(noDistro), noDistro);
  const danglingD = { ...UBUNTU_PROFILE, args: ['-d'] };
  assert.strictEqual(proxy.maybeWrapWslProfile(danglingD), danglingD);
  // Malformed profiles survive untouched.
  assert.strictEqual(proxy.maybeWrapWslProfile(null), null);
  const malformed = { id: 'x' };
  assert.strictEqual(proxy.maybeWrapWslProfile(malformed), malformed);
  // Nothing here is a wrappable WSL profile, so no wsl.exe probe ever ran.
  assert.strictEqual(calls.length, 0);
}

function testPrefixArgsPreserved() {
  const proxy = createWslVtProxy({ execFileSync: makeFakeExec({ installedScript: PROXY_SCRIPT }).exec });
  const profile = { ...UBUNTU_PROFILE, args: ['--verbose', '-d', 'Ubuntu', '--cd', '~'] };
  const wrapped = proxy.maybeWrapWslProfile(profile);
  assert.deepStrictEqual(wrapped.args, [
    '--verbose',
    '-d', 'Ubuntu', '--cd', '~',
    '--exec', 'bash', '-lc', 'exec python3 "$HOME/.cache/mathterm/vt-proxy.py"'
  ]);
}

function testNoWrapWhenInstallFails() {
  const { exec, calls } = makeFakeExec({ pythonOk: false });
  const proxy = createWslVtProxy({ execFileSync: exec });
  assert.strictEqual(proxy.ensureProxyInstalled('Ubuntu'), false);
  assert.strictEqual(proxy.maybeWrapWslProfile(UBUNTU_PROFILE), UBUNTU_PROFILE);
  // Negative result is cached: one probe total despite two lookups.
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, ['-d', 'Ubuntu', '--exec', 'python3', '-c', 'pass']);
}

function testInstallsWhenMissing() {
  const { exec, calls } = makeFakeExec({ installedScript: null });
  const proxy = createWslVtProxy({ execFileSync: exec });
  assert.strictEqual(proxy.ensureProxyInstalled('Ubuntu'), true);
  assert.strictEqual(calls.length, 3); // probe, cat (miss), write
  const write = calls[2];
  assert.deepStrictEqual(write.args.slice(0, 4), ['-d', 'Ubuntu', '--exec', 'bash']);
  assert.ok(write.args[5].includes('mkdir -p "$HOME/.cache/mathterm"'));
  assert.ok(write.args[5].includes('vt-proxy.py'));
  assert.strictEqual(write.opts.input, PROXY_SCRIPT);
}

function testStaleVersionReinstalled() {
  const { exec, calls } = makeFakeExec({ installedScript: '# MT-VT-PROXY v0\nold contents\n' });
  const proxy = createWslVtProxy({ execFileSync: exec });
  assert.strictEqual(proxy.ensureProxyInstalled('Ubuntu'), true);
  assert.strictEqual(calls.length, 3); // stamp mismatch -> rewrite
  assert.strictEqual(calls[2].opts.input, PROXY_SCRIPT);
}

function testPositiveResultCached() {
  const { exec, calls } = makeFakeExec({ installedScript: PROXY_SCRIPT });
  const proxy = createWslVtProxy({ execFileSync: exec });
  assert.strictEqual(proxy.ensureProxyInstalled('Ubuntu'), true);
  assert.strictEqual(proxy.ensureProxyInstalled('Ubuntu'), true);
  proxy.maybeWrapWslProfile(UBUNTU_PROFILE);
  proxy.maybeWrapWslProfile(UBUNTU_PROFILE);
  assert.strictEqual(calls.length, 2); // one probe + one cat, then cached
  // A different distro gets its own probe.
  assert.strictEqual(proxy.ensureProxyInstalled('Debian'), true);
  assert.strictEqual(calls.length, 4);
}

function testEmptyDistroRejected() {
  const { exec, calls } = makeFakeExec({});
  const proxy = createWslVtProxy({ execFileSync: exec });
  assert.strictEqual(proxy.ensureProxyInstalled(''), false);
  assert.strictEqual(calls.length, 0);
}

function testDefaultExportPassesThrough() {
  // The shared default instance wraps nothing on this host (no wsl.exe), so
  // non-WSL and unprobeable-WSL profiles come back unchanged.
  const powershell = { id: 'p', name: 'PS', command: 'powershell.exe', args: [], useShim: false };
  assert.strictEqual(maybeWrapWslProfile(powershell), powershell);
}

function testMaybeWrapWslSpawn() {
  // WSL spawn: same wrapping as maybeWrapWslProfile, through the injectable proxy.
  const proxy = createWslVtProxy({ execFileSync: makeFakeExec({ installedScript: PROXY_SCRIPT }).exec });
  const wrapped = maybeWrapWslSpawn('wsl.exe', ['-d', 'Ubuntu', '--cd', '~'], proxy);
  assert.strictEqual(wrapped.shellCmd, 'wsl.exe');
  assert.deepStrictEqual(wrapped.shellArgs.slice(0, 2), ['-d', 'Ubuntu']);
  assert.ok(wrapped.shellArgs.includes('--exec'), 'spawn args route through the VT proxy');
  // Non-WSL and non-array args pass through untouched.
  const bare = maybeWrapWslSpawn('powershell.exe', null, proxy);
  assert.strictEqual(bare.shellCmd, 'powershell.exe');
  assert.deepStrictEqual(bare.shellArgs, []);
}

function testWslPaneEnvExtras() {
  const colors = { fg: '#cccccc', bg: '#0c0c0c' };
  // POSIX and non-WSL commands get nothing.
  assert.strictEqual(wslPaneEnvExtras('wsl.exe', colors, { platform: 'linux', env: {} }), undefined);
  assert.strictEqual(wslPaneEnvExtras('powershell.exe', colors, { platform: 'win32', env: {} }), undefined);
  // WSL pane with valid colors: theme colors + WSLENV carrying WSL's default
  // propagation entries (WT_SESSION:WT_PROFILE_ID), COLORTERM, and ours.
  const full = wslPaneEnvExtras('wsl.exe', colors, { platform: 'win32', env: {} });
  assert.strictEqual(full.MT_TERM_FG, '#cccccc');
  assert.strictEqual(full.MT_TERM_BG, '#0c0c0c');
  assert.strictEqual(full.WSLENV, 'WT_SESSION:WT_PROFILE_ID:COLORTERM:MT_TERM_FG:MT_TERM_BG');
  // Existing WSLENV entries (incl. flags) are preserved and not duplicated.
  const merged = wslPaneEnvExtras('C:\\Windows\\System32\\wsl.exe', colors, {
    platform: 'win32',
    env: { WSLENV: 'WT_SESSION:FOO/p:COLORTERM' }
  });
  assert.strictEqual(merged.WSLENV, 'WT_SESSION:FOO/p:COLORTERM:WT_PROFILE_ID:MT_TERM_FG:MT_TERM_BG');
  // Without valid colors the proxy colors stay out, but capability/default
  // propagation still applies to every WSL pane.
  const noColors = wslPaneEnvExtras('wsl.exe', { fg: 'red', bg: '#0c0c0c' }, { platform: 'win32', env: {} });
  assert.strictEqual(noColors.MT_TERM_FG, undefined);
  assert.strictEqual(noColors.WSLENV, 'WT_SESSION:WT_PROFILE_ID:COLORTERM');
}

testScriptStamp();
testWrapsWslProfile();
testBasenameVariants();
testNonWslProfilesPassThrough();
testPrefixArgsPreserved();
testNoWrapWhenInstallFails();
testInstallsWhenMissing();
testStaleVersionReinstalled();
testPositiveResultCached();
testEmptyDistroRejected();
testDefaultExportPassesThrough();
testMaybeWrapWslSpawn();
testWslPaneEnvExtras();

console.log('wsl vt proxy tests passed');
