const mt = window.mathterm;
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { WebglAddon } = require('@xterm/addon-webgl');
const { CanvasAddon } = require('@xterm/addon-canvas');

const { state, getActiveTab, getTabIndex, updateStatusBar, updateStatusBarCwd } = require('./state');
const { settings, isMac } = require('./settings');
const { parseShortcut, matchShortcut } = require('./keybindings');
const { applyZoomToTab, isZoomShortcut } = require('./zoom');

function updateRendererIndicator(tab) {
  const el = state.renderInd;
  if (!el || !tab || tab.id !== state.activeTabId) return;
  el.textContent = tab._renderer === 'webgl' ? 'GL' : tab._renderer === 'canvas' ? 'CV' : 'DOM';
}

function isTabCycleShortcut(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  return mod && !otherMod && !e.altKey && !e.shiftKey
    && (e.key === 'PageDown' || e.key === 'PageUp');
}

function macOptionMetaSequence(e) {
  if (!isMac || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.code === 'KeyF') return '\x1bf';
  if (e.code === 'KeyB') return '\x1bb';
  return null;
}

const { escapeHtml } = require('./ansi');
const { TabSession } = require('./tabSession');
const { createShellShim, buildShellArgs } = require('./shellShim');
const { tabFeedSection } = require('./richView');
const { tabTrackTitle, updateTabBar } = require('./titleTrack');

const IMAGE_MAX_COUNT = 50;
const IMAGE_MAX_BYTES = 512 * 1024 * 1024;

function prunePromptTracking(tab, minY) {
  for (const v of tab._promptYSet) {
    if (v < minY) tab._promptYSet.delete(v);
  }
  for (const v of tab._promptStartYSet) {
    if (v < minY) tab._promptStartYSet.delete(v);
  }
  while (tab._promptStartYSet.size > 500) {
    tab._promptStartYSet.delete(Math.min(...tab._promptStartYSet));
  }
}

function trimInlineImages(arr) {
  let bytes = 0;
  for (const im of arr) bytes += im.dataUrl.length;
  while (arr.length > 0 && (arr.length > IMAGE_MAX_COUNT || bytes > IMAGE_MAX_BYTES)) {
    bytes -= arr.shift().dataUrl.length;
  }
}

function createTab(cwd) {
  const id = state.tabIdCounter++;
  const tab = new TabSession(id);
  tab.autoRender = settings.autoRender;

  const container = document.createElement('div');
  container.className = 'tab-container';
  container.dataset.id = id;

  const xtermHolder = document.createElement('div');
  xtermHolder.className = 'xterm-holder';
  container.appendChild(xtermHolder);

  const searchHighlightLayer = document.createElement('div');
  searchHighlightLayer.className = 'search-highlight-layer';
  xtermHolder.appendChild(searchHighlightLayer);

  const richViewEl = document.createElement('div');
  richViewEl.className = 'rich-view';
  richViewEl.tabIndex = 0;
  const richContentEl = document.createElement('div');
  richContentEl.className = 'rich-content';
  const richHintEl = document.createElement('div');
  richHintEl.className = 'rich-hint';
  const richHintTextEl = document.createElement('span');
  richHintTextEl.className = 'rich-hint-text';
  richHintTextEl.textContent = 'Press any key to return to terminal';
  richHintEl.appendChild(richHintTextEl);
  const exportPdfBtn = document.createElement('button');
  exportPdfBtn.className = 'export-btn';
  exportPdfBtn.textContent = 'Export PDF';
  exportPdfBtn.addEventListener('click', e => {
    e.stopPropagation();
    require('./export').exportPdf().catch(err => console.error('PDF export failed:', err));
  });
  const exportPngBtn = document.createElement('button');
  exportPngBtn.className = 'export-btn';
  exportPngBtn.textContent = 'Export PNG';
  exportPngBtn.addEventListener('click', e => {
    e.stopPropagation();
    require('./export').exportPng().catch(err => console.error('PNG export failed:', err));
  });
  richHintEl.appendChild(exportPdfBtn);
  richHintEl.appendChild(exportPngBtn);
  richViewEl.appendChild(richContentEl);
  richViewEl.appendChild(richHintEl);
  container.appendChild(richViewEl);

  state.termContainer.appendChild(container);

  tab.container = container;
  tab.xtermHolder = xtermHolder;
  tab.searchHighlightLayer = searchHighlightLayer;
  tab.richView = richViewEl;
  tab.richContent = richContentEl;
  tab.richHint = richHintEl;

  const { resolveTheme, selectionBgFor } = require('./themes');
  const themeColors = resolveTheme(settings.theme);
  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    theme: {
      background: themeColors.bg,
      foreground: themeColors.fg,
      cursor: themeColors.accent,
      selectionBackground: selectionBgFor(themeColors)
    },
    cursorBlink: true,
    cursorStyle: settings.cursorStyle,
    scrollback: settings.scrollback
  });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  try { term.loadAddon(new (require('@xterm/addon-unicode11').Unicode11Addon)()); term.unicode.activeVersion = '6'; } catch {}
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    try {
      const u = new URL(uri);
      if (['http:', 'https:', 'mailto:'].includes(u.protocol)) mt.shell.openExternal(uri);
    } catch {}
  }));
  term.open(xtermHolder);
  xtermHolder.appendChild(searchHighlightLayer);

  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    const optionMeta = macOptionMetaSequence(e);
    if (optionMeta) {
      if (!tab.richVisible && tab.ptyProc) tab.ptyProc.write(optionMeta);
      return false;
    }
    if (isTabCycleShortcut(e)) return false;
    if (isZoomShortcut(e, isMac)) return false;
    const sc = settings.shortcuts || {};
    for (const name of Object.keys(sc)) {
      const parsed = parseShortcut(sc[name]);
      if (parsed && matchShortcut(parsed, e, isMac)) return false;
    }
    return true;
  });

  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => { webgl.dispose(); tab._renderer = 'canvas'; try { term.loadAddon(new CanvasAddon()); } catch {} updateRendererIndicator(tab); });
    term.loadAddon(webgl);
    tab._renderer = 'webgl';
  } catch {
    try { term.loadAddon(new CanvasAddon()); tab._renderer = 'canvas'; } catch { tab._renderer = 'dom'; }
  }

  tab.term = term;
  tab.fitAddon = fitAddon;
  tab.searchAddon = searchAddon;
  require('./search').attachSearchResultListener(tab);

  const spawnCwd = cwd
    || (settings.inheritCwd ? (getActiveTab()?.cwd || mt.os.env.HOME) : null)
    || mt.os.env.HOME;
  tab.cwd = spawnCwd;

  const shellCmd = mt.os.env.SHELL || '/bin/bash';
  const shimDir = createShellShim(shellCmd);
  tab._shimDir = shimDir;
  const { args: shellArgs, env: shellEnv } = buildShellArgs(shellCmd, shimDir);
  const ptyProc = mt.pty.spawn(shellCmd, shellArgs, {
    name: 'xterm-256color',
    cols: term.cols,
    rows: term.rows,
    cwd: spawnCwd,
    env: {
      ...shellEnv,
      TERM_PROGRAM: 'MathTerm',
      TERM_PROGRAM_VERSION: '0.6',
      COLORTERM: 'truecolor'
    }
  });
  tab.ptyProc = ptyProc;

  ptyProc.onExit(() => {
    if (tab._shimDir) {
      try { mt.fs.rmSync(tab._shimDir, { recursive: true, force: true }); } catch {}
      tab._shimDir = null;
    }
    tab.ptyProc = null;
    if (!tab._closing && getTabIndex(tab.id) !== -1) {
      setTimeout(() => closeTab(tab.id), 0);
    }
  });

  term.onData(data => {
    if (tab.richVisible) {
      const { tabHideRichView } = require('./richView');
      if (tab.richAutoTriggered && (data === 'q' || data === '\x1b')) {
        tabHideRichView(tab);
      } else if (!tab.richAutoTriggered && data === '\x1b') {
        tabHideRichView(tab);
      }
      return;
    }
    ptyProc.write(data);
  });

  term.onResize(({ cols, rows }) => ptyProc.resize(cols, rows));

  term.onSelectionChange(() => {
    if (!settings.copyOnSelect) return;
    const sel = term.getSelection();
    if (sel) mt.clipboard.writeText(sel);
  });

  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith('A')) {
      const buf = tab.term.buffer.active;
      tab._promptStartY = buf.baseY + buf.cursorY;
      tab._promptBHandled = false;
      tab._promptJumpAnchorY = null;
      tab._promptYSet.add(tab._promptStartY);
      tab._promptStartYSet.add(tab._promptStartY);
      if (tab._promptYSet.size > 500 || tab._promptStartYSet.size > 500) {
        const minY = buf.baseY - settings.scrollback;
        prunePromptTracking(tab, minY);
      }
    } else if (data.startsWith('B')) {
      // Prompt end — mark all lines from prompt start to here as prompt.
      // Guarded against re-fires (e.g. zsh zle-line-init on widget changes):
      // only act on the first ;B following a ;A.
      if (tab._promptStartY !== undefined && !tab._promptBHandled) {
        const endY = tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY;
        for (let y = tab._promptStartY; y <= endY; y++) {
          tab._promptYSet.add(y);
        }
        tab._promptBHandled = true;
      }
    } else if (data.startsWith('C')) {
      tab._commandRunning = true;
      tab._commandStartY = tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY;
    } else if (data.startsWith('D')) {
      const wasCommandRunning = tab._commandRunning;
      tab._commandRunning = false;
      const exitCode = data.length > 2 ? data.slice(2).split(';')[0].trim() : '';
      tab._lastExitCode = exitCode;
      tab._commandEndY = tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY;
      if (wasCommandRunning && settings.backgroundCommandMarker && tab.id !== state.activeTabId) {
        const failed = exitCode !== '' && exitCode !== '0';
        tab.needsAttention = true;
        tab.attentionLevel = failed ? 'error' : 'success';
        tab.attentionMessage = failed ? `Command failed: exit ${exitCode}` : 'Command finished';
        updateTabBar();
      }
      const { tabFlushSectionOnCommandEnd } = require('./richView');
      tabFlushSectionOnCommandEnd(tab);
    }
    return false;
  });

  ptyProc.onData(data => {
    const { images, cleanData } = tab.osc1337Parser.feed(data);
    if (images.length) {
      const y = term.buffer.active.baseY + term.buffer.active.cursorY;
      for (const img of images) {
        tab.inlineImages.push({ ...img, lineY: y });
      }
      trimInlineImages(tab.inlineImages);
    }
    term.write(cleanData);
    if (images.length) {
      // Force-render math view as soon as the image is parsed,
      // bypassing the AUTO toggle and the section delay.
      setTimeout(() => {
        const { showManualRichView } = require('./richView');
        showManualRichView(tab);
      }, 0);
    }
    tabFeedSection(tab, cleanData);
    tabTrackTitle(tab, cleanData);
  });

  state.tabs.push(tab);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.id = id;
  tabEl.draggable = true;
  tabEl.innerHTML = '<span class="tab-title">' + escapeHtml(tab.title) + '</span><span class="tab-close">\u00d7</span>';

  tabEl.addEventListener('click', e => {
    if (e.target.classList.contains('tab-close')) closeTab(id);
    else if (!e.target.classList.contains('tab-title') || !e.target.isContentEditable) switchTab(id);
  });

  tabEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu(id, e.clientX, e.clientY);
  });

  tabEl.addEventListener('dragstart', e => {
    state.dragTabId = id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  });
  tabEl.addEventListener('dragend', () => {
    state.dragTabId = null;
    tabEl.classList.remove('dragging');
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
  });
  tabEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = tabEl.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    tabEl.classList.remove('drag-over-left', 'drag-over-right');
    if (e.clientX < mid) tabEl.classList.add('drag-over-left');
    else tabEl.classList.add('drag-over-right');
  });
  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drag-over-left', 'drag-over-right');
  });
  tabEl.addEventListener('drop', e => {
    e.preventDefault();
    tabEl.classList.remove('drag-over-left', 'drag-over-right');
    if (state.dragTabId === null || state.dragTabId === id) return;
    const fromIdx = getTabIndex(state.dragTabId);
    const toIdx = getTabIndex(id);
    if (fromIdx === -1 || toIdx === -1) return;
    const rect = tabEl.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const insertBefore = e.clientX < mid;
    const [moved] = state.tabs.splice(fromIdx, 1);
    let newIdx = getTabIndex(id);
    if (!insertBefore) newIdx++;
    state.tabs.splice(newIdx, 0, moved);
    rebuildTabBarDOM();
  });

  state.tabBar.insertBefore(tabEl, document.getElementById('new-tab-btn'));
  tab.tabEl = tabEl;

  switchTab(id);
  return tab;
}

function switchTab(id) {
  if (id === state.activeTabId) return;
  const prev = getActiveTab();
  if (prev) {
    const { saveSearchState } = require('./search');
    saveSearchState(prev);
    prev.container.classList.remove('active');
    prev.tabEl.classList.remove('active');
    if (prev.richVisible) prev.richView.classList.remove('visible');
  }
  state.activeTabId = id;
  const tab = getActiveTab();
  tab.needsAttention = false;
  tab.attentionLevel = null;
  tab.attentionMessage = '';
  tab.container.classList.add('active');
  tab.tabEl.classList.add('active');
  const { hydrateSearchBar } = require('./search');
  hydrateSearchBar(tab);
  updateTabBar();
  requestAnimationFrame(() => {
    tab.fitAddon.fit();
    applyZoomToTab(tab);
    if (tab.richVisible) tab.richView.classList.add('visible');
    tab.term.focus();
  });
  updateStatusBar(tab);
  updateStatusBarCwd(tab);
  updateRendererIndicator(tab);
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = tab.autoRender ? '' : 'off';
  mt.ipc.send('rebuild-menu', tab.autoRender);
}

function closeTab(id) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const tab = state.tabs[idx];
  const wasActive = state.activeTabId === id;
  tab._closing = true;
  clearTimeout(tab.sectionTimer);
  tab.container.remove();
  tab.tabEl.remove();
  state.tabs.splice(idx, 1);
  if (wasActive) state.activeTabId = null;
  try { if (tab.ptyProc) tab.ptyProc.kill(); } catch {}
  try { tab._searchResultDisposable?.dispose(); } catch {}
  try { tab.term.dispose(); } catch {}
  if (tab._shimDir) {
    try { mt.fs.rmSync(tab._shimDir, { recursive: true, force: true }); } catch {}
    tab._shimDir = null;
  }
  if (state.tabs.length === 0) {
    mt.ipc.send('close-window', { quitApp: isMac && !!settings.quitWhenLastTabClosed });
    return;
  }
  if (wasActive) {
    switchTab(state.tabs[Math.min(idx, state.tabs.length - 1)].id);
  }
}

function rebuildTabBarDOM() {
  const newBtn = document.getElementById('new-tab-btn');
  for (const tab of state.tabs) {
    state.tabBar.removeChild(tab.tabEl);
  }
  for (const tab of state.tabs) {
    state.tabBar.insertBefore(tab.tabEl, newBtn);
  }
}

function showTabContextMenu(id, x, y) {
  state.tabContextMenuId = id;
  const idx = getTabIndex(id);
  document.getElementById('tctx-moveleft').classList.toggle('disabled', idx <= 0);
  document.getElementById('tctx-moveright').classList.toggle('disabled', idx >= state.tabs.length - 1);
  const menu = document.getElementById('tab-context-menu');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('open');
}

function hideTabContextMenu() {
  document.getElementById('tab-context-menu').classList.remove('open');
  state.tabContextMenuId = null;
}

function renameTab(id) {
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  const titleEl = tab.tabEl.querySelector('.tab-title');
  if (!titleEl) return;
  titleEl.textContent = tab._customTitle || tab.title;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finish() {
    titleEl.contentEditable = 'false';
    const newName = titleEl.textContent.trim();
    if (newName) {
      tab._customTitle = newName;
    } else {
      tab._customTitle = null;
      titleEl.textContent = tab.title;
    }
    titleEl.removeEventListener('blur', finish);
    titleEl.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { titleEl.textContent = tab._customTitle || tab.title; finish(); }
    e.stopPropagation();
  }
  titleEl.addEventListener('blur', finish);
  titleEl.addEventListener('keydown', onKey);
}

function moveTab(id, direction) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= state.tabs.length) return;
  [state.tabs[idx], state.tabs[newIdx]] = [state.tabs[newIdx], state.tabs[idx]];
  rebuildTabBarDOM();
}

function detachTab(id) {
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  mt.ipc.send('detach-tab', {
    cwd: tab.cwd,
    title: tab._customTitle || tab.title
  });
  closeTab(id);
}

function initTabContextListeners() {
  document.getElementById('tctx-rename').addEventListener('click', () => { renameTab(state.tabContextMenuId); hideTabContextMenu(); });
  document.getElementById('tctx-moveleft').addEventListener('click', () => { moveTab(state.tabContextMenuId, -1); hideTabContextMenu(); });
  document.getElementById('tctx-moveright').addEventListener('click', () => { moveTab(state.tabContextMenuId, 1); hideTabContextMenu(); });
  document.getElementById('tctx-detach').addEventListener('click', () => { detachTab(state.tabContextMenuId); hideTabContextMenu(); });
  document.getElementById('tctx-close').addEventListener('click', () => { closeTab(state.tabContextMenuId); hideTabContextMenu(); });
  document.addEventListener('click', e => {
    if (!document.getElementById('tab-context-menu').contains(e.target)) hideTabContextMenu();
  });
}

module.exports = {
  createTab, switchTab, closeTab,
  rebuildTabBarDOM, showTabContextMenu, hideTabContextMenu,
  renameTab, moveTab, detachTab, initTabContextListeners
};
