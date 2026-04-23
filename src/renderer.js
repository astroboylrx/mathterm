const { state, getActiveTab, getTabIndex } = require('./state');
const { settings, isMac } = require('./settings');
const { createTab, switchTab } = require('./tabs');
const { toggleMathMode } = require('./richView');
const { closeSearch } = require('./search');
const { closeSettings } = require('./settings');
const { initIpc } = require('./ipc');
const { initClipboardListeners } = require('./clipboard');
const { initSearchListeners } = require('./search');
const { initTabContextListeners } = require('./tabs');

state.tabBar = document.getElementById('tab-bar');
state.termContainer = document.getElementById('terminal-container');
state.modeIndicator = document.getElementById('mode-indicator');
state.autoIndicator = document.getElementById('auto-indicator');
state.mathBtn = document.getElementById('math-btn');
state.searchBar = document.getElementById('search-bar');
state.searchInput = document.getElementById('search-input');
state.searchCount = document.getElementById('search-count');
state.contextMenu = document.getElementById('context-menu');
state.autoRender = settings.autoRender;

window.createTab = createTab;
window.toggleMathMode = toggleMathMode;
window.closeSettings = closeSettings;
window.saveSettings = require('./settings').saveSettings;
window.doSearchPrev = require('./search').doSearchPrev;
window.doSearchNext = require('./search').doSearchNext;
window.closeSearch = closeSearch;

document.addEventListener('keydown', e => {
  if (document.activeElement === state.searchInput) return;

  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (mod && e.key === 'PageDown') {
    e.preventDefault();
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx + 1) % state.tabs.length].id);
    return;
  }
  if (mod && e.key === 'PageUp') {
    e.preventDefault();
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx !== -1 && state.tabs.length > 1) switchTab(state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
    return;
  }
  if (mod && e.key >= '1' && e.key <= '9') {
    const n = parseInt(e.key) - 1;
    if (n < state.tabs.length) { e.preventDefault(); switchTab(state.tabs[n].id); }
    return;
  }

  const tab = getActiveTab();
  if (!tab) return;

  if (e.ctrlKey && e.key === 'ArrowUp') {
    e.preventDefault();
    jumpToPrevPrompt(tab);
    return;
  }
  if (e.ctrlKey && e.key === 'ArrowDown') {
    e.preventDefault();
    jumpToNextPrompt(tab);
    return;
  }

  if (tab.richVisible) return;
});

function jumpToPrevPrompt(tab) {
  const buf = tab.term.buffer.active;
  const currentY = buf.baseY + buf.cursorY;
  const sorted = [...tab._promptYSet].sort((a, b) => b - a);
  for (const y of sorted) {
    if (y < currentY - 1) {
      tab.term.scrollLines(y - currentY);
      return;
    }
  }
}

function jumpToNextPrompt(tab) {
  const buf = tab.term.buffer.active;
  const currentY = buf.baseY + buf.cursorY;
  const sorted = [...tab._promptYSet].sort((a, b) => a - b);
  for (const y of sorted) {
    if (y > currentY + 1) {
      tab.term.scrollLines(y - currentY);
      return;
    }
  }
}

window.addEventListener('resize', () => {
  for (const tab of state.tabs) {
    if (tab.container.classList.contains('active')) tab.fitAddon.fit();
  }
});

initIpc();
initClipboardListeners();
initSearchListeners();
initTabContextListeners();

createTab();
