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
const { settings, isMac, requestMenuRebuild } = require('./settings');
const { parseShortcut, matchShortcut } = require('./keybindings');
const { applyZoomToTab, isZoomShortcut } = require('./zoom');
const { escapeHtml } = require('./ansi');
const { PaneSession } = require('./paneSession');
const { TabWorkspace } = require('./workspace');
const {
  tabFeedSection,
  showManualRichView,
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
const { cloneLayout } = require('../shared/sessionFormat');

const IMAGE_MAX_COUNT = 50;
const IMAGE_MAX_BYTES = 512 * 1024 * 1024;
const LIVE_TAB_TRANSFER_MIME = 'application/x-mathterm-live-tab';

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
  const markerLimit = Math.max(1024, Math.min(8192, Math.floor(settings.scrollback / 2)));
  while (pane._promptMarkerEntries && pane._promptMarkerEntries.length > markerLimit) {
    disposePromptMarkerEntry(pane, pane._promptMarkerEntries[0]);
  }
}

function markerLine(marker) {
  if (!marker || marker.isDisposed || marker.line == null || marker.line < 0) return null;
  return marker.line;
}

function removePromptMarkerEntry(pane, entry) {
  if (!pane || !entry) return;
  const entries = pane._promptMarkerEntries || [];
  const idx = entries.indexOf(entry);
  if (idx !== -1) entries.splice(idx, 1);
  if (pane._activePromptMarkerEntry === entry) pane._activePromptMarkerEntry = null;
}

function disposePromptMarkerEntry(pane, entry) {
  if (!entry || entry.disposed) return;
  entry.disposed = true;
  removePromptMarkerEntry(pane, entry);
  try { entry.start?.dispose?.(); } catch {}
  try { entry.end?.dispose?.(); } catch {}
}

function registerPromptMarker(pane) {
  try {
    return typeof pane.term?.registerMarker === 'function' ? pane.term.registerMarker(0) : null;
  } catch {
    return null;
  }
}

function addPromptStartMarker(pane) {
  const marker = registerPromptMarker(pane);
  if (!marker) {
    pane._activePromptMarkerEntry = null;
    return null;
  }
  const entry = { start: marker, end: null };
  pane._promptMarkerEntries.push(entry);
  pane._activePromptMarkerEntry = entry;
  marker.onDispose(() => disposePromptMarkerEntry(pane, entry));
  prunePromptTracking(pane, Math.max(0, pane.term?.buffer?.active?.baseY - settings.scrollback));
  return entry;
}

function addPromptEndMarker(pane) {
  const entry = pane._activePromptMarkerEntry;
  if (!entry || entry.end) return null;
  const marker = registerPromptMarker(pane);
  if (!marker) return null;
  entry.end = marker;
  marker.onDispose(() => {
    if (entry.end === marker) entry.end = null;
  });
  return marker;
}

function disposePromptMarkers(pane) {
  const entries = Array.isArray(pane?._promptMarkerEntries) ? pane._promptMarkerEntries.splice(0) : [];
  pane._activePromptMarkerEntry = null;
  for (const entry of entries) disposePromptMarkerEntry(pane, entry);
}

function rebuildPromptTrackingFromMarkers(pane, buf, startY, endY) {
  const entries = Array.isArray(pane._promptMarkerEntries) ? pane._promptMarkerEntries : [];
  let count = 0;
  for (const entry of entries) {
    const start = markerLine(entry.start);
    if (start == null || start < startY || start > endY) continue;
    let end = markerLine(entry.end);
    if (end == null || end < start) {
      try {
        const range = buf.getWrappedRangeForLine(start);
        end = range && Number.isInteger(range.last) ? range.last : start;
      } catch {
        end = start;
      }
    }
    end = Math.min(end, endY);
    pane._promptStartYSet.add(start);
    for (let y = start; y <= end; y++) pane._promptYSet.add(y);
    count++;
  }
  return count;
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

function createPaneTerminal(pane, opts = {}) {
  const { resolveTheme, selectionBgFor } = require('./themes');
  const themeColors = resolveTheme(settings.theme);
  const term = new Terminal({
    cols: Number.isInteger(opts.cols) && opts.cols > 0 ? opts.cols : undefined,
    rows: Number.isInteger(opts.rows) && opts.rows > 0 ? opts.rows : undefined,
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

function spawnPaneShell(pane, term, opts = {}) {
  const shellCmd = mt.os.env.SHELL || '/bin/bash';
  let ptyProc;
  try {
    ptyProc = opts.attachExisting
      ? mt.pty.attach(pane.paneBackendId, { afterSeq: opts.afterSeq })
      : mt.pty.spawn(shellCmd, [], {
        paneBackendId: pane.paneBackendId,
        name: 'xterm-256color',
        cols: term.cols,
        rows: term.rows,
        cwd: pane.cwd,
        scrollback: settings.scrollback
      });
  } catch (err) {
    const message = err?.message || String(err || 'Unknown PTY error');
    console.error('Failed to spawn pane shell:', err);
    term.write(`\r\n\x1b[31mMathTerm could not start the shell.\x1b[0m\r\n${message}\r\n`);
    pane.ptyProc = null;
    return null;
  }
  pane.ptyProc = ptyProc;

  ptyProc.onExit(() => {
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
    const colsChanged = pane._ptyCols !== undefined && pane._ptyCols !== cols;
    pane._ptyCols = cols;
    pane._ptyRows = rows;
    try { pane.ptyProc.resize(cols, rows); } catch {}
    if (colsChanged) schedulePromptTrackingRebuild(pane);
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
      addPromptStartMarker(pane);
      if (pane._promptYSet.size > 500 || pane._promptStartYSet.size > 500) {
        const minY = buf.baseY - settings.scrollback;
        prunePromptTracking(pane, minY);
      }
    } else if (data.startsWith('B')) {
      if (pane._promptStartY !== undefined && !pane._promptBHandled) {
        const endY = pane.term.buffer.active.baseY + pane.term.buffer.active.cursorY;
        for (let y = pane._promptStartY; y <= endY; y++) pane._promptYSet.add(y);
        addPromptEndMarker(pane);
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
  if (!ptyProc) return;
  ptyProc.onData((data, meta = {}) => {
    const { images, cleanData } = pane.osc1337Parser.feed(data);
    if (images.length) {
      const y = term.buffer.active.baseY + term.buffer.active.cursorY;
      for (const img of images) pane.inlineImages.push({ ...img, lineY: y });
      trimInlineImages(pane.inlineImages);
    }
    const ackOutput = () => {
      if (meta.batchId != null && ptyProc.ack) ptyProc.ack(meta.batchId);
    };
    if (cleanData) {
      term.write(cleanData, () => {
        scheduleTerminalRefresh(pane);
        ackOutput();
      });
    } else {
      ackOutput();
    }
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

function rebuildPromptTrackingFromBuffer(pane) {
  if (!pane?.term?.buffer?.active) return;
  const entries = Array.isArray(pane._promptMarkerEntries) ? pane._promptMarkerEntries : [];
  const prefix = pane._promptPrefix;
  if (!entries.length && !prefix) return;

  const buf = pane.term.buffer.active;
  const startY = Math.max(0, buf.baseY - settings.scrollback);
  const endY = buf.baseY + buf.length - 1;
  pane._promptYSet.clear();
  pane._promptStartYSet.clear();

  const rebuiltFromMarkers = rebuildPromptTrackingFromMarkers(pane, buf, startY, endY);
  if (prefix) {
    for (let y = startY; y <= endY; y++) {
      let line;
      try { line = buf.getLine(y); } catch { line = null; }
      if (!line || line.isWrapped) continue;
      const text = line.translateToString(true).trimStart();
      if (!text.startsWith(prefix)) continue;
      pane._promptYSet.add(y);
      pane._promptStartYSet.add(y);
    }
  }
  prunePromptTracking(pane, startY);
  if (rebuiltFromMarkers || prefix) pane._promptJumpAnchorY = null;
}

function schedulePromptTrackingRebuild(pane) {
  if (!pane || pane._promptResizeRebuildRaf) return;
  pane._promptResizeRebuildRaf = requestAnimationFrame(() => {
    pane._promptResizeRebuildRaf = 0;
    rebuildPromptTrackingFromBuffer(pane);
    scheduleTerminalRefresh(pane);
    if (pane.richVisible) refreshRichViewAfterLayout(pane, { force: true });
  });
}

function handleBackgroundCommandEnded(pane, command = {}) {
  const endedAt = Number(command.endedAt) || 0;
  if (!endedAt || endedAt <= (pane._mainCommandEndedAt || 0)) return;
  pane._mainCommandEndedAt = endedAt;
  if (command.endedWithAttachedView) return;

  const exitCode = command.lastExitCode || '';
  const failed = exitCode !== '' && exitCode !== '0';
  const elapsedMs = endedAt - (Number(command.startedAt) || endedAt);
  const minMs = Number(settings.backgroundCommandNotificationMinMs) || 0;
  const workspace = pane.workspace;
  if (workspace && settings.backgroundCommandMarker) {
    workspace.needsAttention = true;
    workspace.attentionLevel = failed ? 'error' : 'success';
    workspace.attentionMessage = failed ? `Command failed: exit ${exitCode}` : 'Command finished';
    updateTabBar();
  }
  const windowIsBackground = document.hidden || !document.hasFocus();
  if (settings.backgroundCommandNotifications && windowIsBackground && elapsedMs >= minMs) {
    const workspaceTitle = workspace?.title || 'background tab';
    mt.ipc.send('notify-command-finished', {
      title: failed ? 'MathTerm command failed' : 'MathTerm command finished',
      body: failed ? `${workspaceTitle} - exit ${exitCode || 'nonzero'}` : workspaceTitle
    });
  }
}

function applyMainPaneMetadata(pane, metadata = {}, opts = {}) {
  let changed = false;
  if (metadata.cwd && metadata.cwd !== pane.cwd) {
    pane.cwd = metadata.cwd;
    changed = true;
  }
  if (metadata.title && metadata.title !== pane._mainTitle) {
    pane._mainTitle = metadata.title;
    changed = true;
  }
  if (metadata.displayHost && metadata.displayHost !== pane.displayHost) {
    pane.displayHost = metadata.displayHost;
    changed = true;
  }
  if (metadata.promptPrefix && metadata.promptPrefix !== pane._promptPrefix) {
    pane._promptPrefix = metadata.promptPrefix;
    changed = true;
  }
  if (metadata.command) {
    pane._commandRunning = !!metadata.command.running;
    pane._commandStartTime = metadata.command.startedAt || pane._commandStartTime || 0;
    pane._lastExitCode = metadata.command.lastExitCode || pane._lastExitCode || '';
    if (opts.fromSnapshot && !metadata.command.running) {
      handleBackgroundCommandEnded(pane, metadata.command);
    }
  }
  if (changed) refreshTabTitle(pane);
}

function attachPtyMetadataPipeline(pane) {
  const ptyProc = pane.ptyProc;
  if (!ptyProc?.onMetadata) return;
  ptyProc.onMetadata((metadata) => applyMainPaneMetadata(pane, metadata));
}

function createPaneSession({ id, cwd, leafEl, workspace, paneBackendId, attachExisting = false, snapshot = null, onSnapshotReady = null }) {
  const pane = new PaneSession(id, workspace, { paneBackendId });
  initPaneSessionState(pane, cwd);
  buildPaneSessionDom(pane, leafEl);
  const { term, fitAddon, searchAddon } = createPaneTerminal(pane, {
    cols: snapshot?.cols,
    rows: snapshot?.rows
  });
  attachMacImePunctuationBridge(pane);
  attachPaneKeyHandler(pane, term);
  attachTerminalRenderer(pane, term);
  attachPaneLinkHandlers(pane, term);
  finalizePaneTerminal(pane, term, fitAddon, searchAddon, workspace);
  spawnPaneShell(pane, term, {
    attachExisting,
    afterSeq: snapshot?.snapshotSeq || 0
  });
  if (snapshot?.metadata) applyMainPaneMetadata(pane, snapshot.metadata, { fromSnapshot: attachExisting });
  attachTerminalEventHandlers(pane, term);
  attachOsc133Tracking(pane, term);
  attachPtyMetadataPipeline(pane);
  if (attachExisting && snapshot?.snapshot) {
    term.write(snapshot.snapshot, () => {
      rebuildPromptTrackingFromBuffer(pane);
      scheduleTerminalRefresh(pane);
      attachPtyDataPipeline(pane, term);
      if (typeof onSnapshotReady === 'function') onSnapshotReady(pane);
    });
  } else {
    attachPtyDataPipeline(pane, term);
    if (typeof onSnapshotReady === 'function') onSnapshotReady(pane);
  }
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

function applyRestoredMaximizedLayout(workspace) {
  if (!workspace || workspace.maximizedPaneId == null) return;
  if (!workspace.panes.some(pane => pane.id === workspace.maximizedPaneId)) {
    workspace.maximizedPaneId = null;
    return;
  }
  renderLayout(workspace);
  updatePaneActiveClasses(workspace);
  scheduleFitVisiblePanes(workspace);
  scheduleRichViewsAfterLayout(workspace);
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
  workspace.activePaneId = idMap.has(snapshot.activePaneId)
    ? idMap.get(snapshot.activePaneId)
    : firstPaneIdInLayout(workspace.layout);
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
  applyRestoredMaximizedLayout(workspace);
  updateTabBar();
  return workspace;
}

async function createLiveWorkspace(snapshot, opts = {}) {
  if (!snapshot || !Array.isArray(snapshot.panes) || !snapshot.panes.length) return null;
  const id = state.tabIdCounter++;
  const workspace = new TabWorkspace(id, { workspaceBackendId: snapshot.workspaceBackendId });
  workspace.cwd = snapshot.cwd || mt.os.env.HOME;
  workspace.title = snapshot.title || workspace.title;
  workspace._customTitle = snapshot.customTitle || null;

  const idMap = new Map();
  for (const paneData of snapshot.panes) {
    if (Number.isInteger(paneData.id)) idMap.set(paneData.id, state.paneIdCounter++);
  }
  workspace.layout = remapLayoutPaneIds(cloneLayout(snapshot.layout), idMap);
  if (!workspace.layout) return null;
  const layoutPaneIds = new Set(paneIdsInLayout(workspace.layout));
  workspace.activePaneId = idMap.has(snapshot.activePaneId)
    ? idMap.get(snapshot.activePaneId)
    : firstPaneIdInLayout(workspace.layout);
  workspace.maximizedPaneId = idMap.has(snapshot.maximizedPaneId)
    ? idMap.get(snapshot.maximizedPaneId)
    : null;

  const container = document.createElement('div');
  container.className = 'tab-container';
  container.dataset.id = id;
  workspace.container = container;
  state.termContainer.appendChild(container);
  if (typeof ResizeObserver !== 'undefined') {
    workspace._resizeObserver = new ResizeObserver(() => scheduleFitVisiblePanes(workspace));
    workspace._resizeObserver.observe(container);
  }

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.id = id;
  tabEl.draggable = true;
  tabEl.innerHTML = '<span class="tab-title">' + escapeHtml(workspace._customTitle || workspace.title) + '</span><span class="tab-close">\u00d7</span>';
  attachTabElementListeners(workspace, tabEl);
  workspace.tabEl = tabEl;
  state.tabBar.insertBefore(tabEl, document.getElementById('new-tab-btn'));
  state.workspaces.push(workspace);
  if (Number.isInteger(opts.insertIndex)) {
    const currentIndex = state.workspaces.indexOf(workspace);
    const targetIndex = Math.max(0, Math.min(opts.insertIndex, state.workspaces.length - 1));
    if (currentIndex !== -1 && currentIndex !== targetIndex) {
      state.workspaces.splice(currentIndex, 1);
      state.workspaces.splice(targetIndex, 0, workspace);
      rebuildTabBarDOM();
    }
  }

  renderLayout(workspace);
  const paneEntries = await Promise.all(snapshot.panes.map(async (paneData) => {
    const paneId = idMap.get(paneData.id);
    if (!Number.isInteger(paneId) || !layoutPaneIds.has(paneId) || !paneData.paneBackendId) return null;
    const leaf = getPaneLeaf(workspace, paneId);
    if (!leaf) return null;
    let paneSnapshot = null;
    try {
      const result = await mt.pty.snapshot(paneData.paneBackendId);
      if (result?.ok) paneSnapshot = result;
      else throw new Error(result?.error || 'Snapshot failed');
    } catch (err) {
      console.error('Failed to snapshot live pane:', err);
    }
    return { paneData, paneId, leaf, paneSnapshot };
  }));
  for (const entry of paneEntries) {
    if (!entry) continue;
    const { paneData, paneId, leaf, paneSnapshot } = entry;
    const pane = createPaneSession({
      id: paneId,
      cwd: paneSnapshot?.metadata?.cwd || paneData.cwd || workspace.cwd || mt.os.env.HOME,
      leafEl: leaf,
      workspace,
      paneBackendId: paneData.paneBackendId,
      attachExisting: true,
      snapshot: paneSnapshot,
      onSnapshotReady: pane => {
        if (paneData.richVisible) {
          showManualRichView(pane);
          restoreRichViewLayoutState(pane, paneData.richViewState);
        }
      }
    });
    pane.autoRender = paneData.autoRender !== undefined ? paneData.autoRender : settings.autoRender;
    pane.zoomFactor = paneData.zoomFactor ?? 1;
    applyZoomToTab(pane);
  }
  if (!workspace.panes.some(pane => pane.id === workspace.activePaneId)) {
    workspace.activePaneId = workspace.panes[0]?.id || firstPaneIdInLayout(workspace.layout);
  }
  applyRestoredMaximizedLayout(workspace);
  updateTabBar();
  return workspace;
}

async function restoreLiveWorkspaceToken(token) {
  if (!token) return false;
  const result = await mt.ipc.invoke('claim-live-workspace', token);
  if (!result?.ok || !result.workspace) throw new Error(result?.error || 'Failed to claim live workspace');
  const workspace = await createLiveWorkspace(result.workspace);
  if (!workspace) return false;
  const complete = await mt.ipc.invoke('complete-live-workspace', token);
  if (!complete?.ok) throw new Error(complete?.error || 'Live workspace completion failed');
  activateWorkspaceShell(workspace);
  updatePaneActiveClasses(workspace);
  const pane = workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
  if (pane) focusPane(pane.id);
  stabilizeVisiblePanes(workspace, pane?.id || null);
  markSessionChanged({ structural: true });
  return true;
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

function disposePane(pane, opts = {}) {
  pane._closing = true;
  clearTimeout(pane.sectionTimer);
  clearTimeout(pane._promptJumpFlashTimer);
  if (pane._promptResizeRebuildRaf) {
    cancelAnimationFrame(pane._promptResizeRebuildRaf);
    pane._promptResizeRebuildRaf = 0;
  }
  disposePromptMarkers(pane);
  try {
    if (pane.ptyProc) {
      if (opts.killBackend === false && pane.ptyProc.detach) pane.ptyProc.detach();
      else pane.ptyProc.kill();
    }
  } catch {}
  try { pane._searchResultDisposable?.dispose(); } catch {}
  try { pane.term?.dispose(); } catch {}
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

function closeTab(id, opts = {}) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const workspace = state.workspaces[idx];
  const wasActive = state.activeWorkspaceId === id;
  for (const pane of [...workspace.panes]) disposePane(pane, { killBackend: opts.killBackend !== false });
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
  requestMenuRebuild(pane.autoRender);
  scheduleFitVisiblePanes(workspace);
  markSessionChanged();
  if (opts.focusTerm !== false) {
    requestAnimationFrame(() => {
      if (pane.richVisible) pane.richView?.focus();
      else pane.term?.focus();
    });
  }
}

function splitActivePane(direction, placement = 'after') {
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
  const newPaneNode = { type: 'pane', paneId: newPaneId };
  const oldPaneNode = { type: 'pane', paneId: pane.id };
  const newNode = {
    type: 'split',
    direction,
    sizes: [0.5, 0.5],
    children: placement === 'before'
      ? [newPaneNode, oldPaneNode]
      : [oldPaneNode, newPaneNode]
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
  if (placement === 'before') {
    splitEl.appendChild(newLeaf);
    splitEl.appendChild(gutter);
    splitEl.appendChild(oldLeaf);
  } else {
    splitEl.appendChild(oldLeaf);
    splitEl.appendChild(gutter);
    splitEl.appendChild(newLeaf);
  }
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

function splitPaneLeft() {
  splitActivePane('row', 'before');
}

function splitPaneDown() {
  splitActivePane('column');
}

function splitPaneUp() {
  splitActivePane('column', 'before');
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

function shouldDetachDraggedTab(e) {
  if (!e || state.dragDropHandled) return false;
  const dx = Number(e.clientX) - Number(state.dragStartClientX || 0);
  const dy = Number(e.clientY) - Number(state.dragStartClientY || 0);
  if (Math.hypot(dx, dy) < 24) return false;
  const tabBarRect = state.tabBar?.getBoundingClientRect?.();
  if (!tabBarRect) return false;
  if (e.clientX === 0 && e.clientY === 0) return true;
  const margin = 10;
  return e.clientX < tabBarRect.left - margin
    || e.clientX > tabBarRect.right + margin
    || e.clientY < tabBarRect.top - margin
    || e.clientY > tabBarRect.bottom + margin;
}

function makeLiveTabTransferToken(id) {
  const rand = Math.random().toString(36).slice(2);
  return `live-tab:${Date.now()}:${id}:${rand}`;
}

function liveTabTokenFromDrop(e) {
  try {
    return e.dataTransfer?.getData?.(LIVE_TAB_TRANSFER_MIME) || '';
  } catch {
    return '';
  }
}

function dragTypesInclude(e, type) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  if (typeof types.includes === 'function') return types.includes(type);
  if (typeof types.contains === 'function') return types.contains(type);
  return Array.from(types).includes(type);
}

function hasLiveTabDrag(e) {
  return !!liveTabTokenFromDrop(e)
    || dragTypesInclude(e, LIVE_TAB_TRANSFER_MIME)
    || !!state.externalDragTransferToken;
}

async function tokenForLiveTabDrop(e) {
  const token = liveTabTokenFromDrop(e) || state.externalDragTransferToken || '';
  if (token) return token;
  try {
    const result = await mt.ipc.invoke('get-active-live-tab-drag');
    return result?.ok ? (result.token || '') : '';
  } catch {
    return '';
  }
}

function prepareLiveTabDrag(workspace, event = null) {
  if (!workspace || !workspace.panes.length) return '';
  const token = makeLiveTabTransferToken(workspace.id);
  state.dragTransferToken = token;
  try {
    mt.ipc.send('prepare-live-tab-drag', {
      token,
      dragStartClientX: event?.clientX,
      dragStartClientY: event?.clientY,
      dragStartScreenX: event?.screenX,
      dragStartScreenY: event?.screenY,
      workspace: captureLiveWorkspace(workspace)
    });
  } catch {}
  return token;
}

async function acceptLiveTabDrop(e, insertIndex = state.workspaces.length) {
  const token = await tokenForLiveTabDrop(e);
  if (!token || token === state.dragTransferToken) return false;
  e.preventDefault();
  e.stopPropagation();
  state.dragDropHandled = true;
  const result = await mt.ipc.invoke('accept-live-tab-drag', token);
  if (!result?.ok || !result.workspace) throw new Error(result?.error || 'Live tab transfer failed');
  const workspace = await createLiveWorkspace(result.workspace, { insertIndex });
  if (!workspace) throw new Error('Live tab transfer had no restorable workspace');
  const complete = await mt.ipc.invoke('complete-live-tab-drag', token);
  if (!complete?.ok) throw new Error(complete?.error || 'Live tab transfer completion failed');
  activateWorkspaceShell(workspace);
  updatePaneActiveClasses(workspace);
  const pane = workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
  if (pane) focusPane(pane.id);
  stabilizeVisiblePanes(workspace, pane?.id || null);
  markSessionChanged({ structural: true });
  return true;
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
    state.dragDropHandled = false;
    state.dragStartClientX = e.clientX;
    state.dragStartClientY = e.clientY;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    const token = prepareLiveTabDrag(workspace, e);
    if (token) {
      e.dataTransfer.setData(LIVE_TAB_TRANSFER_MIME, token);
    } else {
      e.dataTransfer.setData('text/plain', String(id));
    }
  });
  tabEl.addEventListener('dragend', e => {
    const movedToDropTarget = e.dataTransfer?.dropEffect === 'move';
    const shouldDetach = state.dragTabId === id && !movedToDropTarget && shouldDetachDraggedTab(e);
    const detachToken = shouldDetach ? state.dragTransferToken : null;
    const clearToken = state.dragTransferToken;
    state.dragTabId = null;
    state.dragTransferToken = null;
    state.dragDropHandled = false;
    if (clearToken) mt.ipc.send('clear-live-tab-drag', { token: clearToken });
    tabEl.classList.remove('dragging');
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
    if (shouldDetach && state.workspaces.some(w => w.id === id)) {
      detachTab(id, {
        token: detachToken,
        dropClientX: e.clientX,
        dropClientY: e.clientY,
        dropScreenX: e.screenX,
        dropScreenY: e.screenY
      });
    }
  });
  tabEl.addEventListener('dragover', e => {
    if (state.dragTabId === null && !hasLiveTabDrag(e)) return;
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
    state.dragDropHandled = true;
    tabEl.classList.remove('drag-over-left', 'drag-over-right');
    const rect = tabEl.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const insertBefore = e.clientX < mid;
    if (state.dragTabId === null) {
      const toIdx = getTabIndex(id);
      const insertIndex = toIdx + (insertBefore ? 0 : 1);
      acceptLiveTabDrop(e, insertIndex).catch(err => console.error('Failed to accept live tab drop:', err));
      return;
    }
    if (state.dragTabId === id) return;
    const fromIdx = getTabIndex(state.dragTabId);
    const toIdx = getTabIndex(id);
    if (fromIdx === -1 || toIdx === -1) return;
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
  document.getElementById('tctx-detach').classList.toggle('disabled', !workspace || workspace.panes.length < 1);
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

function captureLiveWorkspace(workspace) {
  return {
    id: workspace.id,
    workspaceBackendId: workspace.workspaceBackendId,
    title: workspace.title,
    cwd: workspace.cwd || null,
    activePaneId: workspace.activePaneId,
    maximizedPaneId: workspace.maximizedPaneId,
    customTitle: workspace._customTitle || null,
    layout: cloneLayout(workspace.layout),
    panes: workspace.panes.map(pane => ({
      id: pane.id,
      paneBackendId: pane.paneBackendId,
      cwd: pane.cwd || workspace.cwd || mt.os.env.HOME,
      autoRender: !!pane.autoRender,
      zoomFactor: pane.zoomFactor ?? 1,
      richVisible: !!pane.richVisible,
      richViewState: captureRichViewLayoutState(pane)
    }))
  };
}

async function detachTab(id, opts = {}) {
  const workspace = state.workspaces.find(w => w.id === id);
  if (!workspace || !workspace.panes.length) return;
  try {
    if (opts.token) {
      const result = await mt.ipc.invoke('open-live-tab-transfer-window', {
        token: opts.token,
        dropClientX: opts.dropClientX,
        dropClientY: opts.dropClientY,
        dropScreenX: opts.dropScreenX,
        dropScreenY: opts.dropScreenY
      });
      if (!result?.ok) throw new Error(result?.error || 'Detach failed');
    } else {
      const result = await mt.ipc.invoke('detach-live-tab', { workspace: captureLiveWorkspace(workspace) });
      if (!result?.ok) throw new Error(result?.error || 'Detach failed');
    }
  } catch (err) {
    console.error('Failed to detach live tab:', err);
    const pane = workspace.panes.find(p => p.id === workspace.activePaneId) || workspace.panes[0];
    try {
      pane?.term?.write(`\r\n\x1b[31mMathTerm could not detach this tab.\x1b[0m\r\n${err?.message || err}\r\n`);
    } catch {}
  }
}

function initTabContextListeners() {
  mt.ipc.on('live-tab-drag-started', payload => {
    const token = String(payload?.token || '');
    if (token && token !== state.dragTransferToken) state.externalDragTransferToken = token;
  });
  mt.ipc.on('live-tab-drag-ended', payload => {
    const token = String(payload?.token || '');
    if (!token || state.externalDragTransferToken === token) state.externalDragTransferToken = null;
  });
  mt.ipc.on('live-tab-transfer-complete', payload => {
    const workspaceId = Number(payload?.workspaceId);
    if (!Number.isInteger(workspaceId)) return;
    closeTab(workspaceId, { killBackend: false });
  });
  state.tabBar.addEventListener('dragover', e => {
    if (!hasLiveTabDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  state.tabBar.addEventListener('drop', e => {
    if (e.target?.closest?.('.tab-item')) return;
    acceptLiveTabDrop(e, state.workspaces.length).catch(err => console.error('Failed to accept live tab drop:', err));
  });
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
  restoreLiveWorkspaceToken,
  switchTab,
  closeTab,
  closePane,
  closeActivePane,
  splitPaneRight,
  splitPaneLeft,
  splitPaneDown,
  splitPaneUp,
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
