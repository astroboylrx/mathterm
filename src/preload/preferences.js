const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

contextBridge.exposeInMainWorld('mathterm', {
  ipc: {
    send: (channel, ...args) => {
      const allowed = ['preferences-saved'];
      if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
    },
    on: (channel, callback) => {
      const allowed = ['preferences-section'];
      if (allowed.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    }
  },

  fs: {
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
    readdirSync: (p) => fs.readdirSync(p),
  },

  path: {
    join: (...args) => path.join(...args),
    dirname: (p) => path.dirname(p),
  },

  os: {
    homedir: () => os.homedir(),
    platform: process.platform,
    env: Object.assign({}, process.env)
  }
});
