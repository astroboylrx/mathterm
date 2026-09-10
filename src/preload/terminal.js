const { contextBridge, ipcRenderer, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
let paneSeq = 0;
const paneHandlers = new Map();

ipcRenderer.on('pane-output', (event, payload = {}) => {
  const handlers = paneHandlers.get(String(payload.paneBackendId || ''));
  if (!handlers || handlers.viewId !== payload.viewId) return;
  const meta = {
    batchId: payload.batchId,
    fromSeq: payload.fromSeq,
    toSeq: payload.toSeq
  };
  for (const cb of handlers.dataCallbacks) cb(payload.data || '', meta);
});

ipcRenderer.on('pane-exit', (event, payload = {}) => {
  const paneBackendId = String(payload.paneBackendId || '');
  const handlers = paneHandlers.get(paneBackendId);
  if (!handlers) return;
  for (const cb of handlers.exitCallbacks) cb(payload.exitState || {});
  paneHandlers.delete(paneBackendId);
});

ipcRenderer.on('pane-metadata', (event, payload = {}) => {
  const handlers = paneHandlers.get(String(payload.paneBackendId || ''));
  if (!handlers || handlers.viewId !== payload.viewId) return;
  for (const cb of handlers.metadataCallbacks) {
    cb(payload.metadata || {}, payload.updates || []);
  }
});

function spawnPty(file, args, opts) {
  const requestedPaneBackendId = String(opts?.paneBackendId || `pane-renderer-${Date.now()}-${++paneSeq}`);
  const result = ipcRenderer.sendSync('pane-create-sync', {
    paneBackendId: requestedPaneBackendId,
    shellCmd: file,
    shellArgs: Array.isArray(args) ? args.map(String) : [],
    useShim: opts?.useShim !== false,
    cwd: opts?.cwd,
    cols: opts?.cols,
    rows: opts?.rows,
    scrollback: opts?.scrollback
  });
  if (!result || !result.ok) {
    throw new Error(result?.error || 'Failed to create pane backend');
  }
  const paneBackendId = String(result.paneBackendId || requestedPaneBackendId);
  return createPtyProxy(paneBackendId, { pid: result.pid, afterSeq: 0 });
}

function attachPty(paneBackendId, opts = {}) {
  const id = String(paneBackendId || '');
  if (!id) throw new Error('paneBackendId is required');
  return createPtyProxy(id, {
    pid: opts.pid || null,
    afterSeq: Number(opts.afterSeq) || 0
  });
}

function createPtyProxy(paneBackendId, opts = {}) {
  const viewId = `view-${process.pid}-${Date.now()}-${++paneSeq}`;
  paneHandlers.set(paneBackendId, {
    viewId,
    attached: false,
    afterSeq: Number(opts.afterSeq) || 0,
    dataCallbacks: [],
    exitCallbacks: [],
    metadataCallbacks: []
  });
  return {
    pid: opts.pid || null,
    paneBackendId,
    write: (data) => ipcRenderer.send('pane-input', { paneBackendId, data }),
    resize: (cols, rows) => ipcRenderer.send('pane-resize', { paneBackendId, cols, rows }),
    kill: () => {
      ipcRenderer.send('pane-close', { paneBackendId, viewId });
      paneHandlers.delete(paneBackendId);
    },
    detach: () => {
      ipcRenderer.send('pane-detach', { paneBackendId, viewId });
      paneHandlers.delete(paneBackendId);
    },
    ack: (batchId) => ipcRenderer.send('pane-output-ack', { paneBackendId, viewId, batchId }),
    onData: (cb) => {
      const handlers = paneHandlers.get(paneBackendId);
      if (!handlers) return;
      handlers.dataCallbacks.push(cb);
      if (!handlers.attached) {
        handlers.attached = true;
        ipcRenderer.send('pane-attach-ready', { paneBackendId, viewId, afterSeq: handlers.afterSeq });
      }
    },
    onExit: (cb) => {
      const handlers = paneHandlers.get(paneBackendId);
      if (handlers) handlers.exitCallbacks.push(cb);
    },
    onMetadata: (cb) => {
      const handlers = paneHandlers.get(paneBackendId);
      if (handlers) handlers.metadataCallbacks.push(cb);
    }
  };
}

contextBridge.exposeInMainWorld('mathterm', {
  ipc: {
    send: (channel, ...args) => {
      const allowed = [
        'close-window', 'rebuild-menu', 'notify-command-finished',
        'save-window-session', 'clear-session', 'prepare-live-tab-drag',
        'clear-live-tab-drag', 'diagnostic-log'
      ];
      if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
    },
    on: (channel, callback) => {
      const allowed = [
        'toggle-math-mode', 'set-auto-render', 'clear-terminal', 'open-file',
        'new-tab', 'close-tab',
        'next-tab', 'prev-tab', 'do-copy', 'do-paste', 'open-search',
        'select-all', 'zoom-in', 'zoom-out', 'reset-zoom',
        'export-rich-pdf', 'export-rich-png',
        'split-pane-right', 'split-pane-left', 'split-pane-down', 'split-pane-up',
        'close-pane', 'toggle-pane-maximize',
        'focus-pane-left', 'focus-pane-right', 'focus-pane-up', 'focus-pane-down',
        'focus-next-pane', 'focus-prev-pane',
        'settings-updated', 'live-tab-transfer-complete',
        'live-tab-drag-started', 'live-tab-drag-ended'
      ];
      if (allowed.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    },
    invoke: (channel, ...args) => {
      const allowed = [
        'export-pdf', 'save-png', 'detach-live-tab', 'claim-live-workspace',
        'open-live-tab-transfer-window', 'accept-live-tab-drag',
        'complete-live-tab-drag', 'complete-live-workspace',
        'get-active-live-tab-drag', 'get-live-tab-transfer-state',
        'list-shell-profiles'
      ];
      if (allowed.includes(channel)) return ipcRenderer.invoke(channel, ...args);
      return Promise.reject(new Error('Channel not allowed: ' + channel));
    }
  },

  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text)
  },

  shell: {
    openExternal: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p)
  },

  fs: {
    existsSync: (p) => fs.existsSync(p),
    isDirectorySync: (p) => fs.statSync(p).isDirectory(),
    statSync: (p) => fs.statSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
    mkdtempSync: (prefix) => fs.mkdtempSync(prefix),
    rmSync: (p, opts) => fs.rmSync(p, opts),
    readdirSync: (p) => fs.readdirSync(p),
    statAsync: (p) => fs.promises.stat(p),
    readFileAsync: (p, enc) => fs.promises.readFile(p, enc)
  },

  path: {
    join: (...args) => path.join(...args),
    basename: (p) => path.basename(p),
    dirname: (p) => path.dirname(p),
    isAbsolute: (p) => path.isAbsolute(p)
  },

  os: {
    homedir: () => os.homedir(),
    hostname: () => os.hostname(),
    tmpdir: () => os.tmpdir(),
    userInfo: () => os.userInfo(),
    platform: process.platform,
    env: Object.assign({}, process.env)
  },

  pty: {
    spawn: spawnPty,
    attach: attachPty,
    snapshot: (paneBackendId) => ipcRenderer.invoke('pane-snapshot', { paneBackendId })
  }
});
