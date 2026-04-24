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
        'set-tab-cwd', 'select-all'
      ];
      if (allowed.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    }
  },

  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text)
  },

  shell: {
    openExternal: (url) => shell.openExternal(url)
  },

  fs: {
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    mkdtempSync: (prefix) => fs.mkdtempSync(prefix),
    rmSync: (p, opts) => fs.rmSync(p, opts),
    readdirSync: (p) => fs.readdirSync(p),
    statAsync: (p) => fs.promises.stat(p),
    readFileAsync: (p, enc) => fs.promises.readFile(p, enc)
  },

  path: {
    join: (...args) => path.join(...args),
    basename: (p) => path.basename(p),
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
