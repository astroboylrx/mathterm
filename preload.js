const { contextBridge, ipcRenderer, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

function spawnPty(file, args, opts) {
  const p = pty.spawn(file, args, opts);
  return {
    pid: p.pid,
    write: (data) => p.write(data),
    resize: (cols, rows) => p.resize(cols, rows),
    kill: () => p.kill(),
    onData: (cb) => { p.onData(cb); },
    onExit: (cb) => { p.onExit(cb); }
  };
}

contextBridge.exposeInMainWorld('mathterm', {
  ipc: {
    send: (channel, ...args) => {
      const allowed = ['close-window', 'detach-tab', 'rebuild-menu'];
      if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
    },
    on: (channel, callback) => {
      const allowed = [
        'toggle-math-mode', 'set-auto-render', 'clear-terminal', 'open-file',
        'show-shortcuts', 'open-settings', 'new-tab', 'close-tab',
        'next-tab', 'prev-tab', 'do-copy', 'do-paste', 'open-search',
        'select-all', 'export-rich-pdf', 'export-rich-png'
      ];
      if (allowed.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    },
    invoke: (channel, ...args) => {
      const allowed = ['export-pdf', 'save-png'];
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
    spawn: spawnPty
  }
});
