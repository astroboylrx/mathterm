// Pure shell-profile logic: no fs, no process spawning. Platform detection and
// Windows Terminal settings parsing are pure functions so they can be unit
// tested with injected data.

// Remove JSONC comments (// and /* */, skipping string contents) and trailing
// commas so Windows Terminal settings.json can be parsed with JSON.parse.
function stripJsonc(text) {
  const src = String(text ?? '');
  let out = '';
  let inString = false;
  let i = 0;
  const isWhitespace = ch => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < src.length && isWhitespace(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// Split a Windows command line using the CommandLineToArgvW quoting rules:
// whitespace separates args outside double quotes, backslashes are literal
// unless they precede a quote (2n backslashes + quote => n backslashes and a
// quote toggle; 2n+1 backslashes + quote => n backslashes and a literal quote).
function splitWindowsCommandLine(str) {
  const args = [];
  const s = String(str ?? '');
  let current = '';
  let inQuotes = false;
  let hasArg = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      let count = 0;
      while (i < s.length && s[i] === '\\') {
        count++;
        i++;
      }
      if (s[i] === '"') {
        current += '\\'.repeat(Math.floor(count / 2));
        if (count % 2 === 1) {
          current += '"';
        } else {
          inQuotes = !inQuotes;
          hasArg = true;
        }
        i++;
      } else {
        current += '\\'.repeat(count);
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasArg = true;
      i++;
      continue;
    }
    if ((ch === ' ' || ch === '\t') && !inQuotes) {
      if (hasArg || current) {
        args.push(current);
        current = '';
        hasArg = false;
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (hasArg || current) args.push(current);
  return args;
}

// Expand %VAR% references with a case-insensitive lookup, like cmd.exe does.
// Unknown variables are left untouched.
function expandWindowsEnv(str, env = {}) {
  const lookup = new Map();
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string') lookup.set(key.toLowerCase(), value);
  }
  return String(str ?? '').replace(/%([^%]+)%/g, (match, name) => {
    const value = lookup.get(String(name).toLowerCase());
    return value !== undefined ? value : match;
  });
}

// Parse Windows Terminal settings.json text into the raw profile entries plus
// the default profile GUID. Invalid input yields empty results.
function parseWindowsTerminalSettings(text) {
  const empty = { entries: [], defaultGuid: null };
  let parsed;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  const list = parsed.profiles && Array.isArray(parsed.profiles.list) ? parsed.profiles.list : [];
  return {
    entries: list.filter(entry => entry && typeof entry === 'object'),
    defaultGuid: typeof parsed.defaultProfile === 'string' && parsed.defaultProfile
      ? parsed.defaultProfile
      : null
  };
}

function windowsCommandBasename(command) {
  const base = String(command || '').split(/[\\/]/).pop() || '';
  return base.replace(/\.exe$/i, '') || base;
}

// Map one Windows Terminal profile entry to a MathTerm profile, or null when
// the entry should be skipped (hidden, or an unsupported dynamic source).
function profileFromWindowsTerminalEntry(entry, { pwshPath = null, env = {} } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.hidden) return null;
  const guid = typeof entry.guid === 'string' && entry.guid ? entry.guid : null;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null;
  if (!guid && !name) return null;
  const id = `wt:${guid || name}`;

  const commandline = typeof entry.commandline === 'string' ? entry.commandline.trim() : '';
  if (commandline) {
    const tokens = splitWindowsCommandLine(expandWindowsEnv(commandline, env));
    if (!tokens.length || !tokens[0]) return null;
    return {
      id,
      name: name || windowsCommandBasename(tokens[0]),
      command: tokens[0],
      args: tokens.slice(1),
      useShim: false
    };
  }
  if (entry.source === 'Windows.Terminal.Wsl') {
    if (!name) return null;
    // --cd ~ lands in the Linux home directory instead of the Windows cwd.
    return { id, name, command: 'wsl.exe', args: ['-d', name, '--cd', '~'], useShim: false };
  }
  if (entry.source === 'Windows.Terminal.PowershellCore') {
    return { id, name: name || 'PowerShell', command: pwshPath || 'pwsh.exe', args: [], useShim: false };
  }
  return null;
}

// Parse `wsl.exe -l -q` output (already decoded from UTF-16LE) into distro
// names. Filter out docker-desktop helpers and lines that look like localized
// prompts rather than distro names.
function parseWslDistroList(output) {
  const distros = [];
  for (const rawLine of String(output ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\0/g, '').trim();
    if (!line) continue;
    if (/^docker-desktop/i.test(line)) continue;
    if (/\s/.test(line)) continue;
    if (line.length > 50) continue;
    distros.push(line);
  }
  return distros;
}

// Build the profile list from our own detection. On POSIX this is exactly the
// historical hard-coded spawn behavior: the login shell with the shim.
function buildAutoProfiles({ platform, env = {}, pwshPath = null, wslDistros = [], gitBashPath = null } = {}) {
  if (platform !== 'win32') {
    return [{
      id: 'posix:default',
      name: 'Default',
      command: env.SHELL || '/bin/bash',
      args: [],
      useShim: true
    }];
  }
  const profiles = [];
  if (pwshPath) {
    profiles.push({ id: 'auto:pwsh', name: 'PowerShell', command: pwshPath, args: [], useShim: false });
  }
  profiles.push({ id: 'auto:powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: [], useShim: false });
  profiles.push({ id: 'auto:cmd', name: 'Command Prompt', command: 'cmd.exe', args: [], useShim: false });
  for (const distro of Array.isArray(wslDistros) ? wslDistros : []) {
    if (!distro) continue;
    profiles.push({ id: `auto:wsl:${distro}`, name: distro, command: 'wsl.exe', args: ['-d', distro, '--cd', '~'], useShim: false });
  }
  if (gitBashPath) {
    profiles.push({ id: 'auto:git-bash', name: 'Git Bash', command: gitBashPath, args: ['--login', '-i'], useShim: false });
  }
  return profiles;
}

// Dedupe key: the executable basename (case-insensitive, ".exe" stripped), so
// a bare `powershell.exe` and an expanded `%SystemRoot%\...\powershell.exe`
// count as the same shell. Args are ignored: a Windows Terminal entry the user
// customized with extra flags should win over our bare auto-detected duplicate
// of that same shell. wsl.exe keys on the distro so different distributions
// stay distinct.
function profileKey(profile) {
  const exe = windowsCommandBasename(profile.command).toLowerCase();
  if (exe === 'wsl') {
    const args = Array.isArray(profile.args) ? profile.args : [];
    const i = args.indexOf('-d');
    return `wsl:${i >= 0 && args[i + 1] ? String(args[i + 1]).toLowerCase() : ''}`;
  }
  return exe;
}

// Append fallback profiles that are not already in the primary list.
function mergeProfiles(primary, fallback) {
  const merged = [];
  const seen = new Set();
  for (const list of [primary, fallback]) {
    for (const profile of Array.isArray(list) ? list : []) {
      if (!profile || !profile.command) continue;
      const key = profileKey(profile);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(profile);
    }
  }
  return merged;
}

// Resolve which profile a new pane should use: an explicit setting wins, then
// 'auto' prefers the Windows Terminal default, then the first profile.
function resolveDefaultProfile(profiles, setting, wtDefaultId) {
  if (!Array.isArray(profiles) || !profiles.length) return null;
  if (typeof setting === 'string' && setting && setting !== 'auto') {
    return profiles.find(p => p.id === setting) || profiles[0];
  }
  if (typeof wtDefaultId === 'string' && wtDefaultId) {
    const hit = profiles.find(p => p.id === wtDefaultId);
    if (hit) return hit;
  }
  return profiles[0];
}

module.exports = {
  stripJsonc,
  splitWindowsCommandLine,
  expandWindowsEnv,
  parseWindowsTerminalSettings,
  profileFromWindowsTerminalEntry,
  parseWslDistroList,
  buildAutoProfiles,
  mergeProfiles,
  resolveDefaultProfile
};
