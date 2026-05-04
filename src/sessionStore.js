const mt = window.mathterm;
const { state } = require('./state');
const { settings } = require('./settings');
const { configHome } = require('./settingsStore');
const {
  SESSION_VERSION,
  makeCwdAdapter,
  cloneLayout,
  normalizeSessionData,
  validCwd,
  windowToRendererSession
} = require('../sessionFormat');

const SESSION_PATH = mt.path.join(configHome, 'mathterm', 'session.json');
let _saveTimer = 0;
let _lastSentSessionJson = '';
let _sessionDirty = false;
let _blockWritesUntilStructuralChange = false;
let _blockWritesTimer = 0;
const params = new URLSearchParams(window.location.search);
const SESSION_WINDOW_ID = params.get('sessionWindowId') || '1';
const cwdAdapter = makeCwdAdapter({
  fs: mt.fs,
  path: mt.path,
  os: {
    homedir: mt.os.homedir,
    tmpdir: mt.os.tmpdir,
    env: mt.os.env
  },
  fallbackCwd: mt.os.env.HOME
});

function captureSession() {
  return {
    id: SESSION_WINDOW_ID,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces.map(workspace => ({
      id: workspace.id,
      cwd: workspace.cwd || null,
      activePaneId: workspace.activePaneId,
      maximizedPaneId: workspace.maximizedPaneId,
      customTitle: workspace._customTitle || null,
      layout: cloneLayout(workspace.layout),
      panes: workspace.panes.map(pane => ({
        id: pane.id,
        cwd: validCwd(pane.cwd, cwdAdapter),
        autoRender: !!pane.autoRender,
        zoomFactor: pane.zoomFactor ?? 1
      }))
    })).filter(workspace => workspace.layout && workspace.panes.length > 0)
  };
}

function hasSessionFile() {
  try {
    return mt.fs.existsSync(SESSION_PATH);
  } catch {
    return false;
  }
}

function saveSession(opts = {}) {
  if (!settings.restoreLastSession) return;
  if (!opts.force && !_sessionDirty) return;
  const session = captureSession();
  const sessionJson = JSON.stringify(session);
  if (sessionJson === _lastSentSessionJson) {
    _sessionDirty = false;
    return;
  }
  _lastSentSessionJson = sessionJson;
  try {
    mt.ipc.send('save-window-session', session);
    _sessionDirty = false;
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

function clearSession() {
  try { mt.ipc.send('clear-session'); } catch {}
}

function scheduleSessionSave() {
  _sessionDirty = true;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = 0;
    saveSession();
  }, 300);
}

function blockSessionWritesUntilChange() {
  _blockWritesUntilStructuralChange = true;
  _sessionDirty = false;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = 0;
  }
  if (_blockWritesTimer) clearTimeout(_blockWritesTimer);
  _blockWritesTimer = setTimeout(() => {
    _blockWritesUntilStructuralChange = false;
    _blockWritesTimer = 0;
  }, 30000);
}

function readSessionFile() {
  let raw;
  try { raw = mt.fs.readFileSync(SESSION_PATH, 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  return normalizeSessionData(parsed, cwdAdapter);
}

function loadSession() {
  const parsed = readSessionFile();
  if (!parsed) return null;
  const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
  const rawWindow = windows.find(win => String(win.id) === SESSION_WINDOW_ID)
    || (parsed.activeWindowId ? windows.find(win => String(win.id) === String(parsed.activeWindowId)) : null)
    || windows[0];
  return windowToRendererSession(rawWindow, cwdAdapter, { sanitized: true });
}

function initSessionPersistence() {
  window.addEventListener('beforeunload', () => {
    if (!_sessionDirty) return;
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = 0;
    }
    if (settings.restoreLastSession) saveSession();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (settings.restoreLastSession) saveSession();
  });
  window.addEventListener('mathterm-session-changed', event => {
    if (_blockWritesUntilStructuralChange) {
      _blockWritesUntilStructuralChange = false;
      if (_blockWritesTimer) {
        clearTimeout(_blockWritesTimer);
        _blockWritesTimer = 0;
      }
    }
    if (settings.restoreLastSession) scheduleSessionSave();
  });
  window.addEventListener('mathterm-settings-applied', () => {
    if (settings.restoreLastSession) {
      _blockWritesUntilStructuralChange = false;
      saveSession({ force: true });
    }
    else {
      if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = 0;
      }
      clearSession();
    }
  });
}

module.exports = {
  SESSION_PATH,
  captureSession,
  saveSession,
  clearSession,
  hasSessionFile,
  loadSession,
  blockSessionWritesUntilChange,
  initSessionPersistence
};
