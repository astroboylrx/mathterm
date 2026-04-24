const { state, getActiveTab, getTabIndex } = require('./state');
const { settings, isMac, applySettings } = require('./settings');
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

applySettings();

window.createTab = createTab;
window.toggleMathMode = toggleMathMode;
window.toggleAutoRender = function() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.autoRender = !tab.autoRender;
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = tab.autoRender ? '' : 'off';
  window.mathterm.ipc.send('rebuild-menu', tab.autoRender);
};
window.closeSettings = closeSettings;
window.saveSettings = require('./settings').saveSettings;
window.doSearchPrev = require('./search').doSearchPrev;
window.doSearchNext = require('./search').doSearchNext;
window.closeSearch = closeSearch;

document.addEventListener('keydown', e => {
  if (document.activeElement === state.searchInput) return;

  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (mod && e.shiftKey) {
    const key = e.key.toLowerCase();
    const tab = getActiveTab();
    if (key === 'm' && tab) {
      e.preventDefault();
      toggleMathMode();
      return;
    }
    if (key === 'f') {
      e.preventDefault();
      const { openSearch } = require('./search');
      openSearch();
      return;
    }
    if (!tab || !tab.richVisible) return;
    const richActions = { c: 'do-copy', v: 'do-paste', a: 'select-all' };
    const action = richActions[key];
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      const { doCopy, doPaste, doSelectAll } = require('./clipboard');
      if (action === 'do-copy') doCopy();
      else if (action === 'do-paste') doPaste();
      else if (action === 'select-all') doSelectAll();
      return;
    }
  }

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

  if (tab.richVisible) {
    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault();
      const { tabHideRichView } = require('./richView');
      tabHideRichView(tab);
    } else if (e.key === 'PageDown' || (e.shiftKey && e.key === 'PageDown')) {
      e.preventDefault();
      tab.richView.scrollTop += tab.richView.clientHeight * 0.9;
    } else if (e.key === 'PageUp' || (e.shiftKey && e.key === 'PageUp')) {
      e.preventDefault();
      tab.richView.scrollTop -= tab.richView.clientHeight * 0.9;
    } else if (e.key === 'Home') {
      e.preventDefault();
      tab.richView.scrollTop = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      tab.richView.scrollTop = tab.richView.scrollHeight;
    } else if (e.key === 'ArrowDown') {
      tab.richView.scrollTop += 40;
    } else if (e.key === 'ArrowUp') {
      tab.richView.scrollTop -= 40;
    } else if (e.key === ' ') {
      e.preventDefault();
      tab.richView.scrollTop += tab.richView.clientHeight * 0.9;
    }
    return;
  }

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

const urlCwd = new URLSearchParams(window.location.search).get('cwd');
createTab(urlCwd || undefined);

const firstTab = getActiveTab();
if (firstTab) {
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = firstTab.autoRender ? '' : 'off';
}
