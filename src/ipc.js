const mt = window.mathterm;
const { state, getActiveTab } = require('./state');
const { settings, openSettings } = require('./settings');
const { tabHideRichView, toggleMathMode, renderFileContent } = require('./richView');
const { doCopy, doPaste, doSelectAll } = require('./clipboard');
const { openSearch, closeSearch } = require('./search');
const { createTab, closeTab, switchTab } = require('./tabs');
const { openShortcuts } = require('./shortcuts');
const { exportPdf, exportPng } = require('./export');

function initIpc() {
  mt.ipc.on('toggle-math-mode', () => toggleMathMode());
  mt.ipc.on('set-auto-render', (val) => {
    const tab = getActiveTab();
    if (tab) tab.autoRender = val;
    const active = tab ? tab.autoRender : false;
    state.autoIndicator.textContent = 'AUTO';
    state.autoIndicator.className = active ? '' : 'off';
    mt.ipc.send('rebuild-menu', active);
  });
  mt.ipc.on('clear-terminal', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.richVisible) tabHideRichView(tab);
    tab.ptyProc.write('\x0c');
  });
  mt.ipc.on('open-file', (filePath) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    mt.fs.statAsync(filePath).then(stat => {
      if (stat.size > MAX_FILE_SIZE) return;
      return mt.fs.readFileAsync(filePath, 'utf8');
    }).then(content => {
      if (!content) return;
      const tab = getActiveTab();
      if (tab) renderFileContent(tab, content, filePath);
    }).catch(err => console.error('Failed to open file:', err));
  });
  mt.ipc.on('show-shortcuts', () => openShortcuts());
  mt.ipc.on('open-settings', () => openSettings());
  mt.ipc.on('new-tab', () => createTab());
  mt.ipc.on('close-tab', () => { const t = getActiveTab(); if (t) closeTab(t.id); });
  mt.ipc.on('next-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx + 1) % state.tabs.length].id);
  });
  mt.ipc.on('prev-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
  });
  mt.ipc.on('do-copy', () => doCopy());
  mt.ipc.on('do-paste', () => doPaste());
  mt.ipc.on('open-search', () => openSearch());
  mt.ipc.on('select-all', () => doSelectAll());
  mt.ipc.on('export-rich-pdf', () => { exportPdf().catch(err => console.error('PDF export failed:', err)); });
  mt.ipc.on('export-rich-png', () => { exportPng().catch(err => console.error('PNG export failed:', err)); });
}

module.exports = { initIpc };
