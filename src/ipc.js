const fs = require('fs');
const { ipcRenderer } = require('electron');
const { state, getActiveTab } = require('./state');
const { settings, openSettings } = require('./settings');
const { tabHideRichView, toggleMathMode, renderFileContent } = require('./richView');
const { doCopy, doPaste, doSelectAll } = require('./clipboard');
const { openSearch, closeSearch } = require('./search');
const { createTab, closeTab, switchTab } = require('./tabs');
const { refreshTabTitle } = require('./titleTrack');

function initIpc() {
  ipcRenderer.on('toggle-math-mode', () => toggleMathMode());
  ipcRenderer.on('set-auto-render', (e, val) => {
    state.autoRender = val;
    state.autoIndicator.textContent = state.autoRender ? '\u2B50 AUTO' : 'AUTO OFF';
    state.autoIndicator.className = state.autoRender ? '' : 'off';
    ipcRenderer.send('rebuild-menu', state.autoRender);
  });
  ipcRenderer.on('clear-terminal', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.richVisible) tabHideRichView(tab);
    tab.ptyProc.write('\x0c');
  });
  ipcRenderer.on('open-file', (e, filePath) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    fs.promises.stat(filePath).then(stat => {
      if (stat.size > MAX_FILE_SIZE) return;
      return fs.promises.readFile(filePath, 'utf8');
    }).then(content => {
      if (!content) return;
      const tab = getActiveTab();
      if (tab) renderFileContent(tab, content, filePath);
    }).catch(err => console.error('Failed to open file:', err));
  });
  ipcRenderer.on('show-shortcuts', () => {});
  ipcRenderer.on('open-settings', () => openSettings());
  ipcRenderer.on('new-tab', () => createTab());
  ipcRenderer.on('close-tab', () => { const t = getActiveTab(); if (t) closeTab(t.id); });
  ipcRenderer.on('next-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx + 1) % state.tabs.length].id);
  });
  ipcRenderer.on('prev-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
  });
  ipcRenderer.on('do-copy', () => doCopy());
  ipcRenderer.on('do-paste', () => doPaste());
  ipcRenderer.on('open-search', () => openSearch());
  ipcRenderer.on('set-tab-cwd', (e, cwd) => {
    const tab = getActiveTab();
    if (tab) { tab.cwd = cwd; refreshTabTitle(tab); }
  });
  ipcRenderer.on('select-all', () => doSelectAll());
}

module.exports = { initIpc };
