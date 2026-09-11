const assert = require('assert');
const {
  stripJsonc,
  splitWindowsCommandLine,
  expandWindowsEnv,
  parseWindowsTerminalSettings,
  profileFromWindowsTerminalEntry,
  parseWslDistroList,
  buildAutoProfiles,
  mergeProfiles,
  resolveDefaultProfile
} = require('../src/shared/shellProfiles');

function testStripJsonc() {
  assert.strictEqual(stripJsonc('{ "a": 1 } // comment'), '{ "a": 1 } ');
  assert.strictEqual(stripJsonc('{ /* block */ "a": 1 }'), '{  "a": 1 }');
  // Comment markers inside strings are preserved.
  assert.strictEqual(stripJsonc('{ "a": "http://x/*y*/" }'), '{ "a": "http://x/*y*/" }');
  // Escaped quotes do not end the string.
  assert.strictEqual(stripJsonc('{ "a": "x\\" // y" }'), '{ "a": "x\\" // y" }');
  // Trailing commas are removed, both in objects and arrays.
  assert.strictEqual(stripJsonc('{ "a": 1, }'), '{ "a": 1 }');
  assert.strictEqual(stripJsonc('[1, 2,\n]'), '[1, 2\n]');
  // A comma that only looks trailing inside a string is preserved.
  assert.strictEqual(stripJsonc('{ "a": "x,]" }'), '{ "a": "x,]" }');
  assert.deepStrictEqual(JSON.parse(stripJsonc('{\n// c\n"a": [1,2,],\n}')), { a: [1, 2] });
}

function testSplitWindowsCommandLine() {
  assert.deepStrictEqual(splitWindowsCommandLine('cmd.exe /c echo hi'), ['cmd.exe', '/c', 'echo', 'hi']);
  assert.deepStrictEqual(
    splitWindowsCommandLine('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile'),
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoProfile']
  );
  // Empty quoted argument survives.
  assert.deepStrictEqual(splitWindowsCommandLine('a "" b'), ['a', '', 'b']);
  // 2n+1 backslashes before a quote: n backslashes + literal quote.
  assert.deepStrictEqual(splitWindowsCommandLine('a\\"b c'), ['a"b', 'c']);
  // 2n backslashes before a quote: n backslashes + quote toggle.
  assert.deepStrictEqual(splitWindowsCommandLine('"a\\\\" b'), ['a\\', 'b']);
  assert.deepStrictEqual(splitWindowsCommandLine(''), []);
}

function testExpandWindowsEnv() {
  const env = { UserProfile: 'C:\\Users\\rixin', SYSTEMROOT: 'C:\\Windows' };
  // Lookup is case-insensitive.
  assert.strictEqual(expandWindowsEnv('%USERPROFILE%\\bin', env), 'C:\\Users\\rixin\\bin');
  assert.strictEqual(expandWindowsEnv('"%SystemRoot%\\System32\\cmd.exe"', env), '"C:\\Windows\\System32\\cmd.exe"');
  // Unknown variables are left as-is.
  assert.strictEqual(expandWindowsEnv('%NOPE%\\x', env), '%NOPE%\\x');
}

const WT_SETTINGS = `{
  // Windows Terminal sample config
  "defaultProfile": "{ guid-pwsh }",
  "profiles": {
    "list": [
      {
        "guid": "{ guid-pwsh }",
        "name": "PowerShell",
        "source": "Windows.Terminal.PowershellCore",
      },
      {
        "guid": "{ guid-ubuntu }",
        "name": "Ubuntu",
        "source": "Windows.Terminal.Wsl"
      },
      {
        "guid": "{ guid-cmd }",
        "name": "Command Prompt",
        "commandline": "%SystemRoot%\\\\System32\\\\cmd.exe",
      },
      {
        "guid": "{ guid-hidden }",
        "name": "Hidden One",
        "commandline": "hidden.exe",
        "hidden": true
      },
      {
        "guid": "{ guid-azure }",
        "name": "Azure",
        "source": "Windows.Terminal.Azure"
      },
      {
        "guid": "{ guid-vs }",
        "commandline": "\\"C:\\\\Program Files\\\\VS\\\\devenv.exe\\" /log",
      }
    ]
  }
}`;

function testParseWindowsTerminalSettings() {
  const { entries, defaultGuid } = parseWindowsTerminalSettings(WT_SETTINGS);
  assert.strictEqual(defaultGuid, '{ guid-pwsh }');
  assert.strictEqual(entries.length, 6);
  assert.strictEqual(entries[0].name, 'PowerShell');

  // Garbage input parses to an empty result instead of throwing.
  assert.deepStrictEqual(parseWindowsTerminalSettings('not json {'), { entries: [], defaultGuid: null });
  assert.deepStrictEqual(parseWindowsTerminalSettings('[]'), { entries: [], defaultGuid: null });
}

function testProfileFromWindowsTerminalEntry() {
  const env = { SystemRoot: 'C:\\Windows' };
  const { entries } = parseWindowsTerminalSettings(WT_SETTINGS);

  // PowerShellCore source resolves via the detected pwsh path.
  const pwsh = profileFromWindowsTerminalEntry(entries[0], { pwshPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', env });
  assert.deepStrictEqual(pwsh, {
    id: 'wt:{ guid-pwsh }',
    name: 'PowerShell',
    command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: [],
    useShim: false
  });

  // WSL source without commandline becomes wsl.exe -d <name> --cd ~.
  const wsl = profileFromWindowsTerminalEntry(entries[1], { env });
  assert.deepStrictEqual(wsl, {
    id: 'wt:{ guid-ubuntu }',
    name: 'Ubuntu',
    command: 'wsl.exe',
    args: ['-d', 'Ubuntu', '--cd', '~'],
    useShim: false
  });

  // Plain commandline entries get %VAR% expansion and name fallback.
  const cmd = profileFromWindowsTerminalEntry(entries[2], { env });
  assert.deepStrictEqual(cmd, {
    id: 'wt:{ guid-cmd }',
    name: 'Command Prompt',
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: [],
    useShim: false
  });

  // hidden: true and unknown dynamic sources are skipped.
  assert.strictEqual(profileFromWindowsTerminalEntry(entries[3], { env }), null);
  assert.strictEqual(profileFromWindowsTerminalEntry(entries[4], { env }), null);

  // Quoted commandline with args; missing name falls back to the exe basename.
  const vs = profileFromWindowsTerminalEntry(entries[5], { env });
  assert.deepStrictEqual(vs, {
    id: 'wt:{ guid-vs }',
    name: 'devenv',
    command: 'C:\\Program Files\\VS\\devenv.exe',
    args: ['/log'],
    useShim: false
  });

  assert.strictEqual(profileFromWindowsTerminalEntry(null), null);
  assert.strictEqual(profileFromWindowsTerminalEntry({}), null);
}

function testParseWslDistroList() {
  // wsl.exe -l -q decoded from UTF-16LE; NULs and blank lines are stripped.
  assert.deepStrictEqual(
    parseWslDistroList('Ubuntu\r\ndocker-desktop\r\nDebian\ndocker-desktop-data\n\n'),
    ['Ubuntu', 'Debian']
  );
  // Lines with spaces or excessive length look like localized prompts, not distros.
  assert.deepStrictEqual(
  parseWslDistroList('Ubuntu\r\nInstall a distro: wsl.exe --install\r\n' + 'x'.repeat(60) + '\r\n'),
    ['Ubuntu']
  );
  assert.deepStrictEqual(parseWslDistroList(''), []);
}

function testBuildAutoProfiles() {
  // POSIX is exactly the historical hard-coded behavior.
  assert.deepStrictEqual(buildAutoProfiles({ platform: 'linux', env: { SHELL: '/bin/zsh' } }), [{
    id: 'posix:default',
    name: 'Default',
    command: '/bin/zsh',
    args: [],
    useShim: true
  }]);
  assert.strictEqual(buildAutoProfiles({ platform: 'darwin', env: {} })[0].command, '/bin/bash');

  const win = buildAutoProfiles({
    platform: 'win32',
    env: {},
    pwshPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    wslDistros: ['Ubuntu', 'Debian'],
    gitBashPath: 'C:\\Program Files\\Git\\bin\\bash.exe'
  });
  // Order: pwsh, powershell, cmd, WSL distros, Git Bash.
  assert.deepStrictEqual(win.map(p => p.id), [
    'auto:pwsh',
    'auto:powershell',
    'auto:cmd',
    'auto:wsl:Ubuntu',
    'auto:wsl:Debian',
    'auto:git-bash'
  ]);
  assert.ok(win.every(p => p.useShim === false));
  assert.deepStrictEqual(win[3].args, ['-d', 'Ubuntu', '--cd', '~']);
  // Nothing detected beyond the built-ins.
  const bare = buildAutoProfiles({ platform: 'win32', env: {} });
  assert.deepStrictEqual(bare.map(p => p.id), ['auto:powershell', 'auto:cmd']);
}

function testMergeProfiles() {
  const primary = [
    { id: 'wt:1', name: 'Ubuntu', command: 'wsl.exe', args: ['-d', 'Ubuntu', '--cd', '~'], useShim: false },
    { id: 'wt:2', name: 'PS', command: 'C:\\PowerShell\\pwsh.exe', args: [], useShim: false },
    // Customized with extra flags: still the same shell as bare powershell.exe.
    { id: 'wt:3', name: 'Windows PowerShell', command: 'powershell.exe', args: ['-NoExit'], useShim: false },
    { id: 'wt:4', name: 'Command Prompt', command: 'C:\\Windows\\System32\\cmd.exe', args: [], useShim: false }
  ];
  const fallback = [
    // Same exe, different case/path: deduped.
    { id: 'auto:pwsh', name: 'PowerShell', command: 'c:\\powershell\\pwsh.exe', args: [], useShim: false },
    // Same distro as wt:1 with fewer args: deduped (the WT entry wins).
    { id: 'auto:wsl:Ubuntu', name: 'Ubuntu', command: 'wsl.exe', args: ['-d', 'Ubuntu'], useShim: false },
    // Bare powershell.exe without args: same shell as the customized wt:3.
    { id: 'auto:powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: [], useShim: false },
    // Full-path cmd in wt:4 vs bare cmd.exe: same shell.
    { id: 'auto:cmd', name: 'Command Prompt', command: 'cmd.exe', args: [], useShim: false },
    // A different distro survives.
    { id: 'auto:wsl:Debian', name: 'Debian', command: 'wsl.exe', args: ['-d', 'Debian', '--cd', '~'], useShim: false },
    // Something Windows Terminal does not list survives.
    { id: 'auto:git-bash', name: 'Git Bash', command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], useShim: false }
  ];
  const merged = mergeProfiles(primary, fallback);
  assert.deepStrictEqual(merged.map(p => p.id), ['wt:1', 'wt:2', 'wt:3', 'wt:4', 'auto:wsl:Debian', 'auto:git-bash']);
}

function testResolveDefaultProfile() {
  const profiles = [
    { id: 'wt:a', command: 'pwsh.exe' },
    { id: 'wt:b', command: 'cmd.exe' }
  ];
  // Explicit setting wins.
  assert.strictEqual(resolveDefaultProfile(profiles, 'wt:b', 'wt:a').id, 'wt:b');
  // 'auto' prefers the Windows Terminal default.
  assert.strictEqual(resolveDefaultProfile(profiles, 'auto', 'wt:b').id, 'wt:b');
  // 'auto' without a WT default falls back to the first profile.
  assert.strictEqual(resolveDefaultProfile(profiles, 'auto', null).id, 'wt:a');
  assert.strictEqual(resolveDefaultProfile(profiles, undefined, null).id, 'wt:a');
  // A stale explicit setting falls back to the first profile.
  assert.strictEqual(resolveDefaultProfile(profiles, 'wt:gone', 'wt:b').id, 'wt:a');
  assert.strictEqual(resolveDefaultProfile([], 'auto', null), null);
}

testStripJsonc();
testSplitWindowsCommandLine();
testExpandWindowsEnv();
testParseWindowsTerminalSettings();
testProfileFromWindowsTerminalEntry();
testParseWslDistroList();
testBuildAutoProfiles();
testMergeProfiles();
testResolveDefaultProfile();

console.log('shell profiles tests passed');
