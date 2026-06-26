function shortHost(host) {
  return String(host || '').trim().split('.')[0].toLowerCase();
}

function isLoopbackHost(host) {
  const value = String(host || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function isRemoteDisplayHost(displayHost, localHost) {
  const host = shortHost(displayHost);
  if (!host || isLoopbackHost(host)) return false;
  const local = shortHost(localHost);
  return !!local && host !== local;
}

function isValidLocalCwd(cwd, adapter) {
  try {
    return typeof cwd === 'string'
      && adapter?.isAbsolute?.(cwd)
      && adapter?.isDirectory?.(cwd);
  } catch {
    return false;
  }
}

function fallbackLocalCwd(adapter) {
  for (const candidate of [adapter?.home, adapter?.fallbackCwd, adapter?.tmpdir]) {
    if (isValidLocalCwd(candidate, adapter)) return candidate;
  }
  return '/';
}

function choosePaneSpawnCwd({ pane = null, inheritCwd = true, adapter, localHost } = {}) {
  const candidates = [];
  if (inheritCwd && pane) {
    if (!isRemoteDisplayHost(pane.displayHost, localHost)) candidates.push(pane.cwd);
    candidates.push(pane.localCwd);
  }
  candidates.push(adapter?.home, adapter?.fallbackCwd, adapter?.tmpdir);
  for (const candidate of candidates) {
    if (isValidLocalCwd(candidate, adapter)) return candidate;
  }
  return fallbackLocalCwd(adapter);
}

module.exports = {
  isRemoteDisplayHost,
  isValidLocalCwd,
  fallbackLocalCwd,
  choosePaneSpawnCwd
};
