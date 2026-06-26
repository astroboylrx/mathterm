const SESSION_VERSION = 1;
const MAX_RESTORED_WORKSPACES = 24;
const MAX_RESTORED_PANES = 64;

function makeCwdAdapter({ fs, path, os, fallbackCwd } = {}) {
  if (!fs || !path || !os) {
    throw new Error('session cwd adapter requires fs, path, and os');
  }
  return {
    home: os?.homedir?.() || os?.env?.HOME || null,
    tmpdir: os?.tmpdir?.() || null,
    fallbackCwd: fallbackCwd || null,
    isAbsolute: p => path?.isAbsolute ? path.isAbsolute(p) : typeof p === 'string' && p.startsWith('/'),
    isDirectory: p => {
      try {
        if (!p || !fs?.existsSync?.(p)) return false;
        if (fs.isDirectorySync) return fs.isDirectorySync(p);
        if (fs.statSync) return fs.statSync(p).isDirectory();
        return true;
      } catch {
        return false;
      }
    }
  };
}

function fallbackCwd(adapter) {
  if (!adapter) throw new Error('session cwd adapter is required');
  for (const candidate of [adapter.home, adapter.tmpdir, adapter.fallbackCwd]) {
    if (typeof candidate === 'string' && adapter.isAbsolute(candidate) && adapter.isDirectory(candidate)) {
      return candidate;
    }
  }
  throw new Error('No valid cwd fallback is available');
}

function validCwd(cwd, adapter) {
  if (!adapter) throw new Error('session cwd adapter is required');
  if (typeof cwd === 'string' && adapter.isAbsolute(cwd) && adapter.isDirectory(cwd)) return cwd;
  return fallbackCwd(adapter);
}

function normalizeSizes(sizes, count) {
  const raw = Array.isArray(sizes) && sizes.length === count
    ? sizes.map(size => Number(size)).filter(size => Number.isFinite(size) && size > 0)
    : [];
  if (raw.length !== count) return Array(count).fill(1 / count);
  const sum = raw.reduce((acc, size) => acc + size, 0);
  if (!Number.isFinite(sum) || sum <= 0) return Array(count).fill(1 / count);
  return raw.map(size => size / sum);
}

function cloneLayout(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'pane' && Number.isInteger(node.paneId)) {
    return { type: 'pane', paneId: node.paneId };
  }
  if (node.type !== 'split' || !Array.isArray(node.children) || node.children.length < 2) {
    return null;
  }
  const children = node.children.map(cloneLayout).filter(Boolean);
  if (children.length < 2) return children[0] || null;
  return {
    type: 'split',
    direction: node.direction === 'column' ? 'column' : 'row',
    sizes: normalizeSizes(node.sizes, children.length),
    children
  };
}

function pruneLayoutToPaneRecords(node, rawPanes) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'pane') return Number.isInteger(node.paneId) && rawPanes.has(node.paneId)
    ? { type: 'pane', paneId: node.paneId }
    : null;
  if (node.type !== 'split' || !Array.isArray(node.children) || node.children.length < 2) return null;
  const children = [];
  const keptSizes = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = pruneLayoutToPaneRecords(node.children[i], rawPanes);
    if (child) {
      children.push(child);
      if (Array.isArray(node.sizes) && Number.isFinite(Number(node.sizes[i])) && Number(node.sizes[i]) > 0) {
        keptSizes.push(Number(node.sizes[i]));
      }
    }
  }
  if (children.length < 2) return children[0] || null;
  return {
    type: 'split',
    direction: node.direction === 'column' ? 'column' : 'row',
    sizes: normalizeSizes(keptSizes.length === children.length ? keptSizes : null, children.length),
    children
  };
}

function collectPaneIds(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node.paneId);
  else for (const child of node.children || []) collectPaneIds(child, out);
  return out;
}

function sanitizeWorkspace(raw, counts, adapter) {
  if (!raw || typeof raw !== 'object') return null;
  if (counts.workspaces >= MAX_RESTORED_WORKSPACES) return null;
  const rawPanes = new Map();
  for (const pane of Array.isArray(raw.panes) ? raw.panes : []) {
    if (Number.isInteger(pane.id)) rawPanes.set(pane.id, pane);
  }
  const layout = pruneLayoutToPaneRecords(raw.layout, rawPanes);
  if (!layout) return null;
  const layoutIds = [...new Set(collectPaneIds(layout))];
  if (!layoutIds.length) return null;
  if (counts.panes + layoutIds.length > MAX_RESTORED_PANES) return null;

  counts.workspaces++;
  counts.panes += layoutIds.length;
  const panes = layoutIds.map(id => {
    const pane = rawPanes.get(id) || {};
    return {
      id,
      cwd: validCwd(pane.cwd, adapter),
      localCwd: validCwd(pane.localCwd || pane.cwd, adapter),
      autoRender: !!pane.autoRender,
      zoomFactor: Number.isFinite(Number(pane.zoomFactor))
        ? Math.max(0.4, Math.min(3, Number(pane.zoomFactor)))
        : 1
    };
  });
  return {
    id: Number.isInteger(raw.id) ? raw.id : counts.workspaces,
    cwd: validCwd(raw.cwd, adapter),
    activePaneId: layoutIds.includes(raw.activePaneId) ? raw.activePaneId : layoutIds[0],
    maximizedPaneId: layoutIds.includes(raw.maximizedPaneId) ? raw.maximizedPaneId : null,
    customTitle: typeof raw.customTitle === 'string' && raw.customTitle.trim() ? raw.customTitle.trim() : null,
    layout,
    panes
  };
}

function sanitizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const width = Math.max(360, Math.min(10000, Math.round(Number(bounds.width) || 0)));
  const height = Math.max(240, Math.min(10000, Math.round(Number(bounds.height) || 0)));
  if (!width || !height) return null;
  const out = { width, height };
  if (Number.isFinite(Number(bounds.x))) out.x = Math.round(Number(bounds.x));
  if (Number.isFinite(Number(bounds.y))) out.y = Math.round(Number(bounds.y));
  return out;
}

function sanitizeWindow(raw, counts, adapter, fallbackId = '1') {
  if (!raw || typeof raw !== 'object') return null;
  const workspaces = [];
  for (const workspace of Array.isArray(raw.workspaces) ? raw.workspaces : []) {
    const sanitized = sanitizeWorkspace(workspace, counts, adapter);
    if (sanitized) workspaces.push(sanitized);
  }
  if (!workspaces.length) return null;
  const activeWorkspace = workspaces.find(workspace => workspace.id === raw.activeWorkspaceId) || workspaces[0];
  return {
    id: String(raw.id || fallbackId),
    bounds: sanitizeBounds(raw.bounds),
    isMaximized: !!raw.isMaximized,
    isFullScreen: !!raw.isFullScreen,
    activeWorkspaceId: activeWorkspace.id,
    workspaces
  };
}

function normalizeSessionData(parsed, adapter) {
  if (!adapter) throw new Error('session cwd adapter is required');
  if (!parsed || typeof parsed !== 'object') return null;
  const counts = { workspaces: 0, panes: 0 };
  if (parsed.version !== SESSION_VERSION || !Array.isArray(parsed.windows)) return null;

  const windows = [];
  for (let i = 0; i < parsed.windows.length; i++) {
    const win = sanitizeWindow(parsed.windows[i], counts, adapter, String(i + 1));
    if (win) windows.push(win);
  }
  if (!windows.length) return null;
  let activeWindowId = parsed.activeWindowId || windows[0].id;
  if (!windows.some(win => win.id === String(activeWindowId))) activeWindowId = windows[0].id;
  return {
    version: SESSION_VERSION,
    savedAt: parsed.savedAt || null,
    activeWindowId: String(activeWindowId),
    windows
  };
}

function windowToRendererSession(rawWindow, adapter, opts = {}) {
  if (!adapter) throw new Error('session cwd adapter is required');
  const counts = { workspaces: 0, panes: 0 };
  const win = opts.sanitized ? rawWindow : sanitizeWindow(rawWindow, counts, adapter, rawWindow?.id || '1');
  if (!win) return null;
  let activeIndex = 0;
  const workspaces = win.workspaces.map((workspace, index) => {
    if (workspace.id === win.activeWorkspaceId) activeIndex = index;
    const panesById = new Map(workspace.panes.map(pane => [pane.id, {
      cwd: opts.sanitized ? pane.cwd : validCwd(pane.cwd, adapter),
      localCwd: opts.sanitized ? pane.localCwd : validCwd(pane.localCwd || pane.cwd, adapter),
      autoRender: !!pane.autoRender,
      zoomFactor: opts.sanitized
        ? pane.zoomFactor
        : (Number.isFinite(Number(pane.zoomFactor)) ? Math.max(0.4, Math.min(3, Number(pane.zoomFactor))) : 1)
    }]));
    return {
      cwd: opts.sanitized ? workspace.cwd : validCwd(workspace.cwd, adapter),
      activePaneId: workspace.activePaneId,
      maximizedPaneId: workspace.maximizedPaneId,
      customTitle: workspace.customTitle,
      layout: workspace.layout,
      paneIds: workspace.panes.map(pane => pane.id),
      panesById
    };
  });
  return { workspaces, activeIndex };
}

module.exports = {
  SESSION_VERSION,
  MAX_RESTORED_WORKSPACES,
  MAX_RESTORED_PANES,
  makeCwdAdapter,
  fallbackCwd,
  validCwd,
  normalizeSizes,
  cloneLayout,
  collectPaneIds,
  pruneLayoutToPaneRecords,
  sanitizeWindow,
  normalizeSessionData,
  windowToRendererSession
};
