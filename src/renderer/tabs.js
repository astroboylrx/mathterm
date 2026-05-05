const mt = window.mathterm;
// Model note: a workspace is the user-visible tab; each workspace owns one or
// more panes. We keep "tab" in user-facing labels and legacy helpers because
// users expect terminal tabs, while pane-specific code should use pane names.
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SearchAddon } = require('@xterm/addon-search');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { WebglAddon } = require('@xterm/addon-webgl');
const { CanvasAddon } = require('@xterm/addon-canvas');

const {
  state,
  getActiveWorkspace,
  getActivePane,
  getTabIndex,
  getPaneWorkspace,
  getPaneById,
  isActivePane,
  updateStatusBar,
  updateStatusBarCwd
} = require('./state');
const { settings, isMac } = require('./settings');
const { parseShortcut, matchShortcut } = require('./keybindings');
const { applyZoomToTab, isZoomShortcut } = require('./zoom');
const { escapeHtml } = require('./ansi');
const { PaneSession } = require('./paneSession');
const { TabWorkspace } = require('./workspace');
const { createShellShim, buildShellArgs } = require('./shellShim');
const {
  tabFeedSection,
  refreshRichViewAfterLayout,
  captureRichViewLayoutState,
  restoreRichViewLayoutState
} = require('./richView');
const { tabTrackTitle, updateTabBar, refreshTabTitle } = require('./titleTrack');
const { attachBareUrlHoverProvider, attachUrlClickHandler } = require('./urlHit');
const {
  macOptionMetaBinding,
  markMacOptionMetaPending,
  attachMacImePunctuationBridge,
  shouldSuppressMacFallbackData
} = require('./macInputBridge');
const {
  paneIdsInLayout,
  findLeafPath,
  replaceNodeAtPath,
  getNodeAtPath,
  normalizedSizes,
  updateSplitSizesAtPath,
  firstPaneIdInLayout,
  removePaneFromLayout
} = require('./layoutTree');
const { markSessionChanged } = require('./sessionEvents');

const IMAGE_MAX_COUNT = 50;
const IMAGE_MAX_BYTES = 512 * 1024 * 1024;

function updateRendererIndicator(pane) {
  const el = state.renderInd;
  if (!el || !pane || !isActivePane(pane)) return;
  el.textContent = pane._renderer === 'webgl' ? 'GL' : pane._renderer === 'canvas' ? 'CV' : 'DOM';
}

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

function prunePromptTracking(pane, minY) {
  for (const v of pane._promptYSet) {
    if (v < minY) pane._promptYSet.delete(v);
  }
  for (const v of pane._promptStartYSet) {
    if (v < minY) pane._promptStartYSet.delete(v);
  }
  while (pane._promptStartYSet.size > 500) {
    pane._promptStartYSet.delete(Math.min(...pane._promptStartYSet));
  }
}

function trimInlineImages(arr) {
  let bytes = 0;
  for (const im of arr) bytes += im.dataUrl.length;
  while (arr.length > 0 && (arr.length > IMAGE_MAX_COUNT || bytes > IMAGE_MAX_BYTES)) {
    bytes -= arr.shift().dataUrl.length;
  }
}

function getWorkspaceRoot(workspace) {
  let root = workspace.container.querySelector(':scope > .workspace-pane-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'workspace-pane-root';
    workspace.container.appendChild(root);
  }
  return root;
}

function renderLayout(workspace) {
  if (!workspace || !workspace.container || !workspace.layout) return;
  const root = getWorkspaceRoot(workspace);
  root.className = 'workspace-pane-root';
  const layout = workspace.maximizedPaneId != null
    && workspace.panes.some(p => p.id === workspace.maximizedPaneId)
    ? { type: 'pane', paneId: workspace.maximizedPaneId }
    : workspace.layout;

  function renderNode(node, path = []) {
    if (node.type === 'pane') {
      const pane = workspace.panes.find(p => p.id === node.paneId);
      const leaf = getPaneLeaf(workspace, node.paneId) || createPaneLeafElement(workspace, node.paneId);
      leaf.className = 'pane-leaf';
      leaf.classList.toggle('active', workspace.activePaneId === node.paneId);
      if (pane) {
        pane.leafEl = leaf;
        if (pane.richView) {
          pane.richView.classList.toggle('visible', !!pane.richVisible);
        }
        if (pane.container) leaf.appendChild(pane.container);
      }
      return leaf;
    }

    const split = document.createElement('div');
    split.className = `pane-split ${node.direction}`;
    const sizes = normalizedSizes(node);
    node.children.forEach((child, idx) => {
      const childEl = renderNode(child, path.concat(idx));
      childEl.style.flex = `${Math.max(0.05, sizes[idx])} 1 0`;
      if (idx > 0) {
        split.appendChild(createGutterElement(workspace, path, idx, node.direction));
      }
      split.appendChild(childEl);
    });
    return split;
  }

  const rendered = renderNode(layout);
  if (root.firstElementChild !== rendered || root.children.length !== 1) {
    root.replaceChildren(rendered);
  }
}

function createGutterElement(workspace, splitPath, gutterIndex, direction) {
  const gutter = document.createElement('div');
  gutter.className = `pane-gutter ${direction}`;
  gutter.dataset.splitPath = JSON.stringify(splitPath);
  gutter.dataset.gutterIndex = String(gutterIndex);
  gutter.addEventListener('pointerdown', e => startGutterDrag(e, workspace, splitPath, gutterIndex));
  return gutter;
}

function applySplitSizesToElement(splitEl, sizes) {
  for (let i = 0; i < sizes.length; i++) {
    const childEl = splitEl.children[i * 2];
    if (childEl) childEl.style.flex = `${Math.max(0.05, sizes[i])} 1 0`;
  }
}

function startGutterDrag(e, workspace, splitPath, gutterIndex) {
  if (e.button !== 0) return;
  const split = getNodeAtPath(workspace.layout, splitPath);
  if (!split || split.type === 'pane') return;
  const splitEl = e.currentTarget.parentElement;
  const rect = splitEl?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;

  e.preventDefault();
  e.stopPropagation();
  const gutterEl = e.currentTarget;
  try { gutterEl.setPointerCapture?.(e.pointerId); } catch {}
  const direction = split.direction;
  const axisSize = direction === 'row' ? rect.width : rect.height;
  const minRatio = axisSize > 0 ? (direction === 'row' ? 160 : 80) / axisSize : 0.05;
  const startCoord = direction === 'row' ? e.clientX : e.clientY;
  const startSizes = normalizedSizes(split);
  const beforeIdx = gutterIndex - 1;
  const afterIdx = gutterIndex;
  const combined = (startSizes[beforeIdx] || 0) + (startSizes[afterIdx] || 0);
  if (combined <= 0) return;

  const minBefore = Math.min(minRatio, combined / 2);
  const minAfter = Math.min(minRatio, combined / 2);
  const onMove = ev => {
    const coord = direction === 'row' ? ev.clientX : ev.clientY;
    const delta = (coord - startCoord) / axisSize;
    const sizes = startSizes.slice();
    const before = Math.min(
      Math.max((startSizes[beforeIdx] || 0) + delta, minBefore),
      combined - minAfter
    );
    sizes[beforeIdx] = before;
    sizes[afterIdx] = combined - before;
    workspace.layout = updateSplitSizesAtPath(workspace.layout, splitPath, sizes);
    applySplitSizesToElement(splitEl, sizes);
  };

  const onUp = ev => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    try { gutterEl.releasePointerCapture?.(ev.pointerId); } catch {}
    fitVisiblePanes(workspace);
    markSessionChanged({ structural: true });
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
}

function updatePaneActiveClasses(workspace) {
  if (!workspace || !workspace.container) return;
  workspace.container.querySelectorAll('.pane-leaf').forEach(leaf => {
    leaf.classList.toggle('active', Number(leaf.dataset.paneId) === workspace.activePaneId);
  });
  for (const pane of workspace.panes) {
    if (pane.richView) {
      pane.richView.classList.toggle('visible', !!pane.richVisible);
    }
  }
}

function fitPane(pane) {
  if (!pane || !pane.fitAddon || !pane.term || !pane.leafEl) return;
  const workspace = pane.workspace;
  if (!workspace || !workspace.container || !workspace.container.classList.contains('active')) return;
  const rect = pane.leafEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const beforeCols = pane.term.cols;
  const beforeRows = pane.term.rows;
  try { pane.fitAddon.fit(); } catch {}
  const cols = pane.term.cols;
  const rows = pane.term.rows;
  if (pane.ptyProc && (cols !== beforeCols || rows !== beforeRows)) {
    try { pane.ptyProc.resize(cols, rows); } catch {}
  }
  try { pane.term.refresh(0, Math.max(0, pane.term.rows - 1)); } catch {}
}

function scheduleTerminalRefresh(pane) {
  if (!pane || !pane.term || pane._terminalRefreshRaf) return;
  pane._terminalRefreshRaf = requestAnimationFrame(() => {
    pane._terminalRefreshRaf = 0;
    try { pane.term.refresh(0, Math.max(0, pane.term.rows - 1)); } catch {}
  });
}

function fitVisiblePanes(workspace = getActiveWorkspace()) {
  if (!workspace || !workspace.container || !workspace.container.classList.contains('active')) return;
  const rect = workspace.container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  for (const pane of workspace.panes) fitPane(pane);
}

function scheduleFitVisiblePanes(workspace = getActiveWorkspace()) {
  if (!workspace || workspace._fitRaf) return;
  workspace._fitRaf = requestAnimationFrame(() => {
    workspace._fitRaf = null;
    fitVisiblePanes(workspace);
  });
}

function scheduleRichViewsAfterLayout(workspace = getActiveWorkspace()) {
  if (!workspace || workspace._richLayoutRaf) return;
  workspace._richLayoutRaf = requestAnimationFrame(() => {
    workspace._richLayoutRaf = null;
    for (const pane of workspace.panes) refreshRichViewAfterLayout(pane);
  });
}

function stabilizeVisiblePanes(workspace = getActiveWorkspace(), focusPaneId = null) {
  requestAnimationFrame(() => {
    fitVisiblePanes(workspace);
    requestAnimationFrame(() => {
      fitVisiblePanes(workspace);
      scheduleRichViewsAfterLayout(workspace);
      const pane = focusPaneId ? workspace?.panes.find(p => p.id === focusPaneId) : getActivePane();
      try { pane?.term?.refresh(0, Math.max(0, pane.term.rows - 1)); } catch {}
      try { pane?.term?.focus(); } catch {}
    });
  });
}

function getPaneLeaf(workspace, paneId) {
  return workspace.container.querySelector(`.pane-leaf[data-pane-id="${paneId}"]`);
}

function createPaneLeafElement(workspace, paneId) {
  const leaf = document.createElement('div');
  leaf.className = 'pane-leaf';
  leaf.dataset.paneId = String(paneId);
  leaf.classList.toggle('active', workspace.activePaneId === paneId);
  leaf.addEventListener('mousedown', () => focusPane(paneId, { focusTerm: false, clearFocusBacklink: true }));
  return leaf;
}

function initPaneSessionState(pane, cwd) {
  pane.autoRender = settings.autoRender;
  pane.cwd = cwd || mt.os.env.HOME;
}

function buildPaneSessionDom(pane, leafEl) {
  const container = document.createElement('div');
  container.className = 'pane-session';
  container.dataset.id = pane.id;

  const xtermHolder = document.createElement('div');
  xtermHolder.className = 'xterm-holder';
  container.appendChild(xtermHolder);

  const searchHighlightLayer = document.createElement('div');
  searchHighlightLayer.className = 'search-highlight-layer';
  xtermHolder.appendChild(searchHighlightLayer);

  const richViewEl = document.createElement('div');
  richViewEl.className = 'rich-view';
  richViewEl.tabIndex = 0;
  richViewEl.addEventListener('mousedown', () => {
    focusPane(pane.id, { focusTerm: false, clearFocusBacklink: true });
  });
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

  pane.container = container;
  pane.leafEl = leafEl;
  pane.xtermHolder = xtermHolder;
  pane.searchHighlightLayer = searchHighlightLayer;
  pane.richView = richViewEl;
  pane.richContent = richContentEl;
  pane.richHint = richHintEl;
  if (leafEl) leafEl.appendChild(container);
}

function createPaneTerminal(pane) {
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
  term.open(pane.xtermHolder);
  pane.xtermHolder.appendChild(pane.searchHighlightLayer);
  return { term, fitAddon, searchAddon };
}

function attachPaneKeyHandler(pane, term) {
  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    const optionMeta = macOptionMetaBinding(e);
    if (optionMeta) {
      e.preventDefault();
      e.stopPropagation();
      markMacOptionMetaPending(pane, optionMeta);
      if (!pane.richVisible && pane.ptyProc) pane.ptyProc.write(optionMeta.sequence);
      return false;
    }
    if (isTabCycleShortcut(e)) return false;
    if (isZoomShortcut(e, isMac)) return false;
    if (isPaneShortcut(e)) return false;
    const sc = settings.shortcuts || {};
    for (const name of Object.keys(sc)) {
      const parsed = parseShortcut(sc[name]);
      if (parsed && matchShortcut(parsed, e, isMac)) return false;
    }
    return true;
  });
}

function attachTerminalRenderer(pane, term) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      if (pane._rendererAddon === webgl) pane._rendererAddon = null;
      pane._renderer = 'canvas';
      try {
        const canvas = new CanvasAddon();
        term.loadAddon(canvas);
        pane._rendererAddon = canvas;
      } catch {}
      updateRendererIndicator(pane);
    });
    term.loadAddon(webgl);
    pane._rendererAddon = webgl;
    pane._renderer = 'webgl';
  } catch {
    try {
      const canvas = new CanvasAddon();
      term.loadAddon(canvas);
      pane._rendererAddon = canvas;
      pane._renderer = 'canvas';
    } catch {
      pane._rendererAddon = null;
      pane._renderer = 'dom';
    }
  }
  scheduleTerminalRefresh(pane);
}

function resetPaneRenderer(pane) {
  if (!pane || !pane.term) return false;
  try { pane._rendererAddon?.dispose?.(); } catch {}
  pane._rendererAddon = null;
  attachTerminalRenderer(pane, pane.term);
  updateRendererIndicator(pane);
  fitPane(pane);
  scheduleTerminalRefresh(pane);
  requestAnimationFrame(() => {
    fitPane(pane);
    try { pane.term.refresh(0, Math.max(0, pane.term.rows - 1)); } catch {}
  });
  return true;
}

function resetActiveRenderer() {
  return resetPaneRenderer(getActivePane());
}

function attachPaneLinkHandlers(pane, term) {
  // The WebLinksAddon's own activate() click path doesn't reach our handler
  // under the WebGL renderer in xterm.js 5.5 (the link decoration's hit area
  // collapses to the 1-pixel underline band). Keep the addon loaded for the
  // hover underline visual, but route opening through our own holder-level
  // Ctrl/Cmd-click handler below.
  term.loadAddon(new WebLinksAddon(() => {}));
  attachBareUrlHoverProvider(term);
  attachUrlClickHandler(pane, term, pane.xtermHolder);
}

function finalizePaneTerminal(pane, term, fitAddon, searchAddon, workspace) {
  pane.term = term;
  pane.fitAddon = fitAddon;
  pane.searchAddon = searchAddon;
  workspace.panes.push(pane);
  require('./search').attachSearchResultListener(pane);
  fitPane(pane);
}

function spawnPaneShell(pane, term) {
  const shellCmd = mt.os.env.SHELL || '/bin/bash';
  const shimDir = createShellShim(shellCmd);
  pane._shimDir = shimDir;
  const { args: shellArgs, env: shellEnv } = buildShellArgs(shellCmd, shimDir);
  const ptyProc = mt.pty.spawn(shellCmd, shellArgs, {
    name: 'xterm-256color',
    cols: term.cols,
    rows: term.rows,
    cwd: pane.cwd,
    env: {
      ...shellEnv,
      TERM_PROGRAM: 'MathTerm',
      TERM_PROGRAM_VERSION: '0.6',
      COLORTERM: 'truecolor'
    }
  });
  pane.ptyProc = ptyProc;

  ptyProc.onExit(() => {
    if (pane._shimDir) {
      try { mt.fs.rmSync(pane._shimDir, { recursive: true, force: true }); } catch {}
      pane._shimDir = null;
    }
    pane.ptyProc = null;
    if (!pane._closing && getPaneById(pane.id)) {
      setTimeout(() => closePane(pane.id), 0);
    }
  });
  return ptyProc;
}

function attachTerminalEventHandlers(pane, term) {
  pane.xtermHolder.addEventListener('focusin', () => focusPane(pane.id, { focusTerm: false }));

  term.onData(data => {
    if (shouldSuppressMacFallbackData(pane, data)) return;
    focusPane(pane.id, { focusTerm: false });
    if (pane.richVisible) {
      const { tabHideRichView } = require('./richView');
      if (pane.richAutoTriggered && (data === 'q' || data === '\x1b')) {
        tabHideRichView(pane);
      } else if (!pane.richAutoTriggered && data === '\x1b') {
        tabHideRichView(pane);
      }
      return;
    }
    pane.ptyProc?.write(data);
  });

  term.onResize(({ cols, rows }) => {
    if (!pane.ptyProc) return;
    if (pane._ptyCols === cols && pane._ptyRows === rows) return;
    pane._ptyCols = cols;
    pane._ptyRows = rows;
    try { pane.ptyProc.resize(cols, rows); } catch {}
  });

  term.onSelectionChange(() => {
    if (!settings.copyOnSelect) return;
    const sel = term.getSelection();
    if (sel) mt.clipboard.writeText(sel);
  });
}

function attachOsc133Tracking(pane, term) {
  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith('A')) {
      const buf = pane.term.buffer.active;
      pane._promptStartY = buf.baseY + buf.cursorY;
      pane._promptBHandled = false;
      pane._promptJumpAnchorY = null;
      pane._promptYSet.add(pane._promptStartY);
      pane._promptStartYSet.add(pane._promptStartY);
      if (pane._promptYSet.size > 500 || pane._promptStartYSet.size > 500) {
        const minY = buf.baseY - settings.scrollback;
        prunePromptTracking(pane, minY);
      }
    } else if (data.startsWith('B')) {
      if (pane._promptStartY !== undefined && !pane._promptBHandled) {
        const endY = pane.term.buffer.active.baseY + pane.term.buffer.active.cursorY;
        for (let y = pane._promptStartY; y <= endY; y++) pane._promptYSet.add(y);
        pane._promptBHandled = true;
      }
    } else if (data.startsWith('C')) {
      pane._commandRunning = true;
      pane._commandStartY = pane.term.buffer.active.baseY + pane.term.buffer.active.cursorY;
      pane._commandStartTime = Date.now();
    } else if (data.startsWith('D')) {
      const wasCommandRunning = pane._commandRunning;
      pane._commandRunning = false;
      const exitCode = data.length > 2 ? data.slice(2).split(';')[0].trim() : '';
      pane._lastExitCode = exitCode;
      pane._commandEndY = pane.term.buffer.active.baseY + pane.term.buffer.active.cursorY;
      const workspaceIsActive = pane.workspace.id === state.activeWorkspaceId;
      const failed = exitCode !== '' && exitCode !== '0';
      if (wasCommandRunning && settings.backgroundCommandMarker && !workspaceIsActive) {
        pane.workspace.needsAttention = true;
        pane.workspace.attentionLevel = failed ? 'error' : 'success';
        pane.workspace.attentionMessage = failed ? `Command failed: exit ${exitCode}` : 'Command finished';
        updateTabBar();
      }
      const elapsedMs = pane._commandStartTime ? Date.now() - pane._commandStartTime : 0;
      const minMs = Number(settings.backgroundCommandNotificationMinMs) || 0;
      const windowIsBackground = document.hidden || !document.hasFocus();
      if (wasCommandRunning
          && settings.backgroundCommandNotifications
          && (!workspaceIsActive || windowIsBackground)
          && elapsedMs >= minMs) {
        const workspaceTitle = pane.workspace?.title || 'background tab';
        mt.ipc.send('notify-command-finished', {
          title: failed ? 'MathTerm command failed' : 'MathTerm command finished',
          body: failed
            ? `${workspaceTitle} - exit ${exitCode || 'nonzero'}`
            : workspaceTitle
        });
      }
      pane._commandStartTime = 0;
      const { tabFlushSectionOnCommandEnd } = require('./richView');
      tabFlushSectionOnCommandEnd(pane);
    }
    return false;
  });
}

function attachPtyDataPipeline(pane, term) {
  const ptyProc = pane.ptyProc;
  ptyProc.onData(data => {
    const { images, cleanData } = pane.osc1337Parser.feed(data);
    if (images.length) {
      const y = term.buffer.active.baseY + term.buffer.active.cursorY;
      for (const img of images) pane.inlineImages.push({ ...img, lineY: y });
      trimInlineImages(pane.inlineImages);
    }
    term.write(cleanData, () => scheduleTerminalRefresh(pane));
    if (images.length) {
      setTimeout(() => {
        const { showManualRichView } = require('./richView');
        showManualRichView(pane);
      }, 0);
    }
    tabFeedSection(pane, cleanData);
    tabTrackTitle(pane, cleanData);
  });
}

function createPaneSession({ id, cwd, leafEl, workspace, paneBackendId }) {
  const pane = new PaneSession(id, workspace, { paneBackendId });
  initPaneSessionState(pane, cwd);
  buildPaneSessionDom(pane, leafEl);
  const { term, fitAddon, searchAddon } = createPaneTerminal(pane);
  attachMacImePunctuationBridge(pane);
  attachPaneKeyHandler(pane, term);
  attachTerminalRenderer(pane, term);
  attachPaneLinkHandlers(pane, term);
  finalizePaneTerminal(pane, term, fitAddon, searchAddon, workspace);
  spawnPaneShell(pane, term);
  attachTerminalEventHandlers(pane, term);
  attachOsc133Tracking(pane, term);
  attachPtyDataPipeline(pane, term);
  return pane;
}

function createTab(cwd, opts = {}) {
  const previousPane = getActivePane();
  const spawnCwd = cwd
    || (settings.inheritCwd ? (previousPane?.cwd || mt.os.env.HOME) : null)
    || mt.os.env.HOME;

  const id = state.tabIdCounter++;
  const workspace = new TabWorkspace(id);
  workspace.cwd = spawnCwd;
  workspace._customTitle = opts.customTitle || null;

  const container = document.createElement('div');
  container.className = 'tab-container';
  container.dataset.id = id;
  workspace.container = container;
  state.termContainer.appendChild(container);
  if (typeof ResizeObserver !== 'undefined') {
    workspace._resizeObserver = new ResizeObserver(() => scheduleFitVisiblePanes(workspace));
    workspace._resizeObserver.observe(container);
  }

  const paneId = state.paneIdCounter++;
  workspace.activePaneId = paneId;
  workspace.layout = { type: 'pane', paneId };

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.id = id;
  tabEl.draggable = true;
  tabEl.innerHTML = '<span class="tab-title">' + escapeHtml(workspace._customTitle || workspace.title) + '</span><span class="tab-close">\u00d7</span>';
  attachTabElementListeners(workspace, tabEl);
  workspace.tabEl = tabEl;
  state.tabBar.insertBefore(tabEl, document.getElementById('new-tab-btn'));
  state.workspaces.push(workspace);

  activateWorkspaceShell(workspace);
  const root = getWorkspaceRoot(workspace);
  root.className = 'workspace-pane-root';
  root.replaceChildren();
  const leaf = createPaneLeafElement(workspace, paneId);
  leaf.style.flex = '1 1 0';
  root.appendChild(leaf);
  const pane = createPaneSession({ id: paneId, cwd: spawnCwd, leafEl: leaf, workspace });
  refreshTabTitle(pane);
  focusPane(pane.id);
  if (!opts.skipSessionSave) markSessionChanged({ structural: true });
  return workspace;
}

function remapLayoutPaneIds(node, idMap) {
  if (!node) return null;
  if (node.type === 'pane') return { type: 'pane', paneId: idMap.get(node.paneId) };
  return {
    type: 'split',
    direction: node.direction === 'column' ? 'column' : 'row',
    sizes: Array.isArray(node.sizes) ? node.sizes.slice() : undefined,
    children: (node.children || []).map(child => remapLayoutPaneIds(child, idMap)).filter(Boolean)
  };
}

function createRestoredWorkspace(snapshot) {
  const id = state.tabIdCounter++;
  const workspace = new TabWorkspace(id);
  workspace.cwd = snapshot.cwd || mt.os.env.HOME;
  workspace._customTitle = snapshot.customTitle || null;

  const container = document.createElement('div');
  container.className = 'tab-container';
  container.dataset.id = id;
  workspace.container = container;
  state.termContainer.appendChild(container);
  if (typeof ResizeObserver !== 'undefined') {
    workspace._resizeObserver = new ResizeObserver(() => scheduleFitVisiblePanes(workspace));
    workspace._resizeObserver.observe(container);
  }

  const idMap = new Map();
  for (const oldPaneId of snapshot.paneIds) idMap.set(oldPaneId, state.paneIdCounter++);
  workspace.layout = remapLayoutPaneIds(snapshot.layout, idMap);
  workspace.activePaneId = idMap.get(snapshot.activePaneId) || firstPaneIdInLayout(workspace.layout);
  workspace.maximizedPaneId = idMap.has(snapshot.maximizedPaneId) ? idMap.get(snapshot.maximizedPaneId) : null;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.id = id;
  tabEl.draggable = true;
  tabEl.innerHTML = '<span class="tab-title">' + escapeHtml(workspace._customTitle || workspace.title) + '</span><span class="tab-close">\u00d7</span>';
  attachTabElementListeners(workspace, tabEl);
  workspace.tabEl = tabEl;
  state.tabBar.insertBefore(tabEl, document.getElementById('new-tab-btn'));
  state.workspaces.push(workspace);

  renderLayout(workspace);
  for (const oldPaneId of snapshot.paneIds) {
    const paneId = idMap.get(oldPaneId);
    const paneData = snapshot.panesById.get(oldPaneId) || {};
    const leaf = getPaneLeaf(workspace, paneId);
    const pane = createPaneSession({
      id: paneId,
      cwd: paneData.cwd || workspace.cwd || mt.os.env.HOME,
      leafEl: leaf,
      workspace
    });
    pane.autoRender = paneData.autoRender !== undefined ? paneData.autoRender : settings.autoRender;
    pane.zoomFactor = paneData.zoomFactor ?? 1;
    applyZoomToTab(pane);
  }
  updateTabBar();
  return workspace;
}

function restoreSession(session) {
  if (!session || !Array.isArray(session.workspaces) || !session.workspaces.length) return false;
  const restored = [];
  for (const snapshot of session.workspaces) {
    const workspace = createRestoredWorkspace(snapshot);
    if (workspace) restored.push(workspace);
  }
  if (!restored.length) return false;
  const active = restored[Math.min(session.activeIndex || 0, restored.length - 1)] || restored[0];
  switchTab(active.id);
  markSessionChanged();
  return true;
}

function activateWorkspaceShell(workspace) {
  const prev = getActiveWorkspace();
  if (prev && prev !== workspace) {
    const { saveSearchState } = require('./search');
    const prevPane = getActivePane();
    if (prevPane) saveSearchState(prevPane);
    prev.container.classList.remove('active');
    prev.tabEl.classList.remove('active');
  }
  state.activeWorkspaceId = workspace.id;
  workspace.needsAttention = false;
  workspace.attentionLevel = null;
  workspace.attentionMessage = '';
  workspace.container.classList.add('active');
  workspace.tabEl.classList.add('active');
}

function switchTab(id, opts = {}) {
  const workspace = state.workspaces.find(w => w.id === id);
  if (!workspace) return;
  const targetPane = opts.paneId ? workspace.panes.find(p => p.id === opts.paneId) : null;
  if (id === state.activeWorkspaceId) {
    const pane = targetPane || getActivePane();
    if (pane) focusPane(pane.id, { focusTerm: opts.focusTerm, clearFocusBacklink: true });
    return;
  }
  activateWorkspaceShell(workspace);
  updatePaneActiveClasses(workspace);
  updateTabBar();
  const pane = targetPane || workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
  if (pane) {
    workspace.activePaneId = pane.id;
    requestAnimationFrame(() => {
      fitVisiblePanes(workspace);
      focusPane(pane.id, { focusTerm: opts.focusTerm, clearFocusBacklink: true });
    });
  }
}

function disposePane(pane) {
  pane._closing = true;
  clearTimeout(pane.sectionTimer);
  clearTimeout(pane._promptJumpFlashTimer);
  try { if (pane.ptyProc) pane.ptyProc.kill(); } catch {}
  try { pane._searchResultDisposable?.dispose(); } catch {}
  try { pane.term?.dispose(); } catch {}
  if (pane._shimDir) {
    try { mt.fs.rmSync(pane._shimDir, { recursive: true, force: true }); } catch {}
    pane._shimDir = null;
  }
  try { pane.container?.remove(); } catch {}
}

function closePane(paneId) {
  const workspace = getPaneWorkspace(paneId);
  if (!workspace) return;
  if (workspace.panes.length <= 1) {
    closeTab(workspace.id);
    return;
  }

  const idx = workspace.panes.findIndex(p => p.id === paneId);
  if (idx === -1) return;
  const pane = workspace.panes[idx];
  const wasActive = workspace.activePaneId === paneId;
  const richLayoutStates = new Map();
  for (const existing of workspace.panes) {
    if (existing.id !== paneId) {
      const saved = captureRichViewLayoutState(existing);
      if (saved) richLayoutStates.set(existing.id, saved);
    }
  }
  disposePane(pane);
  workspace.panes.splice(idx, 1);
  const removal = removePaneFromLayout(workspace.layout, paneId);
  workspace.layout = removal.layout;
  if (workspace.maximizedPaneId === paneId) workspace.maximizedPaneId = null;
  if (wasActive) workspace.activePaneId = removal.replacementPaneId || firstPaneIdInLayout(workspace.layout);
  renderLayout(workspace);
  for (const existing of workspace.panes) {
    restoreRichViewLayoutState(existing, richLayoutStates.get(existing.id));
  }
  updateTabBar();
  const next = workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
  if (next) {
    workspace.activePaneId = next.id;
    focusPane(next.id);
  }
  scheduleFitVisiblePanes(workspace);
  scheduleRichViewsAfterLayout(workspace);
  markSessionChanged({ structural: true });
}

function closeActivePane() {
  const pane = getActivePane();
  if (pane) closePane(pane.id);
}

function closeTab(id) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const workspace = state.workspaces[idx];
  const wasActive = state.activeWorkspaceId === id;
  for (const pane of [...workspace.panes]) disposePane(pane);
  if (workspace._fitRaf) {
    cancelAnimationFrame(workspace._fitRaf);
    workspace._fitRaf = null;
  }
  try { workspace._resizeObserver?.disconnect(); } catch {}
  workspace.container.remove();
  workspace.tabEl.remove();
  state.workspaces.splice(idx, 1);
  if (wasActive) state.activeWorkspaceId = null;
  if (state.workspaces.length === 0) {
    markSessionChanged({ structural: true });
    mt.ipc.send('close-window', { quitApp: isMac && !!settings.quitWhenLastTabClosed });
    return;
  }
  if (wasActive) {
    switchTab(state.workspaces[Math.min(idx, state.workspaces.length - 1)].id);
  }
  markSessionChanged({ structural: true });
}

function focusPane(paneId, opts = {}) {
  const workspace = getPaneWorkspace(paneId);
  const pane = workspace ? workspace.panes.find(p => p.id === paneId) : null;
  if (!workspace || !pane) return;
  if (workspace.id !== state.activeWorkspaceId) switchTab(workspace.id, { paneId, focusTerm: opts.focusTerm });

  if (opts.clearFocusBacklink) {
    for (const p of workspace.panes) p._focusBacklink = null;
  }

  const prevPane = getActivePane();
  if (prevPane && prevPane !== pane) {
    const { saveSearchState } = require('./search');
    saveSearchState(prevPane);
  }

  workspace.activePaneId = paneId;
  if (workspace.maximizedPaneId != null && workspace.maximizedPaneId !== paneId) {
    workspace.maximizedPaneId = paneId;
    renderLayout(workspace);
  }
  workspace.needsAttention = false;
  workspace.attentionLevel = null;
  workspace.attentionMessage = '';
  updatePaneActiveClasses(workspace);
  updateTabBar();
  const { attachSearchBarToPane, hydrateSearchBar } = require('./search');
  attachSearchBarToPane(pane);
  hydrateSearchBar(pane);
  updateStatusBar(pane);
  updateStatusBarCwd(pane);
  updateRendererIndicator(pane);
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = pane.autoRender ? '' : 'off';
  mt.ipc.send('rebuild-menu', pane.autoRender);
  scheduleFitVisiblePanes(workspace);
  markSessionChanged();
  if (opts.focusTerm !== false) {
    requestAnimationFrame(() => {
      if (pane.richVisible) pane.richView?.focus();
      else pane.term?.focus();
    });
  }
}

function splitActivePane(direction) {
  const pane = getActivePane();
  const workspace = getActiveWorkspace();
  if (!pane || !workspace) return;
  if (workspace.maximizedPaneId != null) {
    workspace.maximizedPaneId = null;
    renderLayout(workspace);
  }
  const path = findLeafPath(workspace.layout, pane.id);
  if (!path) return;

  const newPaneId = state.paneIdCounter++;
  const newNode = {
    type: 'split',
    direction,
    sizes: [0.5, 0.5],
    children: [
      { type: 'pane', paneId: pane.id },
      { type: 'pane', paneId: newPaneId }
    ]
  };
  workspace.layout = replaceNodeAtPath(workspace.layout, path, newNode);
  workspace.activePaneId = newPaneId;

  const gutter = createGutterElement(workspace, path, 1, direction);
  const newLeaf = createPaneLeafElement(workspace, newPaneId);
  const oldLeaf = getPaneLeaf(workspace, pane.id);
  if (!oldLeaf || !oldLeaf.parentNode) return;

  const parent = oldLeaf.parentNode;
  const splitFlex = oldLeaf.style.flex || '1 1 0';
  const splitEl = document.createElement('div');
  splitEl.className = `pane-split ${direction}`;
  splitEl.style.flex = splitFlex;
  parent.insertBefore(splitEl, oldLeaf);
  oldLeaf.style.flex = '0.5 1 0';
  newLeaf.style.flex = '0.5 1 0';
  splitEl.appendChild(oldLeaf);
  splitEl.appendChild(gutter);
  splitEl.appendChild(newLeaf);
  pane.leafEl = oldLeaf;
  oldLeaf.classList.remove('active');
  newLeaf.classList.add('active');

  stabilizeVisiblePanes(workspace, pane.id);
  requestAnimationFrame(() => {
    const newPane = createPaneSession({
      id: newPaneId,
      cwd: pane.cwd || mt.os.env.HOME,
      leafEl: newLeaf,
      workspace
    });
    focusPane(newPane.id);
    refreshTabTitle(newPane);
    stabilizeVisiblePanes(workspace, newPane.id);
    markSessionChanged({ structural: true });
  });
}

function splitPaneRight() {
  splitActivePane('row');
}

function splitPaneDown() {
  splitActivePane('column');
}

function togglePaneMaximize() {
  const workspace = getActiveWorkspace();
  const pane = getActivePane();
  if (!workspace || !pane) return;
  workspace.maximizedPaneId = workspace.maximizedPaneId === pane.id ? null : pane.id;
  workspace.activePaneId = pane.id;
  renderLayout(workspace);
  focusPane(pane.id);
  scheduleFitVisiblePanes(workspace);
  scheduleRichViewsAfterLayout(workspace);
  markSessionChanged({ structural: true });
}

function getPaneLeafRects(workspace) {
  return workspace.panes.map(pane => {
    const leaf = getPaneLeaf(workspace, pane.id);
    if (!leaf) return null;
    const rect = leaf.getBoundingClientRect();
    return {
      pane,
      rect,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2
    };
  }).filter(Boolean);
}

function rectOverlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function oppositeDirection(direction) {
  return { left: 'right', right: 'left', up: 'down', down: 'up' }[direction] || null;
}

function focusPaneInDirection(direction) {
  const workspace = getActiveWorkspace();
  const active = getActivePane();
  if (!workspace || !active) return;
  const backlink = active._focusBacklink;
  if (backlink
    && backlink.direction === oppositeDirection(direction)
    && workspace.panes.some(p => p.id === backlink.fromPaneId)) {
    active._focusBacklink = null;
    focusPane(backlink.fromPaneId);
    return;
  }
  const rects = getPaneLeafRects(workspace);
  const cur = rects.find(r => r.pane.id === active.id);
  if (!cur) return;
  const EPS = 2;
  const candidates = rects.map(r => {
    if (r.pane.id === active.id) return false;
    let primaryGap;
    let secondaryDistance;
    let overlap;
    if (direction === 'left') {
      if (r.rect.right > cur.rect.left - EPS) return false;
      primaryGap = cur.rect.left - r.rect.right;
      secondaryDistance = Math.abs(r.cy - cur.cy);
      overlap = rectOverlap(cur.rect.top, cur.rect.bottom, r.rect.top, r.rect.bottom);
    } else if (direction === 'right') {
      if (r.rect.left < cur.rect.right + EPS) return false;
      primaryGap = r.rect.left - cur.rect.right;
      secondaryDistance = Math.abs(r.cy - cur.cy);
      overlap = rectOverlap(cur.rect.top, cur.rect.bottom, r.rect.top, r.rect.bottom);
    } else if (direction === 'up') {
      if (r.rect.bottom > cur.rect.top - EPS) return false;
      primaryGap = cur.rect.top - r.rect.bottom;
      secondaryDistance = Math.abs(r.cx - cur.cx);
      overlap = rectOverlap(cur.rect.left, cur.rect.right, r.rect.left, r.rect.right);
    } else if (direction === 'down') {
      if (r.rect.top < cur.rect.bottom + EPS) return false;
      primaryGap = r.rect.top - cur.rect.bottom;
      secondaryDistance = Math.abs(r.cx - cur.cx);
      overlap = rectOverlap(cur.rect.left, cur.rect.right, r.rect.left, r.rect.right);
    } else {
      return false;
    }
    return { ...r, primaryGap, secondaryDistance, overlaps: overlap > EPS, overlap };
  }).filter(Boolean);
  candidates.sort((a, b) => {
    if (a.overlaps !== b.overlaps) return a.overlaps ? -1 : 1;
    if (a.primaryGap !== b.primaryGap) return a.primaryGap - b.primaryGap;
    if (a.secondaryDistance !== b.secondaryDistance) return a.secondaryDistance - b.secondaryDistance;
    if (a.overlap !== b.overlap) return b.overlap - a.overlap;
    return a.pane.id - b.pane.id;
  });
  if (candidates[0]) {
    const next = candidates[0].pane;
    next._focusBacklink = { fromPaneId: active.id, direction };
    focusPane(next.id);
  }
}

function paneOrder(workspace = getActiveWorkspace()) {
  if (!workspace) return [];
  const ids = paneIdsInLayout(workspace.layout);
  return ids.map(id => workspace.panes.find(p => p.id === id)).filter(Boolean);
}

function focusPaneByOffset(delta) {
  const workspace = getActiveWorkspace();
  const active = getActivePane();
  const panes = paneOrder(workspace);
  if (!workspace || !active || panes.length < 2) return;
  const idx = panes.findIndex(p => p.id === active.id);
  if (idx === -1) return;
  const next = panes[(idx + delta + panes.length) % panes.length];
  if (next) focusPane(next.id, { clearFocusBacklink: true });
}

function focusNextPane() {
  focusPaneByOffset(1);
}

function focusPrevPane() {
  focusPaneByOffset(-1);
}

function isPaneShortcut(e) {
  const sc = settings.shortcuts || {};
  for (const key of ['splitPaneRight', 'splitPaneDown', 'closePane', 'nextPane', 'prevPane', 'togglePaneMaximize']) {
    const parsed = parseShortcut(sc[key]);
    if (parsed && matchShortcut(parsed, e, isMac)) return true;
  }
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (isMac && e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && arrows.includes(e.key)) return true;
  if (!isMac && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && arrows.includes(e.key)) return true;
  return false;
}

function handlePaneShortcut(e) {
  if (!isPaneShortcut(e)) return false;
  e.preventDefault();
  e.stopPropagation();
  const sc = settings.shortcuts || {};
  if (matchShortcut(parseShortcut(sc.splitPaneRight), e, isMac)) splitPaneRight();
  else if (matchShortcut(parseShortcut(sc.splitPaneDown), e, isMac)) splitPaneDown();
  else if (matchShortcut(parseShortcut(sc.closePane), e, isMac)) closeActivePane();
  else if (matchShortcut(parseShortcut(sc.nextPane), e, isMac)) focusNextPane();
  else if (matchShortcut(parseShortcut(sc.prevPane), e, isMac)) focusPrevPane();
  else if (matchShortcut(parseShortcut(sc.togglePaneMaximize), e, isMac)) togglePaneMaximize();
  else if (isMac && e.metaKey && e.altKey && e.key === 'ArrowLeft') focusPaneInDirection('left');
  else if (isMac && e.metaKey && e.altKey && e.key === 'ArrowRight') focusPaneInDirection('right');
  else if (isMac && e.metaKey && e.altKey && e.key === 'ArrowUp') focusPaneInDirection('up');
  else if (isMac && e.metaKey && e.altKey && e.key === 'ArrowDown') focusPaneInDirection('down');
  else if (!isMac && e.altKey && e.key === 'ArrowLeft') focusPaneInDirection('left');
  else if (!isMac && e.altKey && e.key === 'ArrowRight') focusPaneInDirection('right');
  else if (!isMac && e.altKey && e.key === 'ArrowUp') focusPaneInDirection('up');
  else if (!isMac && e.altKey && e.key === 'ArrowDown') focusPaneInDirection('down');
  return true;
}

function rebuildTabBarDOM() {
  const newBtn = document.getElementById('new-tab-btn');
  for (const workspace of state.workspaces) state.tabBar.removeChild(workspace.tabEl);
  for (const workspace of state.workspaces) state.tabBar.insertBefore(workspace.tabEl, newBtn);
}

function attachTabElementListeners(workspace, tabEl) {
  const id = workspace.id;
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
    const [moved] = state.workspaces.splice(fromIdx, 1);
    let newIdx = getTabIndex(id);
    if (!insertBefore) newIdx++;
    state.workspaces.splice(newIdx, 0, moved);
    rebuildTabBarDOM();
    markSessionChanged({ structural: true });
  });
}

function showTabContextMenu(id, x, y) {
  state.tabContextMenuId = id;
  const idx = getTabIndex(id);
  const workspace = state.workspaces.find(w => w.id === id);
  document.getElementById('tctx-moveleft').classList.toggle('disabled', idx <= 0);
  document.getElementById('tctx-moveright').classList.toggle('disabled', idx >= state.workspaces.length - 1);
  document.getElementById('tctx-detach').classList.toggle('disabled', !!workspace && workspace.panes.length > 1);
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
  const workspace = state.workspaces.find(w => w.id === id);
  if (!workspace) return;
  const titleEl = workspace.tabEl.querySelector('.tab-title');
  if (!titleEl) return;
  titleEl.textContent = workspace._customTitle || workspace.title;
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
    if (newName) workspace._customTitle = newName;
    else {
      workspace._customTitle = null;
      titleEl.textContent = workspace.title;
    }
    titleEl.removeEventListener('blur', finish);
    titleEl.removeEventListener('keydown', onKey);
    updateTabBar();
    markSessionChanged({ structural: true });
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { titleEl.textContent = workspace._customTitle || workspace.title; finish(); }
    e.stopPropagation();
  }
  titleEl.addEventListener('blur', finish);
  titleEl.addEventListener('keydown', onKey);
}

function moveTab(id, direction) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= state.workspaces.length) return;
  [state.workspaces[idx], state.workspaces[newIdx]] = [state.workspaces[newIdx], state.workspaces[idx]];
  rebuildTabBarDOM();
  markSessionChanged({ structural: true });
}

function detachTab(id) {
  const workspace = state.workspaces.find(w => w.id === id);
  if (!workspace || workspace.panes.length > 1) return;
  const pane = workspace.panes[0];
  mt.ipc.send('detach-tab', {
    cwd: pane.cwd,
    title: workspace._customTitle || workspace.title
  });
  closeTab(id);
}

function initTabContextListeners() {
  document.getElementById('tctx-rename').addEventListener('click', () => { renameTab(state.tabContextMenuId); hideTabContextMenu(); });
  document.getElementById('tctx-moveleft').addEventListener('click', () => { moveTab(state.tabContextMenuId, -1); hideTabContextMenu(); });
  document.getElementById('tctx-moveright').addEventListener('click', () => { moveTab(state.tabContextMenuId, 1); hideTabContextMenu(); });
  document.getElementById('tctx-detach').addEventListener('click', () => {
    const el = document.getElementById('tctx-detach');
    if (!el.classList.contains('disabled')) detachTab(state.tabContextMenuId);
    hideTabContextMenu();
  });
  document.getElementById('tctx-close').addEventListener('click', () => { closeTab(state.tabContextMenuId); hideTabContextMenu(); });
  document.addEventListener('click', e => {
    if (!document.getElementById('tab-context-menu').contains(e.target)) hideTabContextMenu();
  });
}

module.exports = {
  createTab,
  restoreSession,
  switchTab,
  closeTab,
  closePane,
  closeActivePane,
  splitPaneRight,
  splitPaneDown,
  focusPane,
  focusPaneInDirection,
  focusNextPane,
  focusPrevPane,
  togglePaneMaximize,
  isPaneShortcut,
  handlePaneShortcut,
  resetActiveRenderer,
  resetPaneRenderer,
  fitVisiblePanes,
  scheduleFitVisiblePanes,
  updateRendererIndicator,
  rebuildTabBarDOM,
  showTabContextMenu,
  hideTabContextMenu,
  renameTab,
  moveTab,
  detachTab,
  initTabContextListeners
};
