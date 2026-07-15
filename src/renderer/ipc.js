const mt = window.mathterm;
const { state, getActivePane, getActiveWorkspace } = require('./state');
const { settings, reloadSettingsFromDisk, replaceSettings, applySettings, requestMenuRebuild } = require('./settings');
const { tabHideRichView, toggleMathMode, renderFileContent } = require('./richView');
const { doCopy, doPaste, doSelectAll } = require('./clipboard');
const { openSearch, closeSearch } = require('./search');
const { createTab, closeTab, switchTab, splitPaneRight, splitPaneLeft, splitPaneDown, splitPaneUp, closeActivePane, focusPaneInDirection, focusNextPane, focusPrevPane, togglePaneMaximize } = require('./tabs');
const { exportPdf, exportPng } = require('./export');
const { zoomInActiveTab, zoomOutActiveTab, resetActiveZoom } = require('./zoom');

function initIpc() {
  mt.ipc.on('toggle-math-mode', () => toggleMathMode());
  mt.ipc.on('set-auto-render', (val) => {
    const tab = getActivePane();
    if (tab) tab.autoRender = val;
    const active = tab ? tab.autoRender : false;
    state.autoIndicator.textContent = 'AUTO';
    state.autoIndicator.className = active ? '' : 'off';
    requestMenuRebuild(active);
  });
  mt.ipc.on('clear-terminal', () => {
    const tab = getActivePane();
    if (!tab) return;
    if (tab.richVisible) tabHideRichView(tab);
    tab.ptyProc.write('\x0c');
  });
  mt.ipc.on('terminal-undo', () => {
    const pane = getActivePane();
    if (!pane || pane.richVisible || !pane.ptyProc) return;
    pane.ptyProc.write('\x1f');
    pane.term?.focus();
  });
  mt.ipc.on('open-file', (filePath) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    mt.fs.statAsync(filePath).then(stat => {
      if (stat.size > MAX_FILE_SIZE) return;
      return mt.fs.readFileAsync(filePath, 'utf8');
    }).then(content => {
      if (!content) return;
      const tab = getActivePane();
      if (tab) renderFileContent(tab, content, filePath);
    }).catch(err => console.error('Failed to open file:', err));
  });
  mt.ipc.on('settings-updated', next => {
    if (next && Object.keys(next).length) replaceSettings(next);
    else reloadSettingsFromDisk();
    applySettings();
  });
  mt.ipc.on('new-tab', () => createTab());
  mt.ipc.on('close-tab', () => { const w = getActiveWorkspace(); if (w) closeTab(w.id); });
  mt.ipc.on('next-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeWorkspaceId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx + 1) % state.tabs.length].id);
  });
  mt.ipc.on('prev-tab', () => {
    const idx = state.tabs.findIndex(t => t.id === state.activeWorkspaceId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
  });
  mt.ipc.on('split-pane-right', () => splitPaneRight());
  mt.ipc.on('split-pane-left', () => splitPaneLeft());
  mt.ipc.on('split-pane-down', () => splitPaneDown());
  mt.ipc.on('split-pane-up', () => splitPaneUp());
  mt.ipc.on('close-pane', () => closeActivePane());
  mt.ipc.on('toggle-pane-maximize', () => togglePaneMaximize());
  mt.ipc.on('focus-pane-left', () => focusPaneInDirection('left'));
  mt.ipc.on('focus-pane-right', () => focusPaneInDirection('right'));
  mt.ipc.on('focus-pane-up', () => focusPaneInDirection('up'));
  mt.ipc.on('focus-pane-down', () => focusPaneInDirection('down'));
  mt.ipc.on('focus-next-pane', () => focusNextPane());
  mt.ipc.on('focus-prev-pane', () => focusPrevPane());
  mt.ipc.on('do-copy', () => doCopy());
  mt.ipc.on('do-paste', () => doPaste());
  mt.ipc.on('open-search', () => openSearch());
  mt.ipc.on('select-all', () => doSelectAll());
  mt.ipc.on('zoom-in', () => zoomInActiveTab());
  mt.ipc.on('zoom-out', () => zoomOutActiveTab());
  mt.ipc.on('reset-zoom', () => resetActiveZoom());
  mt.ipc.on('export-rich-pdf', () => { exportPdf().catch(err => console.error('PDF export failed:', err)); });
  mt.ipc.on('export-rich-png', () => { exportPng().catch(err => console.error('PNG export failed:', err)); });
}

module.exports = { initIpc };
