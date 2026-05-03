const { app, BrowserWindow, Menu, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { createDefaultShortcuts, LEGACY_MAC_SHORTCUTS } = require('./shortcutDefaults');

let mainWindow;
let preferencesWindow;
const isMac = process.platform === 'darwin';
app.setName('MathTerm');

const SETTINGS_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'mathterm',
  'mathterm.json'
);

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

const webPrefs = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(__dirname, 'preload.js')
};

const preferencesWebPrefs = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(__dirname, 'preloadPreferences.js')
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
  preferencesWindow.loadFile('preferences.html', { query: params.toString() });
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
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'MathTerm',
    webPreferences: webPrefs
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && isToggleDevToolsInput(input)) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
  const params = new URLSearchParams();
  if (opts.cwd) params.set('cwd', opts.cwd);
  win.loadFile('index.html', { query: params.toString() || undefined });
  return win;
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
  mainWindow = createWindow();
  Menu.setApplicationMenu(buildMenu(true));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || loadQuitWhenLastTabClosed()) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
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
  createWindow({ cwd: opts?.cwd });
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
