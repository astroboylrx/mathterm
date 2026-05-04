const { app, BrowserWindow, Menu, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { createDefaultShortcuts, LEGACY_MAC_SHORTCUTS } = require('../shared/shortcutDefaults');
const { parseCliOptions, cliUsage } = require('../shared/cliOptions');
const { SESSION_VERSION, makeCwdAdapter, normalizeSessionData, sanitizeWindow } = require('../shared/sessionFormat');

let mainWindow;
let preferencesWindow;
let nextSessionWindowId = 1;
let appIsQuitting = false;
let suppressActiveWindowWrites = false;
const isMac = process.platform === 'darwin';
const cliOptions = parseCliOptions(process.argv);
let cliSessionImportFailed = false;
const APP_ROOT = path.join(__dirname, '..', '..');
if (cliOptions.help) {
  console.log(cliUsage(path.basename(process.argv[0] || 'mathterm')));
  process.exit(0);
}
app.setName('MathTerm');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const SETTINGS_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'mathterm',
  'mathterm.json'
);
const SESSION_PATH = path.join(path.dirname(SETTINGS_PATH), 'session.json');
const sessionCwdAdapter = makeCwdAdapter({ fs, path, os, fallbackCwd: APP_ROOT });

// Mutter ≤ 47 on Wayland crashes Electron's GTK menu bar (Ubuntu 24.04).
// Auto-engage the X11 hint only on the at-risk configuration: Wayland session
// + GNOME desktop + Mutter ≤ 47. Everywhere else (X11 sessions, non-GNOME
// Wayland compositors like KWin/Sway/Hyprland/Weston, Mutter 48+) gets native
// Wayland by default. MATHTERM_OZONE env var and "displayBackend" in
// mathterm.json override the auto-detection. See Wayland_issues.md.
if (process.platform === 'linux') {
  const envChoice = process.env.MATHTERM_OZONE;
  let backend;
  if (envChoice === 'wayland' || envChoice === 'x11') {
    backend = envChoice;
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      backend = parsed && parsed.displayBackend;
    } catch {}
  }
  const useX11 = backend === 'x11' || (backend !== 'wayland' && shouldHintX11Linux());
  if (useX11) {
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
  }
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

function loadShortcuts() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const sc = (parsed && parsed.shortcuts) || {};
    const out = {};
    for (const k of Object.keys(DEFAULT_SHORTCUTS)) {
      const shortcut = modToCmdOrCtrl(sc[k]) || DEFAULT_SHORTCUTS[k];
      out[k] = isMac && shortcut === ELECTRON_LEGACY_MAC_SHORTCUTS[k] ? DEFAULT_SHORTCUTS[k] : shortcut;
    }
    return out;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
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

function createPreferencesWindow(tab = 'settings') {
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    preferencesWindow.show();
    preferencesWindow.focus();
    preferencesWindow.webContents.send('preferences-section', tab);
    return preferencesWindow;
  }
  preferencesWindow = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 620,
    minHeight: 520,
    title: 'MathTerm Preferences',
    autoHideMenuBar: true,
    webPreferences: preferencesWebPrefs
  });
  preferencesWindow.setMenuBarVisibility(false);
  preferencesWindow.on('closed', () => {
    preferencesWindow = null;
  });
  const params = new URLSearchParams();
  params.set('tab', tab === 'shortcuts' ? 'shortcuts' : 'settings');
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

function createWindow(opts = {}) {
  const sessionWindowId = String(opts.sessionWindowId || nextSessionWindowId++);
  let preserveSessionOnClose = false;
  const bounds = opts.windowState?.bounds || {};
  const windowOptions = {
    width: bounds.width || 960,
    height: bounds.height || 700,
    title: 'MathTerm',
    show: opts.showInitially !== false,
    webPreferences: webPrefs
  };
  if (Number.isFinite(bounds.x)) windowOptions.x = bounds.x;
  if (Number.isFinite(bounds.y)) windowOptions.y = bounds.y;
  const win = new BrowserWindow({
    ...windowOptions
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
  params.set('sessionWindowId', sessionWindowId);
  win.on('focus', () => markActiveSessionWindow(sessionWindowId));
  win.on('close', () => {
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    const quitsWhenLastAppWindowCloses = process.platform !== 'darwin' || loadQuitWhenLastTabClosed();
    preserveSessionOnClose = appIsQuitting || (quitsWhenLastAppWindowCloses && windows.length <= 1);
  });
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = BrowserWindow.getAllWindows().find(w => w !== preferencesWindow && !w.isDestroyed()) || null;
    }
    if (!preserveSessionOnClose) removeSessionWindow(sessionWindowId);
  });
  win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { query: Object.fromEntries(params) });
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

function buildMenu(autoRender) {
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
          click: () => createPreferencesWindow('settings')
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
      label: '&File',
      submenu: [
        {
          label: 'Open File in Math Mode...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: openFileInMathMode
        },
        { type: 'separator' },
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
          label: 'New Window',
          accelerator: isMac ? 'CmdOrCtrl+N' : 'CmdOrCtrl+Shift+N',
          click: () => { mainWindow = createWindow(); }
        },
        {
          label: 'New Tab',
          accelerator: isMac ? 'CmdOrCtrl+T' : 'CmdOrCtrl+Shift+T',
          click: () => sendFocused('new-tab')
        },
        {
          label: 'Close Workspace',
          click: () => sendFocused('close-tab')
        },
        ...(isMac ? [] : [
          { type: 'separator' },
          { role: 'close' }
        ])
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
            click: () => createPreferencesWindow('settings')
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
        { type: 'separator' },
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
          label: 'Split Pane Right',
          accelerator: sc.splitPaneRight,
          registerAccelerator: false,
          click: () => sendFocused('split-pane-right')
        },
        {
          label: 'Split Pane Down',
          accelerator: sc.splitPaneDown,
          registerAccelerator: false,
          click: () => sendFocused('split-pane-down')
        },
        {
          label: 'Close Pane',
          accelerator: sc.closePane,
          registerAccelerator: false,
          click: () => sendFocused('close-pane')
        },
        {
          label: 'Maximize Pane',
          accelerator: sc.togglePaneMaximize,
          registerAccelerator: false,
          click: () => sendFocused('toggle-pane-maximize')
        },
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
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Tabs',
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
        }
      ]
    },
    ...(isMac ? [{
      role: 'windowMenu'
    }] : [{
      label: '&Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }]),
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => createPreferencesWindow('shortcuts') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  importCliSessionFile();
  createStartupWindows();
  Menu.setApplicationMenu(buildMenu(true));
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
        Menu.setApplicationMenu(buildMenu(true));
        return;
      }
    } catch (err) {
      dialog.showErrorBox('MathTerm Session Load Failed', `Could not load ${sourcePath}\n\n${err.message}`);
    }
  }
  mainWindow = createWindow();
  Menu.setApplicationMenu(buildMenu(true));
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || loadQuitWhenLastTabClosed()) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createStartupWindows();
    Menu.setApplicationMenu(buildMenu(true));
  }
});

ipcMain.on('rebuild-menu', (event, autoRender) => {
  Menu.setApplicationMenu(buildMenu(!!autoRender));
});

ipcMain.on('preferences-saved', (event, settings) => {
  Menu.setApplicationMenu(buildMenu(!!(settings && settings.autoRender)));
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
  if (!Notification.isSupported()) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  const title = String(payload.title || 'Command finished').slice(0, 80);
  const body = String(payload.body || '').slice(0, 240);
  const notification = new Notification({
    title,
    body,
    silent: false
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

ipcMain.on('detach-tab', (event, opts) => {
  createWindow({ cwd: opts?.cwd, title: opts?.title });
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
