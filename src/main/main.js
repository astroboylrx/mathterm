const { app, BrowserWindow, Menu, ipcMain, dialog, Notification, screen, shell, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const nodePty = require('node-pty');
const { execFileSync } = require('child_process');
const { createDefaultShortcuts, LEGACY_MAC_SHORTCUTS } = require('../shared/shortcutDefaults');
const { parseCliOptions, cliUsage } = require('../shared/cliOptions');
const { SESSION_VERSION, makeCwdAdapter, normalizeSessionData, sanitizeWindow } = require('../shared/sessionFormat');
const { clampRestoredBounds } = require('../shared/windowBounds');
const { sweepStaleShellShims } = require('./shellShim');
const { PtyManager } = require('./ptyManager');
const { detectShellProfiles } = require('./shellProfiles');

let mainWindow;
let lastFocusedTerminalWindow;
let preferencesWindow;
let aboutWindow;
let nextSessionWindowId = 1;
let appIsQuitting = false;
let suppressActiveWindowWrites = false;
let nextLiveWorkspaceTransferId = 1;
let activeLiveTabDragToken = null;
const isMac = process.platform === 'darwin';
const cliOptions = parseCliOptions(process.argv);
let cliSessionImportFailed = false;
const APP_ROOT = path.join(__dirname, '..', '..');
const ptyManager = new PtyManager({ ptyAdapter: nodePty, fs, path, os, env: process.env });
const paneViews = new Map();
const liveWorkspaceTransfers = new Map();
const DEBUG_LIVE_TAB_DRAG = process.env.MATHTERM_DEBUG_DRAG === '1';
if (cliOptions.help) {
  console.log(cliUsage(path.basename(process.argv[0] || 'mathterm')));
  process.exit(0);
}
app.setName('MathTerm');
try { sweepStaleShellShims({ fs, path, os }); } catch {}
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const SETTINGS_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'mathterm',
  'mathterm.json'
);
const SESSION_PATH = path.join(path.dirname(SETTINGS_PATH), 'session.json');
const LOG_DIR = path.join(path.dirname(SETTINGS_PATH), 'logs');
const DIAGNOSTIC_LOG_PATH = path.join(LOG_DIR, 'diagnostics.log');
const sessionCwdAdapter = makeCwdAdapter({ fs, path, os, fallbackCwd: APP_ROOT });
let APP_VERSION = 'unknown';
try { APP_VERSION = require('../../package.json').version || APP_VERSION; } catch {}
const BUILTIN_THEME_BACKGROUNDS = {
  dark: '#1a1a2e',
  'vscode-dark': '#1e1e1e',
  'tokyo-night': '#1a1b26',
  dracula: '#282a36',
  nord: '#2e3440',
  'solarized-dark': '#002b36',
  'catppuccin-mocha': '#1e1e2e',
  'gruvbox-dark': '#282828',
  'vscode-light': '#ffffff',
  'solarized-light': '#fdf6e3',
  'catppuccin-latte': '#eff1f5',
};

// Mutter ≤ 47 on Wayland crashes Electron's GTK menu bar (Ubuntu 24.04).
// Auto-engage the X11 hint only on the at-risk configuration: Wayland session
// + GNOME desktop + Mutter ≤ 47. Everywhere else (X11 sessions, non-GNOME
// Wayland compositors like KWin/Sway/Hyprland/Weston, Mutter 48+) gets native
// Wayland by default. MATHTERM_OZONE env var and "displayBackend" in
// mathterm.json override the auto-detection. See Wayland_issues.md.
const linuxDisplayBackend = detectLinuxDisplayBackend();

if (process.platform === 'linux') {
  if (linuxDisplayBackend === 'x11') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
  }
}

function configuredLinuxDisplayBackend() {
  if (process.platform !== 'linux') return null;
  const cliChoice = cliLinuxDisplayBackend(process.argv);
  if (cliChoice) return cliChoice;
  const envChoice = process.env.MATHTERM_OZONE;
  if (envChoice === 'wayland' || envChoice === 'x11') return envChoice;
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return parsed && (parsed.displayBackend === 'wayland' || parsed.displayBackend === 'x11')
      ? parsed.displayBackend
      : null;
  } catch {
    return null;
  }
}

function cliLinuxDisplayBackend(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    const value = arg.startsWith('--ozone-platform=')
      ? arg.slice('--ozone-platform='.length)
      : arg === '--ozone-platform'
        ? next
        : arg.startsWith('--ozone-platform-hint=')
          ? arg.slice('--ozone-platform-hint='.length)
          : arg === '--ozone-platform-hint'
            ? next
            : null;
    if (value === 'x11' || value === 'wayland') return value;
  }
  return null;
}

function detectLinuxDisplayBackend() {
  if (process.platform !== 'linux') return null;
  const configured = configuredLinuxDisplayBackend();
  if (configured) return configured;
  if (shouldHintX11Linux()) return 'x11';
  return process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11';
}

function safeReadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function appendDiagnosticLog(event, details = {}) {
  const entry = {
    time: new Date().toISOString(),
    event,
    appVersion: APP_VERSION,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    details
  };
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(DIAGNOSTIC_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch {}
  try {
    console.error(`[mathterm diagnostics] ${event}`, JSON.stringify(details));
  } catch {
    console.error(`[mathterm diagnostics] ${event}`, details);
  }
}

function errorDetails(err) {
  if (!err) return null;
  return {
    name: err.name || null,
    message: err.message || String(err),
    stack: err.stack || null
  };
}

process.on('uncaughtException', err => {
  appendDiagnosticLog('main-uncaught-exception', errorDetails(err));
});

process.on('unhandledRejection', reason => {
  appendDiagnosticLog('main-unhandled-rejection', errorDetails(reason));
});

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function configuredThemeId() {
  const parsed = safeReadJsonFile(SETTINGS_PATH);
  return typeof parsed?.theme === 'string' && parsed.theme ? parsed.theme : 'dark';
}

function userThemeBackground(themeId) {
  if (!themeId || BUILTIN_THEME_BACKGROUNDS[themeId]) return null;
  const parsed = safeReadJsonFile(path.join(path.dirname(SETTINGS_PATH), 'themes', `${themeId}.json`));
  const bg = parsed?.colors?.bg;
  return isHexColor(bg) ? bg.trim() : null;
}

function currentWindowBackgroundColor() {
  const themeId = configuredThemeId();
  return userThemeBackground(themeId) || BUILTIN_THEME_BACKGROUNDS[themeId] || BUILTIN_THEME_BACKGROUNDS.dark;
}

function configuredUiFontSize() {
  const parsed = safeReadJsonFile(SETTINGS_PATH);
  const size = Number(parsed?.fontSize);
  return Number.isFinite(size) ? Math.min(32, Math.max(8, Math.round(size))) : 16;
}

function shouldHintX11Linux() {
  if (process.env.XDG_SESSION_TYPE !== 'wayland') return false;
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  if (!desktop.split(':').some(s => s === 'GNOME' || s === 'UNITY')) return false;
  // On GNOME Wayland: only hint if Mutter (via gnome-shell) is ≤ 47.
  // If we can't read the version, stay safe and hint — gnome-shell should be
  // present on any real GNOME session, so a failure here is unusual.
  try {
    const out = execFileSync('gnome-shell', ['--version'], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/(\d+)(?:\.\d+)*/);
    if (m) return parseInt(m[1], 10) <= 47;
  } catch {}
  return true;
}

function modToCmdOrCtrl(s) {
  if (!s) return '';
  return s.split('+').map(p => /^mod$/i.test(p.trim()) ? 'CmdOrCtrl' : p).join('+');
}

function toElectronShortcuts(shortcuts) {
  const out = {};
  for (const [key, shortcut] of Object.entries(shortcuts)) {
    out[key] = modToCmdOrCtrl(shortcut);
  }
  return out;
}

const DEFAULT_SHORTCUTS = toElectronShortcuts(createDefaultShortcuts(isMac));
const ELECTRON_LEGACY_MAC_SHORTCUTS = toElectronShortcuts(LEGACY_MAC_SHORTCUTS);
let shortcutsCache = null;
const menuCache = new Map();
let appliedMenuAutoRender = null;

function invalidateMenuCache() {
  shortcutsCache = null;
  menuCache.clear();
  appliedMenuAutoRender = null;
}

function loadShortcuts() {
  if (shortcutsCache) return shortcutsCache;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const sc = (parsed && parsed.shortcuts) || {};
    const out = {};
    for (const k of Object.keys(DEFAULT_SHORTCUTS)) {
      const shortcut = modToCmdOrCtrl(sc[k]) || DEFAULT_SHORTCUTS[k];
      out[k] = isMac && shortcut === ELECTRON_LEGACY_MAC_SHORTCUTS[k] ? DEFAULT_SHORTCUTS[k] : shortcut;
    }
    shortcutsCache = out;
    return shortcutsCache;
  } catch {
    shortcutsCache = { ...DEFAULT_SHORTCUTS };
    return shortcutsCache;
  }
}

function loadQuitWhenLastTabClosed() {
  if (!isMac) return false;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return !!parsed.quitWhenLastTabClosed;
  } catch {
    return false;
  }
}

function loadRestoreLastSession() {
  if (cliOptions.sessionPath) return !cliSessionImportFailed;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return !!parsed.restoreLastSession;
  } catch {
    return false;
  }
}

function paneViewKey(paneBackendId, viewId) {
  return `${paneBackendId}:${viewId}`;
}

function registerPaneView(paneBackendId, viewId, wc) {
  paneViews.set(paneViewKey(paneBackendId, viewId), { paneBackendId, viewId, webContentsId: wc.id });
}

function unregisterPaneView(paneBackendId, viewId) {
  paneViews.delete(paneViewKey(paneBackendId, viewId));
}

function detachPaneView(paneBackendId, viewId) {
  if (!paneBackendId || !viewId) return;
  unregisterPaneView(paneBackendId, viewId);
  try { ptyManager.detachView(paneBackendId, viewId); } catch {}
}

function sweepLiveWorkspaceTransfers(now = Date.now()) {
  for (const [token, transfer] of liveWorkspaceTransfers) {
    const age = now - Number(transfer.createdAt || 0);
    const claimedAge = transfer.claimedAt ? now - Number(transfer.claimedAt) : 0;
    if (age > 120000 || claimedAge > 30000) {
      liveWorkspaceTransfers.delete(token);
      if (activeLiveTabDragToken === token) setActiveLiveTabDrag(null);
    }
  }
}

function broadcastToTerminalWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win === preferencesWindow || win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function setActiveLiveTabDrag(token) {
  const next = token ? String(token) : null;
  if (activeLiveTabDragToken === next) return;
  activeLiveTabDragToken = next;
  broadcastToTerminalWindows(next ? 'live-tab-drag-started' : 'live-tab-drag-ended', { token: next });
}

function debugLiveTabDrag(label, details = {}) {
  if (!DEBUG_LIVE_TAB_DRAG) return;
  try {
    console.error(`[mathterm drag] ${label}`, JSON.stringify(details));
  } catch {
    console.error(`[mathterm drag] ${label}`, details);
  }
}

function isUsableCursorPoint(point) {
  return point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y))
    && screen.getAllDisplays().some(display => {
      const bounds = display.bounds || display.workArea || display;
      return Number(point.x) >= bounds.x
        && Number(point.x) < bounds.x + bounds.width
        && Number(point.y) >= bounds.y
        && Number(point.y) < bounds.y + bounds.height;
    });
}

function shouldPlaceLiveDetachWindow() {
  return process.platform !== 'linux' || linuxDisplayBackend !== 'wayland';
}

function getSourceWindowSizeState(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
  return {
    bounds: {
      width: bounds.width,
      height: bounds.height
    }
  };
}

function getSourceWindowDragOffset(sender, payload = {}) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const contentBounds = win.getContentBounds();
  const clientX = Number(payload.dragStartClientX);
  const clientY = Number(payload.dragStartClientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !bounds) {
    debugLiveTabDrag('missing-start-offset', { payload, bounds, contentBounds });
    return null;
  }
  const offset = {
    x: Math.round(contentBounds.x - bounds.x + clientX),
    y: Math.round(contentBounds.y - bounds.y + clientY)
  };
  debugLiveTabDrag('source-offset', { payload, bounds, contentBounds, offset });
  return offset;
}

function screenPointFromPayload(payload = {}) {
  const x = Number(payload.dropScreenX);
  const y = Number(payload.dropScreenY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x === 0 && y === 0 && Number(payload.dropClientX) === 0 && Number(payload.dropClientY) === 0) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function windowStateForLiveDetach(transfer, sender, payload = {}) {
  const windowState = transfer?.sourceWindowState || getSourceWindowSizeState(sender);
  if (!windowState?.bounds) {
    debugLiveTabDrag('missing-window-state', { payload, windowState });
    return windowState;
  }
  if (!shouldPlaceLiveDetachWindow()) {
    debugLiveTabDrag('wayland-placement-skipped', {
      payload,
      linuxDisplayBackend,
      xdgSessionType: process.env.XDG_SESSION_TYPE || null,
      waylandDisplay: process.env.WAYLAND_DISPLAY || null,
      windowState
    });
    return windowState;
  }
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) {
    debugLiveTabDrag('missing-source-window', { payload, windowState });
    return windowState;
  }
  const contentBounds = win.getContentBounds();
  const dropClientX = Number(payload.dropClientX);
  const dropClientY = Number(payload.dropClientY);
  const clientDropPoint = Number.isFinite(dropClientX) && Number.isFinite(dropClientY)
    ? {
        x: Math.round(contentBounds.x + dropClientX),
        y: Math.round(contentBounds.y + dropClientY)
      }
    : null;
  const eventDropPoint = screenPointFromPayload(payload);
  const cursorDropPoint = typeof screen.getCursorScreenPoint === 'function'
    ? screen.getCursorScreenPoint()
    : null;
  const dropPoint = isUsableCursorPoint(eventDropPoint) ? eventDropPoint : cursorDropPoint;
  const dragOffset = transfer?.sourceDragOffset;
  if (!isUsableCursorPoint(dropPoint) || !dragOffset) {
    debugLiveTabDrag('missing-drag-offset', {
      payload,
      windowState,
      contentBounds,
      clientDropPoint,
      eventDropPoint,
      cursorDropPoint,
      dropPoint,
      dragOffset
    });
    return windowState;
  }
  const nextWindowState = {
    ...windowState,
    bounds: {
      ...windowState.bounds,
      x: dropPoint.x - dragOffset.x,
      y: dropPoint.y - dragOffset.y
    }
  };
  debugLiveTabDrag('detach-window-state', {
    payload,
    windowState,
    contentBounds,
    clientDropPoint,
    eventDropPoint,
    cursorDropPoint,
    dropPoint,
    dragOffset,
    nextWindowState
  });
  return nextWindowState;
}

function sendNextPaneOutput(paneBackendId, viewId) {
  const ref = paneViews.get(paneViewKey(paneBackendId, viewId));
  if (!ref) return;
  const wc = webContents.fromId(ref.webContentsId);
  if (!wc || wc.isDestroyed()) {
    try { ptyManager.detachView(paneBackendId, viewId); } catch {}
    unregisterPaneView(paneBackendId, viewId);
    return;
  }
  let batch;
  try { batch = ptyManager.flushOutput(paneBackendId, viewId); } catch { return; }
  if (!batch) return;
  wc.send('pane-output', {
    paneBackendId,
    viewId,
    batchId: batch.batchId,
    fromSeq: batch.fromSeq,
    toSeq: batch.toSeq,
    data: batch.data
  });
}

ptyManager.onOutputReady((paneBackendId) => {
  for (const ref of paneViews.values()) {
    if (ref.paneBackendId === paneBackendId) sendNextPaneOutput(ref.paneBackendId, ref.viewId);
  }
});

ptyManager.onExit((paneBackendId, exitState) => {
  for (const ref of [...paneViews.values()]) {
    if (ref.paneBackendId !== paneBackendId) continue;
    const wc = webContents.fromId(ref.webContentsId);
    if (wc && !wc.isDestroyed()) wc.send('pane-exit', { paneBackendId, exitState });
    unregisterPaneView(ref.paneBackendId, ref.viewId);
  }
});

ptyManager.onMetadata((paneBackendId, metadata, updates) => {
  for (const ref of paneViews.values()) {
    if (ref.paneBackendId !== paneBackendId) continue;
    const wc = webContents.fromId(ref.webContentsId);
    if (wc && !wc.isDestroyed()) wc.send('pane-metadata', {
      paneBackendId,
      viewId: ref.viewId,
      metadata,
      updates
    });
  }
});

function backupInvalidSessionFile(reason) {
  try {
    if (!fs.existsSync(SESSION_PATH)) return;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupPath = path.join(path.dirname(SESSION_PATH), `session.invalid-${stamp}.json`);
    fs.copyFileSync(SESSION_PATH, backupPath);
    console.warn(`Backed up invalid session file to ${backupPath}: ${reason}`);
  } catch (err) {
    console.warn('Failed to back up invalid session file:', err);
  }
}

function readSessionFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    const normalized = normalizeSessionData(parsed, sessionCwdAdapter);
    if (normalized) return normalized;
    backupInvalidSessionFile('unsupported session format');
  } catch (err) {
    if (fs.existsSync(SESSION_PATH)) backupInvalidSessionFile(err.message);
  }
  return { version: SESSION_VERSION, savedAt: null, activeWindowId: null, windows: [] };
}

function writeSessionFile(session) {
  const rawWindows = Array.isArray(session.windows) ? session.windows : [];
  if (!rawWindows.length) {
    try { fs.rmSync(SESSION_PATH, { force: true }); } catch {}
    return;
  }
  const normalized = normalizeSessionData({ ...session, version: SESSION_VERSION }, sessionCwdAdapter);
  const windows = Array.isArray(normalized?.windows) ? normalized.windows.filter(w => w && w.workspaces?.length) : [];
  if (!windows.length) {
    return;
  }
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  const data = JSON.stringify({
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    activeWindowId: normalized.activeWindowId || windows[0].id,
    windows
  }, null, 2) + '\n';
  const tmp = path.join(path.dirname(SESSION_PATH), `.session.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, SESSION_PATH);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

function clearSessionFile() {
  try { fs.rmSync(SESSION_PATH, { force: true }); } catch {}
}

function removeSessionWindow(id) {
  if (!loadRestoreLastSession()) return;
  const session = readSessionFile();
  const windows = Array.isArray(session.windows) ? session.windows.filter(w => String(w.id) !== String(id)) : [];
  const activeWindowId = String(session.activeWindowId) === String(id)
    ? (windows[0]?.id || null)
    : session.activeWindowId;
  writeSessionFile({ ...session, activeWindowId, windows });
}

function readCliSessionFile(sessionPath, cwd = process.cwd()) {
  const sourcePath = path.resolve(cwd, sessionPath);
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const session = normalizeSessionData(parsed, sessionCwdAdapter);
  if (!session || !Array.isArray(session.windows) || !session.windows.some(win => win && win.workspaces?.length)) {
    throw new Error('Session file does not contain any restorable windows.');
  }
  return { sourcePath, session };
}

function importCliSessionFile(options = cliOptions, cwd = process.cwd()) {
  if (!options.sessionPath) return false;
  const sourcePath = path.resolve(cwd, options.sessionPath);
  try {
    const result = readCliSessionFile(options.sessionPath, cwd);
    writeSessionFile(result.session);
    cliSessionImportFailed = false;
    return true;
  } catch (err) {
    cliSessionImportFailed = true;
    dialog.showErrorBox('MathTerm Session Load Failed', `Could not load ${sourcePath}\n\n${err.message}`);
    return false;
  }
}

function markActiveSessionWindow(id) {
  if (suppressActiveWindowWrites) return;
  if (!loadRestoreLastSession()) return;
  const session = readSessionFile();
  if (session.windows && session.windows.length && String(session.activeWindowId) !== String(id)) {
    writeSessionFile({ ...session, activeWindowId: id });
  }
}

const webPrefs = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(APP_ROOT, 'src', 'preload', 'terminal.js')
};

const preferencesWebPrefs = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(APP_ROOT, 'src', 'preload', 'preferences.js')
};

function getFocusedWebContents() {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win || win === preferencesWindow || win.isDestroyed()) return null;
  return win.webContents;
}

function sendFocused(channel, ...args) {
  const wc = getFocusedWebContents();
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, ...args);
}

function getLastTerminalWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  const candidates = [focused, lastFocusedTerminalWindow, mainWindow];
  for (const win of candidates) {
    if (!win || win === preferencesWindow || win === aboutWindow || win.isDestroyed()) continue;
    return win;
  }
  return BrowserWindow.getAllWindows().find(win => (
    win !== preferencesWindow && win !== aboutWindow && !win.isDestroyed()
  )) || null;
}

function openNewWindow() {
  mainWindow = createWindow({ focusInitially: true });
}

function openNewTab() {
  const win = getLastTerminalWindow();
  if (!win) {
    openNewWindow();
    return;
  }
  mainWindow = win;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('new-tab');
}

function normalizePreferencesTab(tab) {
  if (tab === 'settings') return 'appearance';
  return ['appearance', 'behavior', 'shortcuts'].includes(tab) ? tab : 'appearance';
}

function createPreferencesWindow(tab = 'appearance') {
  const targetTab = normalizePreferencesTab(tab);
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    preferencesWindow.show();
    preferencesWindow.focus();
    preferencesWindow.webContents.send('preferences-section', targetTab);
    return preferencesWindow;
  }
  preferencesWindow = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 620,
    minHeight: 520,
    title: 'MathTerm Preferences',
    autoHideMenuBar: true,
    backgroundColor: currentWindowBackgroundColor(),
    webPreferences: preferencesWebPrefs
  });
  attachWindowDiagnostics(preferencesWindow, 'preferences');
  preferencesWindow.setMenuBarVisibility(false);
  preferencesWindow.on('closed', () => {
    preferencesWindow = null;
  });
  const params = new URLSearchParams();
  params.set('tab', targetTab);
  preferencesWindow.loadFile(path.join(APP_ROOT, 'dist', 'preferences.html'), { query: Object.fromEntries(params) });
  return preferencesWindow;
}

function isToggleDevToolsInput(input) {
  if (isMac) {
    return input.meta && input.alt && !input.control && !input.shift && String(input.key).toLowerCase() === 'i';
  }
  return (input.control && input.shift && !input.alt && !input.meta && String(input.key).toLowerCase() === 'i')
    || input.key === 'F12';
}

function attachWindowDiagnostics(win, role) {
  const detailsForWindow = () => ({
    role,
    webContentsId: win.webContents.id,
    url: win.webContents.getURL(),
    bounds: win.isDestroyed() ? null : win.getBounds()
  });
  win.webContents.on('render-process-gone', (event, details) => {
    appendDiagnosticLog('window-render-process-gone', {
      ...detailsForWindow(),
      reason: details?.reason || null,
      exitCode: details?.exitCode ?? null
    });
  });
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appendDiagnosticLog('window-did-fail-load', {
      ...detailsForWindow(),
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });
  win.on('unresponsive', () => {
    appendDiagnosticLog('window-unresponsive', detailsForWindow());
  });
  win.on('responsive', () => {
    appendDiagnosticLog('window-responsive', detailsForWindow());
  });
}

function createWindow(opts = {}) {
  const sessionWindowId = String(opts.sessionWindowId || nextSessionWindowId++);
  let preserveSessionOnClose = false;
  const bounds = opts.windowState?.bounds
    ? clampRestoredBounds(opts.windowState.bounds, screen.getAllDisplays())
    : {};
  const safeBounds = bounds || {};
  const showInitially = opts.showInitially !== false;
  const windowOptions = {
    width: safeBounds.width || 960,
    height: safeBounds.height || 700,
    title: 'MathTerm',
    show: showInitially,
    backgroundColor: currentWindowBackgroundColor(),
    webPreferences: webPrefs
  };
  if (Number.isFinite(safeBounds.x)) windowOptions.x = safeBounds.x;
  if (Number.isFinite(safeBounds.y)) windowOptions.y = safeBounds.y;
  const win = new BrowserWindow({
    ...windowOptions
  });
  attachWindowDiagnostics(win, 'terminal');
  // A rendered markdown file can carry links, and nothing else stops one from
  // navigating the whole window off the app. Keep the renderer on its own page
  // and hand anything else to the OS.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && isToggleDevToolsInput(input)) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
  const params = new URLSearchParams();
  if (opts.cwd) params.set('cwd', opts.cwd);
  if (opts.title) params.set('title', opts.title);
  if (opts.restoreSession) params.set('restoreSession', '1');
  if (opts.forceRestoreSession) params.set('forceRestoreSession', '1');
  if (opts.liveWorkspaceToken) params.set('liveWorkspaceToken', opts.liveWorkspaceToken);
  params.set('sessionWindowId', sessionWindowId);
  win.on('focus', () => {
    mainWindow = win;
    lastFocusedTerminalWindow = win;
    markActiveSessionWindow(sessionWindowId);
  });
  win.on('close', () => {
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    const quitsWhenLastAppWindowCloses = process.platform !== 'darwin' || loadQuitWhenLastTabClosed();
    preserveSessionOnClose = appIsQuitting || (quitsWhenLastAppWindowCloses && windows.length <= 1);
  });
  win.on('closed', () => {
    if (lastFocusedTerminalWindow === win) lastFocusedTerminalWindow = null;
    if (mainWindow === win) {
      mainWindow = BrowserWindow.getAllWindows().find(w => w !== preferencesWindow && !w.isDestroyed()) || null;
    }
    if (!preserveSessionOnClose) removeSessionWindow(sessionWindowId);
  });
  win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { query: Object.fromEntries(params) });
  if (showInitially && opts.focusInitially) {
    win.show();
    win.focus();
  }
  win.once('ready-to-show', () => {
    if (opts.windowState?.isMaximized) win.maximize();
    if (opts.windowState?.isFullScreen) win.setFullScreen(true);
  });
  return win;
}

function createSessionWindows(session, forceRestoreSession = false) {
  const windows = Array.isArray(session?.windows) ? session.windows.filter(w => w && w.workspaces?.length) : [];
  if (!windows.length) return false;
  const maxId = windows.reduce((max, win) => Math.max(max, Number(win.id) || 0), 0);
  nextSessionWindowId = Math.max(nextSessionWindowId, maxId + 1);
  const activeId = session.activeWindowId || windows[0].id;
  const ordered = windows.slice().sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  suppressActiveWindowWrites = true;
  try {
    const created = ordered.map(win => ({
      id: win.id,
      browserWindow: createWindow({
        restoreSession: true,
        forceRestoreSession,
        sessionWindowId: win.id,
        windowState: win,
        showInitially: false
      })
    }));
    const active = created.find(item => item.id === activeId) || created[0];
    for (const item of created) {
      if (item !== active) item.browserWindow.show();
    }
    active?.browserWindow.show();
    active?.browserWindow.focus();
    mainWindow = active?.browserWindow || created[0]?.browserWindow || null;
  } finally {
    suppressActiveWindowWrites = false;
  }
  return true;
}

function createStartupWindows() {
  if (loadRestoreLastSession()) {
    const session = readSessionFile();
    if (createSessionWindows(session, !!cliOptions.sessionPath && !cliSessionImportFailed)) {
      return true;
    }
  }
  mainWindow = createWindow({
    restoreSession: true,
    forceRestoreSession: !!cliOptions.sessionPath && !cliSessionImportFailed
  });
  return false;
}

function openFileInMathMode() {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  dialog.showOpenDialog(win, {
    filters: [
      { name: 'Documents', extensions: ['md', 'txt', 'tex', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  }).then(result => {
    if (!result.canceled && result.filePaths.length > 0) {
      sendFocused('open-file', result.filePaths[0]);
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function readableTextColor(backgroundColor) {
  const match = /^#([0-9a-f]{6})$/i.exec(backgroundColor || '');
  if (!match) return '#f4f4f5';
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#111827' : '#f4f4f5';
}

function imageDataUrl(filePath) {
  try {
    return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return '';
  }
}

function aboutDialogHtml({ version, iconUrl, copyright, fontSize, backgroundColor }) {
  const foreground = readableTextColor(backgroundColor);
  const dim = foreground === '#111827' ? '#4b5563' : '#a1a1aa';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>About MathTerm</title>
  <style>
    :root {
      color-scheme: ${foreground === '#111827' ? 'light' : 'dark'};
      --ui-font-size: ${fontSize}px;
      --bg: ${backgroundColor};
      --fg: ${foreground};
      --dim: ${dim};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--fg);
      font: var(--ui-font-size)/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(100vw, 420px);
      padding: 22px 28px;
      display: grid;
      justify-items: center;
      gap: 12px;
      text-align: center;
    }
    img { width: 72px; height: 72px; display: block; }
    .name { font-weight: 650; }
    .version, .copyright { color: var(--dim); }
  </style>
</head>
<body>
  <main>
    ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="">` : ''}
    <div class="name">MathTerm</div>
    <div class="version">Version ${escapeHtml(version)}</div>
    <div class="copyright">${escapeHtml(copyright)}</div>
  </main>
</body>
</html>`;
}

function showAboutDialog() {
  const version = app.getVersion ? app.getVersion() : 'unknown';
  const iconPath = path.join(APP_ROOT, 'assets', 'icons', 'png', '256x256.png');
  const copyright = 'Copyright © 2026 Rixin Li';
  if (isMac && typeof app.showAboutPanel === 'function') {
    app.setAboutPanelOptions({
      applicationName: 'MathTerm',
      applicationVersion: version,
      version,
      copyright,
      iconPath
    });
    app.showAboutPanel();
    return;
  }

  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }

  const parent = BrowserWindow.getFocusedWindow() || mainWindow || null;
  const fontSize = configuredUiFontSize();
  const backgroundColor = currentWindowBackgroundColor();
  aboutWindow = new BrowserWindow({
    width: Math.max(380, Math.round(fontSize * 26)),
    height: Math.max(248, Math.round(fontSize * 16)),
    useContentSize: true,
    parent,
    modal: !!parent,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: 'About MathTerm',
    backgroundColor,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  attachWindowDiagnostics(aboutWindow, 'about');
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
  aboutWindow.once('ready-to-show', () => {
    if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.show();
  });
  const iconUrl = imageDataUrl(iconPath);
  const html = aboutDialogHtml({ version, iconUrl, copyright, fontSize, backgroundColor });
  aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function buildMenu(autoRender) {
  const cacheKey = autoRender ? 'auto' : 'manual';
  if (menuCache.has(cacheKey)) return menuCache.get(cacheKey);
  const sc = loadShortcuts();
  const template = [
    ...(isMac ? [{
      label: 'MathTerm',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => createPreferencesWindow('appearance')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: '&Workspace',
      submenu: [
        {
          label: 'New Window',
          accelerator: isMac ? 'CmdOrCtrl+N' : 'CmdOrCtrl+Shift+N',
          click: openNewWindow
        },
        {
          label: 'New Tab',
          accelerator: isMac ? 'CmdOrCtrl+T' : 'CmdOrCtrl+Shift+T',
          click: openNewTab
        },
        { type: 'separator' },
        {
          label: 'Open File in Math Mode...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: openFileInMathMode
        },
        {
          label: 'Export Math View as PDF...',
          click: () => sendFocused('export-rich-pdf')
        },
        {
          label: 'Export Math View as PNG...',
          click: () => sendFocused('export-rich-png')
        },
        { type: 'separator' },
        {
          label: 'Close Pane',
          accelerator: sc.closePane,
          registerAccelerator: false,
          click: () => sendFocused('close-pane')
        },
        {
          label: 'Close Tab',
          click: () => sendFocused('close-tab')
        },
        { role: 'close', label: 'Close Window' },
        ...(isMac ? [] : [{
          label: 'Quit',
          accelerator: 'Ctrl+Q',
          click: () => app.quit()
        }])
      ]
    },
    {
      label: '&Edit',
      submenu: [
        {
          label: 'Copy',
          accelerator: sc.copy,
          registerAccelerator: false,
          click: () => sendFocused('do-copy')
        },
        {
          label: 'Paste',
          accelerator: sc.paste,
          registerAccelerator: false,
          click: () => sendFocused('do-paste')
        },
        {
          label: 'Select All',
          accelerator: sc.selectAll,
          registerAccelerator: false,
          click: () => sendFocused('select-all')
        },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: sc.openSearch,
          registerAccelerator: false,
          click: () => sendFocused('open-search')
        },
        ...(isMac ? [] : [
          { type: 'separator' },
          {
            label: 'Preferences...',
            click: () => createPreferencesWindow('appearance')
          }
        ])
      ]
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          registerAccelerator: false,
          click: () => sendFocused('zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          registerAccelerator: false,
          click: () => sendFocused('zoom-out')
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          registerAccelerator: false,
          click: () => sendFocused('reset-zoom')
        },
        { type: 'separator' },
        {
          label: 'Toggle Math Mode',
          accelerator: sc.toggleMath,
          registerAccelerator: false,
          click: () => sendFocused('toggle-math-mode')
        },
        {
          label: 'Auto-Render LaTeX',
          type: 'checkbox',
          accelerator: sc.toggleAutoRender,
          registerAccelerator: false,
          checked: autoRender,
          click: item => sendFocused('set-auto-render', item.checked)
        },
        { type: 'separator' },
        {
          label: 'Split Pane Left',
          click: () => sendFocused('split-pane-left')
        },
        {
          label: 'Split Pane Right',
          accelerator: sc.splitPaneRight,
          registerAccelerator: false,
          click: () => sendFocused('split-pane-right')
        },
        {
          label: 'Split Pane Up',
          click: () => sendFocused('split-pane-up')
        },
        {
          label: 'Split Pane Down',
          accelerator: sc.splitPaneDown,
          registerAccelerator: false,
          click: () => sendFocused('split-pane-down')
        },
        {
          label: 'Maximize Pane',
          accelerator: sc.togglePaneMaximize,
          registerAccelerator: false,
          click: () => sendFocused('toggle-pane-maximize')
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Navi',
      submenu: [
        {
          label: 'Next Tab',
          accelerator: isMac ? 'CmdOrCtrl+Shift+]' : 'CmdOrCtrl+PageDown',
          registerAccelerator: false,
          click: () => sendFocused('next-tab')
        },
        {
          label: 'Previous Tab',
          accelerator: isMac ? 'CmdOrCtrl+Shift+[' : 'CmdOrCtrl+PageUp',
          registerAccelerator: false,
          click: () => sendFocused('prev-tab')
        },
        { type: 'separator' },
        ...(isMac ? [
          {
            label: 'Next Pane',
            accelerator: sc.nextPane,
            registerAccelerator: false,
            click: () => sendFocused('focus-next-pane')
          },
          {
            label: 'Previous Pane',
            accelerator: sc.prevPane,
            registerAccelerator: false,
            click: () => sendFocused('focus-prev-pane')
          }
        ] : []),
        { type: 'separator' },
        {
          label: 'Focus Pane Left',
          accelerator: isMac ? 'CmdOrCtrl+Alt+Left' : 'Alt+Left',
          registerAccelerator: false,
          click: () => sendFocused('focus-pane-left')
        },
        {
          label: 'Focus Pane Right',
          accelerator: isMac ? 'CmdOrCtrl+Alt+Right' : 'Alt+Right',
          registerAccelerator: false,
          click: () => sendFocused('focus-pane-right')
        },
        {
          label: 'Focus Pane Up',
          accelerator: isMac ? 'CmdOrCtrl+Alt+Up' : 'Alt+Up',
          registerAccelerator: false,
          click: () => sendFocused('focus-pane-up')
        },
        {
          label: 'Focus Pane Down',
          accelerator: isMac ? 'CmdOrCtrl+Alt+Down' : 'Alt+Down',
          registerAccelerator: false,
          click: () => sendFocused('focus-pane-down')
        }
      ]
    },
    {
      label: '&Window',
      submenu: isMac ? [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ] : [
        { role: 'minimize' },
      ]
    },
    {
      label: '&Help',
      submenu: [
        ...(isMac ? [] : [
          { label: 'About MathTerm', click: showAboutDialog },
          { type: 'separator' }
        ]),
        { label: 'Keyboard Shortcuts', click: () => createPreferencesWindow('shortcuts') }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menuCache.set(cacheKey, menu);
  return menu;
}

function setApplicationMenuForAutoRender(autoRender, opts = {}) {
  const active = !!autoRender;
  if (!opts.force && appliedMenuAutoRender === active) return;
  Menu.setApplicationMenu(buildMenu(active));
  appliedMenuAutoRender = active;
}

function setMacDockMenu() {
  if (!isMac || !app.dock) return;
  app.dock.setMenu(Menu.buildFromTemplate([
    { label: 'New Window', click: openNewWindow },
    { label: 'New Tab', click: openNewTab }
  ]));
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  importCliSessionFile();
  createStartupWindows();
  setApplicationMenuForAutoRender(true, { force: true });
  setMacDockMenu();
});

app.on('before-quit', () => {
  appIsQuitting = true;
});

app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (!app.isReady()) return;
  const secondOptions = parseCliOptions(commandLine);
  if (secondOptions.sessionPath) {
    const sourcePath = path.resolve(workingDirectory || process.cwd(), secondOptions.sessionPath);
    try {
      const { session } = readCliSessionFile(secondOptions.sessionPath, workingDirectory || process.cwd());
      writeSessionFile(session);
      if (createSessionWindows(session, true)) {
        setApplicationMenuForAutoRender(true, { force: true });
        return;
      }
    } catch (err) {
      dialog.showErrorBox('MathTerm Session Load Failed', `Could not load ${sourcePath}\n\n${err.message}`);
    }
  }
  mainWindow = createWindow();
  setApplicationMenuForAutoRender(true, { force: true });
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || loadQuitWhenLastTabClosed()) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createStartupWindows();
    setApplicationMenuForAutoRender(true, { force: true });
  }
});

app.on('child-process-gone', (event, details) => {
  appendDiagnosticLog('child-process-gone', {
    type: details?.type || null,
    reason: details?.reason || null,
    exitCode: details?.exitCode ?? null,
    serviceName: details?.serviceName || null,
    name: details?.name || null
  });
});

ipcMain.on('rebuild-menu', (event, autoRender) => {
  setApplicationMenuForAutoRender(!!autoRender);
});

ipcMain.on('diagnostic-log', (event, payload = {}) => {
  appendDiagnosticLog('renderer-diagnostic', {
    webContentsId: event.sender.id,
    payload
  });
});

ipcMain.on('preferences-saved', (event, settings) => {
  invalidateMenuCache();
  setApplicationMenuForAutoRender(!!(settings && settings.autoRender), { force: true });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== event.sender) {
      win.webContents.send('settings-updated', settings || {});
    }
  }
});

ipcMain.on('save-window-session', (event, payload = {}) => {
  if (!loadRestoreLastSession()) return;
  const id = String(payload.id || '');
  if (!id) return;
  const session = readSessionFile();
  const windows = Array.isArray(session.windows) ? session.windows.filter(w => String(w.id) !== id) : [];
  const win = BrowserWindow.fromWebContents(event.sender);
  if (Array.isArray(payload.workspaces) && payload.workspaces.length) {
    const incomingWindow = sanitizeWindow({
      id,
      bounds: win && !win.isDestroyed() ? win.getBounds() : payload.bounds || null,
      isMaximized: !!(win && !win.isDestroyed() && win.isMaximized()),
      isFullScreen: !!(win && !win.isDestroyed() && win.isFullScreen()),
      activeWorkspaceId: payload.activeWorkspaceId,
      workspaces: payload.workspaces
    }, { workspaces: 0, panes: 0 }, sessionCwdAdapter, id);
    if (!incomingWindow) return;
    windows.push(incomingWindow);
  }
  const activeWindowId = win && !win.isDestroyed() && win.isFocused()
    ? id
    : (session.activeWindowId || id);
  writeSessionFile({ ...session, activeWindowId, windows });
});

ipcMain.on('clear-session', () => {
  clearSessionFile();
});

ipcMain.on('notify-command-finished', (event, payload = {}) => {
  const webContentsId = event.sender.id;
  if (!Notification.isSupported()) {
    appendDiagnosticLog('notification-unsupported', {
      webContentsId
    });
    return;
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const title = String(payload.title || 'Command finished').slice(0, 80);
  const body = String(payload.body || '').slice(0, 240);
  const notification = new Notification({
    title,
    body,
    silent: false
  });
  notification.on('failed', (_event, error) => {
    appendDiagnosticLog('notification-failed', {
      webContentsId,
      titleLength: title.length,
      bodyLength: body.length,
      error: errorDetails(error)
    });
  });
  notification.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
});

ipcMain.on('close-window', (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (opts && opts.quitApp) {
    if (win && !win.isDestroyed()) win.close();
    const openWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w !== win);
    if (openWindows.length === 0) app.quit();
    return;
  }
  if (win) win.close();
});

ipcMain.handle('detach-live-tab', async (event, payload = {}) => {
  sweepLiveWorkspaceTransfers();
  const workspace = payload && typeof payload === 'object' ? payload.workspace : null;
  const panes = Array.isArray(workspace?.panes) ? workspace.panes : [];
  if (!workspace || !panes.length) return { ok: false, error: 'No live workspace was provided.' };
  for (const pane of panes) {
    if (!ptyManager.getPane(String(pane.paneBackendId || ''))) {
      return { ok: false, error: `Unknown pane backend: ${pane.paneBackendId || ''}` };
    }
  }
  const token = `live-workspace-${Date.now()}-${nextLiveWorkspaceTransferId++}`;
  liveWorkspaceTransfers.set(token, {
    workspace,
    sourceWebContentsId: event.sender.id,
    sourceWorkspaceId: workspace.id,
    sourceWindowState: getSourceWindowSizeState(event.sender),
    createdAt: Date.now()
  });
  createWindow({
    liveWorkspaceToken: token,
    title: workspace.customTitle || workspace.title,
    windowState: getSourceWindowSizeState(event.sender)
  });
  return { ok: true, token };
});

ipcMain.handle('claim-live-workspace', async (event, token) => {
  const key = String(token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  if (!transfer) return { ok: false, error: 'Live workspace transfer is no longer available.' };
  if (transfer.claimed) return { ok: false, error: 'Live workspace transfer was already claimed.' };
  const error = validateLiveWorkspace(transfer.workspace);
  if (error) {
    liveWorkspaceTransfers.delete(key);
    if (activeLiveTabDragToken === key) setActiveLiveTabDrag(null);
    return { ok: false, error };
  }
  transfer.claimed = true;
  transfer.claimedAt = Date.now();
  transfer.claimedByWebContentsId = event.sender.id;
  return { ok: true, workspace: transfer.workspace };
});

function validateLiveWorkspace(workspace) {
  const panes = Array.isArray(workspace?.panes) ? workspace.panes : [];
  if (!workspace || !panes.length) return 'No live workspace was provided.';
  for (const pane of panes) {
    if (!ptyManager.getPane(String(pane.paneBackendId || ''))) {
      return `Unknown pane backend: ${pane.paneBackendId || ''}`;
    }
  }
  return null;
}

ipcMain.on('prepare-live-tab-drag', (event, payload = {}) => {
  sweepLiveWorkspaceTransfers();
  const token = String(payload.token || '');
  const workspace = payload && typeof payload === 'object' ? payload.workspace : null;
  const error = validateLiveWorkspace(workspace);
  if (!token || error) return;
  const sourceWindowState = getSourceWindowSizeState(event.sender);
  const sourceDragOffset = getSourceWindowDragOffset(event.sender, payload);
  debugLiveTabDrag('prepare', {
    token,
    sourceWebContentsId: event.sender.id,
    payload: {
      dragStartClientX: payload.dragStartClientX,
      dragStartClientY: payload.dragStartClientY,
      dragStartScreenX: payload.dragStartScreenX,
      dragStartScreenY: payload.dragStartScreenY
    },
    sourceWindowState,
    sourceDragOffset
  });
  liveWorkspaceTransfers.set(token, {
    workspace,
    sourceWebContentsId: event.sender.id,
    sourceWorkspaceId: workspace.id,
    sourceWindowState,
    sourceDragOffset,
    createdAt: Date.now()
  });
  setActiveLiveTabDrag(token);
});

ipcMain.handle('open-live-tab-transfer-window', async (event, payload) => {
  const request = payload && typeof payload === 'object' ? payload : { token: payload };
  const key = String(request.token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  debugLiveTabDrag('open-request', {
    token: key,
    sourceWebContentsId: transfer?.sourceWebContentsId,
    senderId: event.sender.id,
    request
  });
  if (!transfer) return { ok: false, error: 'Live tab drag is no longer available.' };
  if (transfer.sourceWebContentsId !== event.sender.id) {
    return { ok: false, error: 'Live tab drag does not belong to this window.' };
  }
  if (transfer.claimed) return { ok: false, error: 'Live tab drag was already claimed.' };
  const error = validateLiveWorkspace(transfer.workspace);
  if (error) {
    liveWorkspaceTransfers.delete(key);
    if (activeLiveTabDragToken === key) setActiveLiveTabDrag(null);
    return { ok: false, error };
  }
  setActiveLiveTabDrag(null);
  createWindow({
    liveWorkspaceToken: key,
    title: transfer.workspace.customTitle || transfer.workspace.title,
    windowState: windowStateForLiveDetach(transfer, event.sender, request),
    focusInitially: true
  });
  return { ok: true, token: key };
});

ipcMain.handle('accept-live-tab-drag', async (event, token) => {
  const key = String(token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  if (!transfer) return { ok: false, error: 'Live tab drag is no longer available.' };
  if (transfer.claimed) return { ok: false, error: 'Live tab drag was already claimed.' };
  if (transfer.sourceWebContentsId === event.sender.id) {
    return { ok: false, error: 'Live tab drag cannot be accepted by its source window.' };
  }
  const error = validateLiveWorkspace(transfer.workspace);
  if (error) {
    liveWorkspaceTransfers.delete(key);
    if (activeLiveTabDragToken === key) setActiveLiveTabDrag(null);
    return { ok: false, error };
  }
  transfer.claimed = true;
  transfer.claimedAt = Date.now();
  transfer.claimedByWebContentsId = event.sender.id;
  setActiveLiveTabDrag(null);
  return { ok: true, workspace: transfer.workspace };
});

ipcMain.handle('get-active-live-tab-drag', async () => {
  sweepLiveWorkspaceTransfers();
  if (!activeLiveTabDragToken) return { ok: true, token: null };
  const transfer = liveWorkspaceTransfers.get(activeLiveTabDragToken);
  if (!transfer || transfer.claimed) {
    setActiveLiveTabDrag(null);
    return { ok: true, token: null };
  }
  return { ok: true, token: activeLiveTabDragToken };
});

ipcMain.handle('get-live-tab-transfer-state', async (_event, token) => {
  sweepLiveWorkspaceTransfers();
  const key = String(token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  return {
    ok: true,
    exists: !!transfer,
    claimed: !!transfer?.claimed,
    sourceWebContentsId: transfer?.sourceWebContentsId ?? null,
    claimedByWebContentsId: transfer?.claimedByWebContentsId ?? null
  };
});

ipcMain.on('clear-live-tab-drag', (event, payload = {}) => {
  const token = String(payload.token || '');
  if (!token || token !== activeLiveTabDragToken) return;
  setTimeout(() => {
    const transfer = liveWorkspaceTransfers.get(token);
    if (activeLiveTabDragToken === token && (!transfer || !transfer.claimed)) {
      setActiveLiveTabDrag(null);
    }
  }, 2000);
});

ipcMain.handle('complete-live-tab-drag', async (event, token) => {
  const key = String(token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  if (!transfer || transfer.claimedByWebContentsId !== event.sender.id) {
    return { ok: false, error: 'Live tab drag completion is no longer valid.' };
  }
  liveWorkspaceTransfers.delete(key);
  const source = webContents.fromId(transfer.sourceWebContentsId);
  if (source && !source.isDestroyed()) {
    source.send('live-tab-transfer-complete', {
      workspaceId: transfer.sourceWorkspaceId,
      token: key
    });
  }
  return { ok: true };
});

ipcMain.handle('complete-live-workspace', async (event, token) => {
  const key = String(token || '');
  const transfer = liveWorkspaceTransfers.get(key);
  if (!transfer || transfer.claimedByWebContentsId !== event.sender.id) {
    return { ok: false, error: 'Live workspace completion is no longer valid.' };
  }
  liveWorkspaceTransfers.delete(key);
  const source = webContents.fromId(transfer.sourceWebContentsId);
  if (source && !source.isDestroyed()) {
    source.send('live-tab-transfer-complete', {
      workspaceId: transfer.sourceWorkspaceId,
      token: key
    });
  }
  return { ok: true };
});

// Renderer panes normally pass an explicit profile command; this is only a
// last-resort fallback (win32 has no SHELL env var to lean on).
function defaultShellCommand() {
  if (process.platform === 'win32') {
    try {
      const { profiles } = detectShellProfiles();
      if (profiles.length) return profiles[0].command;
    } catch {}
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

ipcMain.handle('list-shell-profiles', async () => {
  try {
    const { profiles, defaultProfileId, source } = detectShellProfiles();
    return { ok: true, profiles, defaultProfileId, source };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// WSL panes run an in-distro VT proxy (see wslVtProxy.js) that answers OSC
// 10/11/12 color queries itself. The proxy is installed lazily here at spawn
// time — never during profile detection — so startup never blocks the main
// process on wsl.exe round-trips for distros that may not even be running.
// WSLENV carries the pane's theme colors and truecolor capability across the
// wsl.exe boundary.
const { maybeWrapWslSpawn, wslPaneEnvExtras } = require('./wslVtProxy');

ipcMain.on('pane-create-sync', (event, opts = {}) => {
  try {
    const spawn = maybeWrapWslSpawn(
      opts.shellCmd || defaultShellCommand(),
      Array.isArray(opts.shellArgs) ? opts.shellArgs.map(String) : []
    );
    const backend = ptyManager.createPane({
      paneBackendId: String(opts.paneBackendId || ''),
      shellCmd: spawn.shellCmd,
      shellArgs: spawn.shellArgs,
      useShim: opts.useShim !== false,
      cwd: opts.cwd || process.env.HOME || os.homedir(),
      cols: Number.isInteger(opts.cols) ? opts.cols : 80,
      rows: Number.isInteger(opts.rows) ? opts.rows : 24,
      scrollback: Number.isInteger(opts.scrollback) ? opts.scrollback : 1000,
      envExtras: wslPaneEnvExtras(opts.shellCmd, opts.terminalColors)
    });
    event.returnValue = { ok: true, paneBackendId: backend.id, pid: backend.pty.pid };
  } catch (err) {
    event.returnValue = { ok: false, error: err.message || String(err) };
  }
});

ipcMain.on('pane-attach-ready', (event, opts = {}) => {
  const paneBackendId = String(opts.paneBackendId || '');
  const viewId = String(opts.viewId || '');
  if (!paneBackendId || !viewId) return;
  try {
    registerPaneView(paneBackendId, viewId, event.sender);
    ptyManager.attachView(paneBackendId, viewId);
    ptyManager.enqueueReplay(paneBackendId, viewId, Number(opts.afterSeq) || 0);
    sendNextPaneOutput(paneBackendId, viewId);
  } catch (err) {
    event.sender.send('pane-exit', { paneBackendId, exitState: { error: err.message || String(err) } });
  }
});

ipcMain.handle('pane-snapshot', async (event, opts = {}) => {
  try {
    const paneBackendId = String(opts.paneBackendId || '');
    if (!paneBackendId) throw new Error('paneBackendId is required');
    const snapshot = await ptyManager.snapshotPane(paneBackendId);
    return { ok: true, paneBackendId, ...snapshot };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.on('pane-input', (event, opts = {}) => {
  try { ptyManager.writePane(String(opts.paneBackendId || ''), String(opts.data || '')); } catch {}
});

ipcMain.on('pane-resize', (event, opts = {}) => {
  const cols = Math.max(2, Math.floor(Number(opts.cols) || 0));
  const rows = Math.max(1, Math.floor(Number(opts.rows) || 0));
  try { ptyManager.resizePane(String(opts.paneBackendId || ''), cols, rows); } catch {}
});

ipcMain.on('pane-output-ack', (event, opts = {}) => {
  const paneBackendId = String(opts.paneBackendId || '');
  const viewId = String(opts.viewId || '');
  try {
    ptyManager.ackOutput(paneBackendId, viewId, opts.batchId);
    sendNextPaneOutput(paneBackendId, viewId);
  } catch {}
});

ipcMain.on('pane-detach', (event, opts = {}) => {
  detachPaneView(String(opts.paneBackendId || ''), String(opts.viewId || ''));
});

ipcMain.on('pane-close', (event, opts = {}) => {
  const paneBackendId = String(opts.paneBackendId || '');
  const viewId = String(opts.viewId || '');
  if (paneBackendId && viewId) unregisterPaneView(paneBackendId, viewId);
  try { ptyManager.closePane(paneBackendId); } catch {}
});

ipcMain.handle('export-pdf', async (event) => {
  const wc = event.sender;
  const win = BrowserWindow.fromWebContents(wc);
  try {
    const data = await wc.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Math View as PDF',
      defaultPath: 'mathterm-export.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, data);
    return { path: result.filePath };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle('save-png', async (event, dataUrl) => {
  const wc = event.sender;
  const win = BrowserWindow.fromWebContents(wc);
  try {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Math View as PNG',
      defaultPath: 'mathterm-export.png',
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base64 = String(dataUrl).split(',')[1] || '';
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { path: result.filePath };
  } catch (err) {
    return { error: String(err) };
  }
});
