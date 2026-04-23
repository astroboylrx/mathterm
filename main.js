const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

function buildMenu(autoRender) {
  return Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        {
          label: 'Open File in Math Mode...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            dialog.showOpenDialog(mainWindow, {
              filters: [
                { name: 'Documents', extensions: ['md', 'txt', 'tex', 'markdown'] },
                { name: 'All Files', extensions: ['*'] }
              ],
              properties: ['openFile']
            }).then(result => {
              if (!result.canceled && result.filePaths.length > 0) {
                mainWindow.webContents.send('open-file', result.filePaths[0]);
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow.webContents.send('new-tab')
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow.webContents.send('close-tab')
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
          click: () => mainWindow.webContents.send('do-copy')
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => mainWindow.webContents.send('do-paste')
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow.webContents.send('select-all')
        },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow.webContents.send('open-search')
        },
        { type: 'separator' },
        {
          label: 'Clear Terminal',
          click: () => mainWindow.webContents.send('clear-terminal')
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          click: () => mainWindow.webContents.send('open-settings')
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
          click: () => mainWindow.webContents.send('toggle-math-mode')
        },
        { type: 'separator' },
        {
          label: 'Auto-Render LaTeX',
          type: 'checkbox',
          checked: autoRender,
          click: item => mainWindow.webContents.send('set-auto-render', item.checked)
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
          click: () => mainWindow.webContents.send('next-tab')
        },
        {
          label: 'Previous Tab',
          click: () => mainWindow.webContents.send('prev-tab')
        }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => mainWindow.webContents.send('show-shortcuts') }
      ]
    }
  ]);
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'MathTerm',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(buildMenu(true));
});

app.on('window-all-closed', () => app.quit());

ipcMain.on('rebuild-menu', (event, autoRender) => {
  Menu.setApplicationMenu(buildMenu(autoRender));
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('detach-tab', (event, opts) => {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'MathTerm',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    if (opts?.cwd) win.webContents.send('set-tab-cwd', opts.cwd);
  });
});
