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
state.autoIndicator = document.getElementById('auto-indicator');
state.mathBtn = document.getElementById('math-btn');
state.cwdLink = document.getElementById('cwd-link');
state.gitSep = document.getElementById('git-sep');
state.gitBranch = document.getElementById('git-branch');
state.cwdLink.addEventListener('click', () => {
  const cwd = state.cwdLink.dataset.cwd;
  if (cwd) window.mathterm.shell.openPath(cwd);
});
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
window.closeShortcuts = require('./shortcuts').closeShortcuts;
window.saveSettings = require('./settings').saveSettings;
window.doSearchPrev = require('./search').doSearchPrev;
window.doSearchNext = require('./search').doSearchNext;
window.closeSearch = closeSearch;

const { parseShortcut, matchShortcut } = require('./keybindings');

let _bindings = {};
function rebuildBindings() {
  _bindings = {};
  for (const [name, str] of Object.entries(settings.shortcuts || {})) {
    const parsed = parseShortcut(str);
    if (parsed) _bindings[name] = parsed;
  }
}
rebuildBindings();

document.addEventListener('keydown', e => {
  if (document.activeElement === state.searchInput) return;

  const tab = getActiveTab();

  if (matchShortcut(_bindings.toggleMath, e, isMac) && tab) {
    e.preventDefault();
    toggleMathMode();
    return;
  }
  if (matchShortcut(_bindings.openSearch, e, isMac)) {
    e.preventDefault();
    require('./search').openSearch();
    return;
  }
  if (matchShortcut(_bindings.toggleAutoRender, e, isMac)) {
    e.preventDefault();
    window.toggleAutoRender();
    return;
  }
  if (tab && tab.richVisible) {
    if (matchShortcut(_bindings.copy, e, isMac)) {
      e.preventDefault(); e.stopPropagation();
      require('./clipboard').doCopy();
      return;
    }
    if (matchShortcut(_bindings.paste, e, isMac)) {
      e.preventDefault(); e.stopPropagation();
      require('./clipboard').doPaste();
      return;
    }
    if (matchShortcut(_bindings.selectAll, e, isMac)) {
      e.preventDefault(); e.stopPropagation();
      require('./clipboard').doSelectAll();
      return;
    }
  }

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

  if (matchShortcut(_bindings.prevPrompt, e, isMac)) {
    e.preventDefault();
    jumpToPrevPrompt(tab);
    return;
  }
  if (matchShortcut(_bindings.nextPrompt, e, isMac)) {
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

(async () => {
  const sz = settings.fontSize;
  const fam = '"JetBrainsMono Nerd Font Mono"';
  const loadFonts = Promise.all([
    document.fonts.load(`${sz}px ${fam}`),
    document.fonts.load(`bold ${sz}px ${fam}`),
    document.fonts.load(`italic ${sz}px ${fam}`),
  ]).catch(() => {});
  const timeout = new Promise(r => setTimeout(r, 1500));
  await Promise.race([loadFonts, timeout]);

  createTab(urlCwd || undefined);

  const firstTab = getActiveTab();
  if (firstTab) {
    state.autoIndicator.textContent = 'AUTO';
    state.autoIndicator.className = firstTab.autoRender ? '' : 'off';
  }
})();
