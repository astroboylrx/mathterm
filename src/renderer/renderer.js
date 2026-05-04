const { state, getActivePane } = require('./state');
const { settings, isMac, applySettings } = require('./settings');
const { loadUserThemes } = require('./themes');
const {
  createTab,
  switchTab,
  restoreSession,
  handlePaneShortcut,
  fitVisiblePanes,
  resetActiveRenderer
} = require('./tabs');
const {
  blockSessionWritesUntilChange,
  hasSessionFile,
  loadSession,
  initSessionPersistence
} = require('./sessionStore');
const { withSessionChangesSuppressed } = require('./sessionEvents');
const { toggleMathMode } = require('./richView');
const { closeSearch } = require('./search');
const { initIpc } = require('./ipc');
const { initClipboardListeners } = require('./clipboard');
const { initSearchListeners } = require('./search');
const { initTabContextListeners } = require('./tabs');
const { zoomInActiveTab, zoomOutActiveTab, resetActiveZoom, isZoomShortcut } = require('./zoom');

state.tabBar = document.getElementById('tab-bar');
state.termContainer = document.getElementById('terminal-container');
state.autoIndicator = document.getElementById('auto-indicator');
state.mathBtn = document.getElementById('math-btn');
state.renderInd = document.getElementById('render-ind');
state.zoomInd = document.getElementById('zoom-ind');
state.cwdLink = document.getElementById('cwd-link');
state.gitSep = document.getElementById('git-sep');
state.gitBranch = document.getElementById('git-branch');
state.renderInd.addEventListener('click', () => resetActiveRenderer());
state.renderInd.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  resetActiveRenderer();
});
state.cwdLink.addEventListener('click', () => {
  const cwd = state.cwdLink.dataset.cwd;
  if (cwd) window.mathterm.shell.openPath(cwd);
});
state.searchBar = document.getElementById('search-bar');
state.searchInput = document.getElementById('search-input');
state.searchCount = document.getElementById('search-count');
state.contextMenu = document.getElementById('context-menu');

loadUserThemes();
applySettings();

window.createTab = createTab;
window.splitPaneRight = require('./tabs').splitPaneRight;
window.splitPaneDown = require('./tabs').splitPaneDown;
window.closeActivePane = require('./tabs').closeActivePane;
window.togglePaneMaximize = require('./tabs').togglePaneMaximize;
window.toggleMathMode = toggleMathMode;
window.toggleAutoRender = function() {
  const tab = getActivePane();
  if (!tab) return;
  tab.autoRender = !tab.autoRender;
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = tab.autoRender ? '' : 'off';
  window.mathterm.ipc.send('rebuild-menu', tab.autoRender);
};
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
window.addEventListener('mathterm-settings-applied', rebuildBindings);

function tabCycleDirectionForEvent(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (!mod || otherMod || e.altKey) return 0;
  if (!e.shiftKey && e.key === 'PageDown') return 1;
  if (!e.shiftKey && e.key === 'PageUp') return -1;
  if (isMac && e.shiftKey && e.code === 'BracketRight') return 1;
  if (isMac && e.shiftKey && e.code === 'BracketLeft') return -1;
  return 0;
}

function isTabCycleShortcut(e) {
  return tabCycleDirectionForEvent(e) !== 0;
}

function cycleTab(direction) {
  const idx = state.tabs.findIndex(t => t.id === state.activeWorkspaceId);
  if (idx !== -1 && state.tabs.length > 1) {
    switchTab(state.tabs[(idx + direction + state.tabs.length) % state.tabs.length].id);
  }
}

function shortcutNameForEvent(e) {
  for (const [name, parsed] of Object.entries(_bindings)) {
    if (matchShortcut(parsed, e, isMac)) return name;
  }
  return null;
}

function isPromptNavigationShortcut(e) {
  return matchShortcut(_bindings.prevPrompt, e, isMac) || matchShortcut(_bindings.nextPrompt, e, isMac);
}

function handleRichViewKey(e, tab) {
  if (!tab?.richVisible) return false;
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
  } else {
    return false;
  }
  e.stopPropagation();
  return true;
}

function _dispatchShortcut(name) {
  const tab = getActivePane();
  switch (name) {
    case 'toggleMath':
      if (tab) toggleMathMode();
      break;
    case 'openSearch':
      require('./search').openSearch();
      break;
    case 'toggleAutoRender':
      window.toggleAutoRender();
      break;
    case 'copy':
      if (tab) require('./clipboard').doCopy();
      break;
    case 'paste':
      if (tab) require('./clipboard').doPaste();
      break;
    case 'selectAll':
      if (tab) require('./clipboard').doSelectAll();
      break;
    case 'prevPrompt':
      if (tab && !tab.richVisible) jumpToPrevPrompt(tab);
      break;
    case 'nextPrompt':
      if (tab && !tab.richVisible) jumpToNextPrompt(tab);
      break;
    case 'selectLastCommand':
      if (tab && !tab.richVisible) selectLastCommandOutput(tab);
      break;
    case 'scrollToCursor':
      if (tab && !tab.richVisible) scrollToCursor(tab);
      break;
    case 'splitPaneRight':
      require('./tabs').splitPaneRight();
      break;
    case 'splitPaneDown':
      require('./tabs').splitPaneDown();
      break;
    case 'closePane':
      require('./tabs').closeActivePane();
      break;
    case 'nextPane':
      require('./tabs').focusNextPane();
      break;
    case 'prevPane':
      require('./tabs').focusPrevPane();
      break;
    case 'togglePaneMaximize':
      require('./tabs').togglePaneMaximize();
      break;
  }
}

// Pre-empt xterm at capture phase: intercept shortcuts before they reach the
// textarea, so modified navigation keys never get written to the PTY.
document.addEventListener('keydown', e => {
  if (document.activeElement === state.searchInput
      || state.searchBar?.classList.contains('open')) return;

  const tab = getActivePane();
  if (tab && !isPromptNavigationShortcut(e)) tab._promptJumpAnchorY = null;

  if (handlePaneShortcut(e)) return;

  const tabCycleDirection = tabCycleDirectionForEvent(e);
  if (tabCycleDirection) {
    e.preventDefault();
    e.stopPropagation();
    cycleTab(tabCycleDirection);
    return;
  }

  if (isZoomShortcut(e, isMac)) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === '-') zoomOutActiveTab();
    else if (e.key === '0') resetActiveZoom();
    else zoomInActiveTab();
    return;
  }

  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (mod && !otherMod && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    const n = parseInt(e.key) - 1;
    if (n < state.tabs.length) {
      e.preventDefault();
      e.stopPropagation();
      switchTab(state.tabs[n].id);
    }
    return;
  }

  const shortcutName = shortcutNameForEvent(e);
  if (shortcutName) {
    e.preventDefault();
    e.stopPropagation();
    _dispatchShortcut(shortcutName);
    return;
  }

  if (handleRichViewKey(e, tab)) return;
}, true);

function selectLastCommandOutput(tab) {
  if (tab._commandStartY === undefined || tab._commandEndY === undefined) return;
  if (tab._lastExitCode === '') return;
  const start = tab._commandStartY;
  const end = Math.max(start, tab._commandEndY - 1);
  try {
    tab.term.selectLines(start, end);
    tab.term.scrollToLine(start);
  } catch {}
}

function scrollToCursor(tab) {
  tab.term.scrollToBottom();
  tab.term.clearSelection();
}

function colorToRgb(color) {
  const rgba = (color || '').trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgba) return [parseInt(rgba[1]), parseInt(rgba[2]), parseInt(rgba[3])];
  const m = (color || '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(color) {
  const rgb = colorToRgb(color);
  if (!rgb) return 0;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function promptJumpFlashColors() {
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue('--bg').trim();
  const accent = styles.getPropertyValue('--accent').trim();
  const rgb = colorToRgb(accent);
  const alpha = luminance(bg) > 0.5 ? 0.18 : 0.34;
  return {
    border: accent || '#51cf66',
    background: rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : 'rgba(81, 207, 102, 0.34)'
  };
}

function promptEndY(tab, startY) {
  const starts = tab._promptStartYSet || new Set();
  let endY = startY;
  while (tab._promptYSet.has(endY + 1) && !starts.has(endY + 1)) {
    endY++;
  }
  return endY;
}

function clearPromptJumpFlash(tab) {
  if (tab._promptJumpFlash) tab._promptJumpFlash.remove();
  tab._promptJumpFlash = null;
  if (tab._promptJumpFlashTimer) {
    clearTimeout(tab._promptJumpFlashTimer);
    tab._promptJumpFlashTimer = null;
  }
}

function flashPromptJump(tab, startY) {
  clearPromptJumpFlash(tab);

  requestAnimationFrame(() => {
    const holder = tab.xtermHolder;
    const screen = tab.term.element && tab.term.element.querySelector('.xterm-screen');
    if (!holder || !screen) return;

    const viewportY = currentViewportY(tab);
    const row = startY - viewportY;
    if (row < 0 || row >= tab.term.rows) return;

    const endY = promptEndY(tab, startY);
    const visibleRows = Math.max(1, Math.min(endY - startY + 1, tab.term.rows - row));
    const holderRect = holder.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const cellHeight = screenRect.height / Math.max(1, tab.term.rows);
    const colors = promptJumpFlashColors();

    if (getComputedStyle(holder).position === 'static') {
      holder.style.position = 'relative';
    }

    const el = document.createElement('div');
    el.className = 'prompt-jump-flash';
    el.style.position = 'absolute';
    el.style.left = `${screenRect.left - holderRect.left}px`;
    el.style.top = `${screenRect.top - holderRect.top + row * cellHeight}px`;
    el.style.width = `${screenRect.width}px`;
    el.style.height = `${visibleRows * cellHeight}px`;
    el.style.background = colors.background;
    el.style.borderLeft = `4px solid ${colors.border}`;
    el.style.outline = `1px solid ${colors.border}`;
    el.style.boxShadow = `0 0 0 1px ${colors.border}`;
    el.style.pointerEvents = 'none';
    el.style.zIndex = '20';
    el.style.opacity = '1';
    el.style.transition = 'opacity 380ms ease-out';
    holder.appendChild(el);

    tab._promptJumpFlash = el;
    setTimeout(() => { el.style.opacity = '0'; }, 160);
    tab._promptJumpFlashTimer = setTimeout(() => clearPromptJumpFlash(tab), 620);
  });
}

function getPromptStartYs(tab) {
  if (tab._promptStartYSet && tab._promptStartYSet.size) {
    return [...tab._promptStartYSet];
  }

  const starts = [];
  let prev;
  for (const y of [...tab._promptYSet].sort((a, b) => a - b)) {
    if (prev === undefined || y > prev + 1) starts.push(y);
    prev = y;
  }
  return starts;
}

function currentViewportY(tab) {
  const buf = tab.term.buffer.active;
  return typeof buf.viewportY === 'number' ? buf.viewportY : buf.baseY;
}

function lastPromptStartAtOrBefore(tab, y) {
  let found = null;
  for (const promptY of getPromptStartYs(tab)) {
    if (promptY <= y && (found === null || promptY > found)) found = promptY;
  }
  return found;
}

function promptNavigationAnchorY(tab) {
  if (typeof tab._promptJumpAnchorY === 'number') return tab._promptJumpAnchorY;

  const buf = tab.term.buffer.active;
  const viewportY = currentViewportY(tab);
  if (viewportY !== buf.baseY) return viewportY;

  const cursorY = buf.baseY + buf.cursorY;
  const currentPromptStart = lastPromptStartAtOrBefore(tab, cursorY);
  if (currentPromptStart !== null && promptEndY(tab, currentPromptStart) >= cursorY) {
    return currentPromptStart;
  }
  return cursorY;
}

function jumpToPrevPrompt(tab) {
  const anchorY = promptNavigationAnchorY(tab);
  const sorted = getPromptStartYs(tab).sort((a, b) => b - a);
  for (const y of sorted) {
    if (y < anchorY) {
      tab.term.scrollToLine(y);
      tab._promptJumpAnchorY = y;
      flashPromptJump(tab, y);
      return;
    }
  }
}

function jumpToNextPrompt(tab) {
  const anchorY = promptNavigationAnchorY(tab);
  const sorted = getPromptStartYs(tab).sort((a, b) => a - b);
  for (const y of sorted) {
    if (y > anchorY) {
      tab.term.scrollToLine(y);
      tab._promptJumpAnchorY = y;
      flashPromptJump(tab, y);
      return;
    }
  }
}

window.addEventListener('resize', () => {
  for (const workspace of state.tabs) fitVisiblePanes(workspace);
});

initIpc();
initClipboardListeners();
initSearchListeners();
initTabContextListeners();
initSessionPersistence();

const urlCwd = new URLSearchParams(window.location.search).get('cwd');
const urlTitle = new URLSearchParams(window.location.search).get('title');
const shouldRestoreSession = new URLSearchParams(window.location.search).get('restoreSession') === '1';
const forceRestoreSession = new URLSearchParams(window.location.search).get('forceRestoreSession') === '1';

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

  if (urlCwd) {
    withSessionChangesSuppressed(() => createTab(urlCwd, { skipSessionSave: true, customTitle: urlTitle }));
  } else if (shouldRestoreSession && (settings.restoreLastSession || forceRestoreSession)) {
    const hadSessionFile = hasSessionFile();
    let restored = false;
    try {
      restored = withSessionChangesSuppressed(() => restoreSession(loadSession()));
    } catch (err) {
      console.error('Failed to restore session:', err);
    }
    if (!restored) {
      withSessionChangesSuppressed(() => createTab(undefined, { skipSessionSave: true }));
      if (hadSessionFile) blockSessionWritesUntilChange();
    }
  } else {
    createTab();
  }

  const firstTab = getActivePane();
  if (firstTab) {
    state.autoIndicator.textContent = 'AUTO';
    state.autoIndicator.className = firstTab.autoRender ? '' : 'off';
    const ri = state.renderInd;
    if (ri) ri.textContent = firstTab._renderer === 'webgl' ? 'GL' : firstTab._renderer === 'canvas' ? 'CV' : 'DOM';
  }
})();
