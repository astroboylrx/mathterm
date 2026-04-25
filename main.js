const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

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

function buildMenu(autoRender) {
  return Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        {
          label: 'Open File in Math Mode...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            dialog.showOpenDialog(win, {
              filters: [
                { name: 'Documents', extensions: ['md', 'txt', 'tex', 'markdown'] },
                { name: 'All Files', extensions: ['*'] }
              ],
              properties: ['openFile']
            }).then(result => {
              if (!result.canceled && result.filePaths.length > 0) {
                const wc = getFocusedWebContents();
                if (wc) wc.send('open-file', result.filePaths[0]);
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('new-tab'); }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('close-tab'); }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+Shift+C',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('do-copy'); }
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+Shift+V',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('do-paste'); }
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+Shift+A',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('select-all'); }
        },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+Shift+F',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('open-search'); }
        },
        { type: 'separator' },
        {
          label: 'Clear Terminal',
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('clear-terminal'); }
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('open-settings'); }
        }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        {
          label: 'Toggle Math Mode',
          accelerator: 'CmdOrCtrl+Shift+M',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('toggle-math-mode'); }
        },
        { type: 'separator' },
        {
          label: 'Auto-Render LaTeX',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Shift+R',
          registerAccelerator: false,
          checked: autoRender,
          click: item => { const wc = getFocusedWebContents(); if (wc) wc.send('set-auto-render', item.checked); }
        },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: '&Tabs',
      submenu: [
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+PageDown',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('next-tab'); }
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+PageUp',
          registerAccelerator: false,
          click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('prev-tab'); }
        }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => { const wc = getFocusedWebContents(); if (wc) wc.send('show-shortcuts'); } }
      ]
    }
  ]);
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'MathTerm',
    webPreferences: webPrefs
  });
  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(buildMenu(true));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new BrowserWindow({
      width: 960,
      height: 700,
      title: 'MathTerm',
      webPreferences: webPrefs
    });
    mainWindow.loadFile('index.html');
    Menu.setApplicationMenu(buildMenu(true));
  }
});

ipcMain.on('rebuild-menu', (event, autoRender) => {
  Menu.setApplicationMenu(buildMenu(autoRender));
});

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('detach-tab', (event, opts) => {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'MathTerm',
    webPreferences: webPrefs
  });
  const params = new URLSearchParams();
  if (opts?.cwd) params.set('cwd', opts.cwd);
  win.loadFile('index.html', { query: params.toString() || undefined });
});
