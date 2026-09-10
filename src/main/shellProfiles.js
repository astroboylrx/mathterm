// Shell profile detection for the main process. All parsing lives in
// ../shared/shellProfiles; this module only does fs/process probing and caches
// the result (restart MathTerm to pick up Windows Terminal config changes).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildAutoProfiles,
  mergeProfiles,
  parseWindowsTerminalSettings,
  parseWslDistroList,
  profileFromWindowsTerminalEntry
} = require('../shared/shellProfiles');

let cachedResult = null;

// Windows environment variable names are case-insensitive (Path vs PATH).
function envGet(env, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(env || {})) {
    if (key.toLowerCase() === lower) return env[key];
  }
  return undefined;
}

// Windows Terminal settings.json candidates, in priority order: stable store
// package, Preview store package, unpackaged install.
function windowsTerminalSettingsPaths(env) {
  const localAppData = envGet(env, 'LOCALAPPDATA');
  if (!localAppData) return [];
  return [
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(localAppData, 'Microsoft', 'Windows Terminal', 'settings.json')
  ];
}

function findOnPath(env, exeName) {
  const pathEnv = envGet(env, 'PATH') || '';
  for (const dir of pathEnv.split(';')) {
    if (!dir) continue;
    const candidate = path.join(dir, exeName);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function detectPwshPath(env) {
  const programFiles = envGet(env, 'ProgramFiles') || 'C:\\Program Files';
  const bundled = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  try {
    if (fs.existsSync(bundled)) return bundled;
  } catch {}
  return findOnPath(env, 'pwsh.exe');
}

function detectGitBashPath(env) {
  const programFiles = envGet(env, 'ProgramFiles') || 'C:\\Program Files';
  const candidate = path.join(programFiles, 'Git', 'bin', 'bash.exe');
  try {
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  return null;
}

function detectWslDistros() {
  try {
    // wsl.exe prints UTF-16LE regardless of the console code page.
    const output = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 3000 });
    return parseWslDistroList(output);
  } catch {
    return [];
  }
}

// Read the first usable Windows Terminal settings file. Returns null when no
// WT config exists or none of its entries map to a usable profile.
function readWindowsTerminalProfiles(env, pwshPath) {
  for (const settingsPath of windowsTerminalSettingsPaths(env)) {
    let text = null;
    try {
      text = fs.readFileSync(settingsPath, 'utf8');
    } catch {
      continue;
    }
    const { entries, defaultGuid } = parseWindowsTerminalSettings(text);
    const profiles = [];
    for (const entry of entries) {
      const profile = profileFromWindowsTerminalEntry(entry, { pwshPath, env });
      if (profile) profiles.push(profile);
    }
    if (!profiles.length) continue;
    const defaultProfileId = defaultGuid && profiles.some(p => p.id === `wt:${defaultGuid}`)
      ? `wt:${defaultGuid}`
      : null;
    return { profiles, defaultProfileId };
  }
  return null;
}

function detectShellProfiles() {
  if (cachedResult) return cachedResult;
  const env = process.env;
  if (process.platform !== 'win32') {
    const profiles = buildAutoProfiles({ platform: process.platform, env });
    cachedResult = { profiles, defaultProfileId: profiles[0] ? profiles[0].id : null, source: 'auto' };
    return cachedResult;
  }
  const pwshPath = detectPwshPath(env);
  const wt = readWindowsTerminalProfiles(env, pwshPath);
  const autoProfiles = buildAutoProfiles({
    platform: 'win32',
    env,
    pwshPath,
    wslDistros: detectWslDistros(),
    gitBashPath: detectGitBashPath(env)
  });
  if (wt) {
    // WT profiles keep their configured order; our own detection appends
    // anything WT does not list (e.g. a distro installed later).
    cachedResult = {
      profiles: mergeProfiles(wt.profiles, autoProfiles),
      defaultProfileId: wt.defaultProfileId,
      source: 'windows-terminal'
    };
  } else {
    cachedResult = {
      profiles: autoProfiles,
      defaultProfileId: autoProfiles[0] ? autoProfiles[0].id : null,
      source: 'auto'
    };
  }
  return cachedResult;
}

module.exports = { detectShellProfiles };
