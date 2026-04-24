const mt = window.mathterm;
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { WebglAddon } = require('@xterm/addon-webgl');
const { CanvasAddon } = require('@xterm/addon-canvas');

const { state, getActiveTab, getTabIndex, updateStatusBar } = require('./state');
const { settings } = require('./settings');
const { escapeHtml } = require('./ansi');
const { TabSession } = require('./tabSession');
const { createShellShim, buildShellArgs } = require('./shellShim');
const { tabFeedSection } = require('./richView');
const { tabTrackTitle, updateTabBar } = require('./titleTrack');

function createTab(cwd) {
  const id = state.tabIdCounter++;
  const tab = new TabSession(id);

  const container = document.createElement('div');
  container.className = 'tab-container';
  container.dataset.id = id;

  const xtermHolder = document.createElement('div');
  xtermHolder.className = 'xterm-holder';
  container.appendChild(xtermHolder);

  const richViewEl = document.createElement('div');
  richViewEl.className = 'rich-view';
  richViewEl.tabIndex = 0;
  const richContentEl = document.createElement('div');
  richContentEl.className = 'rich-content';
  const richHintEl = document.createElement('div');
  richHintEl.className = 'rich-hint';
  richHintEl.textContent = 'Press any key to return to terminal';
  richViewEl.appendChild(richContentEl);
  richViewEl.appendChild(richHintEl);
  container.appendChild(richViewEl);

  state.termContainer.appendChild(container);

  tab.container = container;
  tab.xtermHolder = xtermHolder;
  tab.richView = richViewEl;
  tab.richContent = richContentEl;
  tab.richHint = richHintEl;

  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    theme: { background: settings.bg, foreground: settings.fg, cursor: settings.cursor },
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

  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => { webgl.dispose(); try { term.loadAddon(new CanvasAddon()); } catch {} });
    term.loadAddon(webgl);
  } catch {
    try { term.loadAddon(new CanvasAddon()); } catch {}
  }

  tab.term = term;
  tab.fitAddon = fitAddon;
  tab.searchAddon = searchAddon;

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
      tab._promptYSet.add(buf.baseY + buf.cursorY);
      if (tab._promptYSet.size > 500) {
        const minY = buf.baseY - settings.scrollback;
        for (const v of tab._promptYSet) {
          if (v < minY) tab._promptYSet.delete(v);
        }
      }
    } else if (data.startsWith('C')) {
      tab._commandStartY = tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY;
    } else if (data.startsWith('D')) {
      const exitCode = data.length > 2 ? data.slice(2) : '';
      tab._lastExitCode = exitCode;
      tab._commandEndY = tab.term.buffer.active.baseY + tab.term.buffer.active.cursorY;
      updateStatusBar(tab);
      const { tabFlushSectionOnCommandEnd } = require('./richView');
      tabFlushSectionOnCommandEnd(tab);
    }
    return false;
  });

  ptyProc.onData(data => {
    term.write(data);
    tabFeedSection(tab, data);
    tabTrackTitle(tab, data);
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
    prev.container.classList.remove('active');
    prev.tabEl.classList.remove('active');
    if (prev.richVisible) prev.richView.classList.remove('visible');
  }
  state.activeTabId = id;
  const tab = getActiveTab();
  tab.container.classList.add('active');
  tab.tabEl.classList.add('active');
  requestAnimationFrame(() => {
    tab.fitAddon.fit();
    if (tab.richVisible) tab.richView.classList.add('visible');
    tab.term.focus();
  });
  updateStatusBar(tab);
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = tab.autoRender ? '' : 'off';
  mt.ipc.send('rebuild-menu', tab.autoRender);
}

function closeTab(id) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  if (state.tabs.length <= 1) { mt.ipc.send('close-window'); return; }
  const tab = state.tabs[idx];
  clearTimeout(tab.sectionTimer);
  tab.ptyProc.kill();
  tab.term.dispose();
  tab.container.remove();
  tab.tabEl.remove();
  if (tab._shimDir) {
    try { mt.fs.rmSync(tab._shimDir, { recursive: true, force: true }); } catch {}
    tab._shimDir = null;
  }
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) {
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
