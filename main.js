const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createDefaultShortcuts, LEGACY_MAC_SHORTCUTS } = require('./shortcutDefaults');

let mainWindow;
const isMac = process.platform === 'darwin';
app.setName('MathTerm');

const SETTINGS_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'mathterm',
  'mathterm.json'
);

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

function getFocusedWebContents() {
  const win = BrowserWindow.getFocusedWindow();
  return win ? win.webContents : (mainWindow ? mainWindow.webContents : null);
}

function sendFocused(channel, ...args) {
  const wc = getFocusedWebContents();
  if (wc) wc.send(channel, ...args);
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
          click: () => sendFocused('open-settings')
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
            click: () => sendFocused('open-settings')
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
        { label: 'Keyboard Shortcuts', click: () => sendFocused('show-shortcuts') }
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
  Menu.setApplicationMenu(buildMenu(autoRender));
});

ipcMain.on('close-window', (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (opts && opts.quitApp) {
    if (win && !win.isDestroyed()) win.close();
    app.quit();
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
