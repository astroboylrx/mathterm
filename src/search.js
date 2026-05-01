const { state, getActivePane, isActivePane } = require('./state');
const { settings } = require('./settings');
const { collectRichSearchMatches } = require('./mathSearch');

const TERMINAL_SEARCH_PLACEHOLDER = 'Search terminal...';
const RICH_SEARCH_PLACEHOLDER = 'Search math view...';

function isSearchBarOpen() {
  return !!(state.searchBar && state.searchBar.classList.contains('open'));
}

function isPasteShortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  return mod && !e.altKey && String(e.key || '').toLowerCase() === 'v';
}

function isEventInSearchBar(e) {
  return !!(state.searchBar && e.target && state.searchBar.contains(e.target));
}

function isRichSearchMode(pane) {
  return !!(pane && pane.richVisible && pane.richVirtual && pane.richVirtual.active);
}

function attachSearchBarToPane(tab = getActivePane()) {
  if (!state.searchBar || !tab?.leafEl) return;
  if (state.searchBar.parentNode !== tab.leafEl) {
    tab.leafEl.appendChild(state.searchBar);
  }
}

function attachSearchResultListener(tab) {
  if (!tab || !tab.term) return;
  const disposables = [
    tab.term.onScroll(() => renderSearchHighlights(tab)),
    tab.term.onRender(() => renderSearchHighlights(tab)),
  ];
  tab._searchResultDisposable = {
    dispose() {
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
    }
  };
}

function insertTextIntoSearchInput(text) {
  if (!isSearchBarOpen() || !state.searchInput || !text) return false;
  const input = state.searchInput;
  input.focus();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const next = start + text.length;
  input.setSelectionRange(next, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function saveSearchState(tab = getActivePane()) {
  if (!tab || !state.searchInput || !state.searchCount) return;
  if (isRichSearchMode(tab)) {
    tab.richSearchOpen = state.searchBar.classList.contains('open');
    tab.richSearchQuery = state.searchInput.value;
    tab.richSearchCountText = state.searchCount.textContent || '';
  } else {
    tab.searchOpen = state.searchBar.classList.contains('open');
    tab.searchQuery = state.searchInput.value;
    tab.searchCountText = state.searchCount.textContent || '';
  }
}

function hydrateSearchBar(tab = getActivePane(), { focus = false, refresh = false } = {}) {
  if (!state.searchBar || !state.searchInput || !state.searchCount) return;
  attachSearchBarToPane(tab);
  const richMode = isRichSearchMode(tab);
  state.searchInput.placeholder = richMode ? RICH_SEARCH_PLACEHOLDER : TERMINAL_SEARCH_PLACEHOLDER;
  const isOpen = richMode ? tab.richSearchOpen : tab && tab.searchOpen;
  if (!tab || !isOpen) {
    state.searchBar.classList.remove('open');
    state.searchInput.value = '';
    state.searchCount.textContent = '';
    if (richMode) renderRichSearchHighlights(tab);
    else renderSearchHighlights(tab);
    return;
  }

  state.searchInput.value = richMode ? (tab.richSearchQuery || '') : (tab.searchQuery || '');
  state.searchCount.textContent = richMode ? (tab.richSearchCountText || '') : (tab.searchCountText || '');
  state.searchBar.classList.add('open');
  if (richMode) {
    renderRichSearchHighlights(tab);
    if (refresh && tab.richSearchQuery) runRichSearch(tab, 'next', { incremental: true });
  } else {
    renderSearchHighlights(tab);
    if (refresh && tab.searchQuery) runSearch(tab, 'next', { incremental: true });
  }
  if (focus) {
    state.searchInput.focus();
    state.searchInput.select();
  }
}

function openSearch() {
  const tab = getActivePane();
  if (!tab) return;
  attachSearchBarToPane(tab);
  if (isRichSearchMode(tab)) {
    tab.richSearchOpen = true;
    hydrateSearchBar(tab, { focus: true, refresh: true });
    state.searchInput.focus();
    state.searchInput.select();
    return;
  }
  if (tab.richVisible) {
    const { tabHideRichView } = require('./richView');
    tabHideRichView(tab);
  }
  tab.searchOpen = true;
  hydrateSearchBar(tab, { focus: true, refresh: true });
  state.searchInput.focus();
  state.searchInput.select();
}

function closeSearch() {
  const tab = getActivePane();
  if (tab) {
    attachSearchBarToPane(tab);
    if (isRichSearchMode(tab)) {
      tab.richSearchOpen = false;
      tab.richSearchQuery = state.searchInput.value;
      tab.richSearchCountText = '';
      tab.richSearchMatches = [];
      tab.richSearchIndex = -1;
      renderRichSearchHighlights(tab);
      tab.richView?.focus();
    } else {
      tab.searchOpen = false;
      tab.searchQuery = state.searchInput.value;
      tab.searchCountText = '';
      tab.searchMatches = [];
      tab.activeSearchIndex = -1;
      tab.searchAddon?.clearDecorations();
      tab.term?.clearSelection();
      renderSearchHighlights(tab);
      tab.term?.focus();
    }
  }
  state.searchBar.classList.remove('open');
  state.searchCount.textContent = '';
}

function doSearchNext() {
  const tab = getActivePane();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  if (isRichSearchMode(tab)) {
    tab.richSearchQuery = q;
    runRichSearch(tab, 'next');
  } else {
    tab.searchQuery = q;
    runSearch(tab, 'next', { incremental: true });
  }
}

function doSearchPrev() {
  const tab = getActivePane();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  if (isRichSearchMode(tab)) {
    tab.richSearchQuery = q;
    runRichSearch(tab, 'previous');
  } else {
    tab.searchQuery = q;
    runSearch(tab, 'previous');
  }
}

function initSearchListeners() {
  document.addEventListener('keydown', e => {
    if (!isSearchBarOpen() || isEventInSearchBar(e)) return;
    const tab = getActivePane();
    if (!tab) return;
    const searchOwnedByPane = isRichSearchMode(tab) ? tab.richSearchOpen : tab.searchOpen;
    if (!searchOwnedByPane) return;
    e.preventDefault();
    e.stopPropagation();
    state.searchInput.focus();

    const input = state.searchInput;
    if (isPasteShortcut(e)) {
      const text = window.mathterm?.clipboard?.readText?.() || '';
      insertTextIntoSearchInput(text);
      return;
    }
    if (e.key === 'Escape') {
      closeSearch();
      return;
    }
    if (e.key === 'Enter') {
      doSearchNext();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      let nextStart = start;
      if (start !== end) {
        input.value = input.value.slice(0, start) + input.value.slice(end);
      } else if (e.key === 'Backspace' && start > 0) {
        input.value = input.value.slice(0, start - 1) + input.value.slice(end);
        nextStart = start - 1;
      } else if (e.key === 'Delete' && start < input.value.length) {
        input.value = input.value.slice(0, start) + input.value.slice(start + 1);
      }
      input.setSelectionRange(nextStart, nextStart);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const pos = input.selectionStart ?? input.value.length;
      const next = e.key === 'ArrowLeft' ? Math.max(0, pos - 1) : Math.min(input.value.length, pos + 1);
      input.setSelectionRange(next, next);
      return;
    }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + e.key + input.value.slice(end);
      input.setSelectionRange(start + e.key.length, start + e.key.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  document.addEventListener('paste', e => {
    if (!isSearchBarOpen() || isEventInSearchBar(e)) return;
    const tab = getActivePane();
    if (!tab) return;
    const searchOwnedByPane = isRichSearchMode(tab) ? tab.richSearchOpen : tab.searchOpen;
    if (!searchOwnedByPane) return;
    const text = e.clipboardData?.getData('text/plain')
      || window.mathterm?.clipboard?.readText?.()
      || '';
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    insertTextIntoSearchInput(text);
  }, true);

  state.searchInput.addEventListener('input', () => {
    const tab = getActivePane();
    if (!tab) return;
    const q = state.searchInput.value;
    if (isRichSearchMode(tab)) {
      tab.richSearchOpen = true;
      tab.richSearchQuery = q;
      tab.richSearchCountText = state.searchCount.textContent || '';
      if (!q) {
        tab.richSearchMatches = [];
        tab.richSearchIndex = -1;
        state.searchCount.textContent = '';
        tab.richSearchCountText = '';
        renderRichSearchHighlights(tab);
        return;
      }
      runRichSearch(tab, 'next', { incremental: true });
    } else {
      tab.searchOpen = true;
      tab.searchQuery = q;
      tab.searchCountText = state.searchCount.textContent || '';
      if (!q) {
        tab.searchAddon?.clearDecorations();
        tab.term?.clearSelection();
        tab.searchMatches = [];
        tab.activeSearchIndex = -1;
        state.searchCount.textContent = '';
        tab.searchCountText = '';
        renderSearchHighlights(tab);
        return;
      }
      runSearch(tab, 'next', { incremental: true });
    }
  });

  state.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSearchNext(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    e.stopPropagation();
  });
}

function runSearch(tab, direction, options = {}) {
  if (!tab || !tab.searchQuery) return false;
  const found = direction === 'previous'
    ? tab.searchAddon.findPrevious(tab.searchQuery)
    : tab.searchAddon.findNext(tab.searchQuery, options);
  updateSearchResults(tab);
  renderSearchHighlights(tab);
  return found;
}

function collectRichLines(tab) {
  const v = tab && tab.richVirtual;
  const buf = tab && tab.term && tab.term.buffer && tab.term.buffer.active;
  if (!v || !v.active || !buf) return [];
  const lines = [];
  for (let y = v.sourceStartY; y <= v.sourceEndY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { line = null; }
    if (!line) continue;
    lines.push({ y, text: line.translateToString(true) });
  }
  return lines;
}

function runRichSearch(tab, direction, options = {}) {
  if (!tab || !tab.richSearchQuery || !isRichSearchMode(tab)) return false;
  const matches = collectRichSearchMatches(collectRichLines(tab), tab.richSearchQuery, {
    mathSymbolSearch: settings.mathSymbolSearch,
    normalizeCache: tab.richSearchNormalizeCache
  });
  tab.richSearchMatches = matches;

  if (!matches.length) {
    tab.richSearchIndex = -1;
    tab.richSearchCountText = '0/0';
    if (isActivePane(tab) && state.searchCount) state.searchCount.textContent = tab.richSearchCountText;
    renderRichSearchHighlights(tab);
    return false;
  }

  if (options.incremental || tab.richSearchIndex < 0 || tab.richSearchIndex >= matches.length) {
    tab.richSearchIndex = 0;
  } else if (direction === 'previous') {
    tab.richSearchIndex = (tab.richSearchIndex - 1 + matches.length) % matches.length;
  } else {
    tab.richSearchIndex = (tab.richSearchIndex + 1) % matches.length;
  }

  updateRichSearchCount(tab);
  const active = matches[tab.richSearchIndex];
  if (active) {
    const { scrollRichViewToSourceRow } = require('./richView');
    scrollRichViewToSourceRow(tab, active.y);
  } else {
    renderRichSearchHighlights(tab);
  }
  return true;
}

function updateRichSearchCount(tab) {
  const total = tab.richSearchMatches ? tab.richSearchMatches.length : 0;
  tab.richSearchCountText = total ? `${tab.richSearchIndex + 1}/${total}` : '0/0';
  if (isActivePane(tab) && state.searchCount) state.searchCount.textContent = tab.richSearchCountText;
}

function updateSearchResults(tab) {
  const matches = collectMatches(tab);
  tab.searchMatches = matches;
  const active = activeMatchIndex(tab, matches);
  tab.activeSearchIndex = active;
  tab.searchCountText = matches.length ? `${active >= 0 ? active + 1 : '?'}/${matches.length}` : '0/0';
  if (isActivePane(tab) && state.searchCount) {
    state.searchCount.textContent = tab.searchCountText;
  }
}

function collectMatches(tab) {
  const term = tab.term;
  const query = tab.searchQuery || '';
  if (!term || !query) return [];

  const needle = query.toLowerCase();
  const buffer = term.buffer.active;
  const end = buffer.length || (buffer.baseY + term.rows);
  const matches = [];

  for (let row = 0; row < end; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const text = line.translateToString(true);
    const haystack = text.toLowerCase();
    let col = 0;
    while (col <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, col);
      if (found === -1) break;
      matches.push({ row, col: found, length: query.length });
      col = found + Math.max(1, needle.length);
    }
  }

  return matches;
}

function activeMatchIndex(tab, matches) {
  const pos = tab.term.getSelectionPosition?.();
  if (!pos || !pos.start) return matches.length ? 0 : -1;
  const idx = matches.findIndex(m => m.row === pos.start.y && m.col === pos.start.x);
  return idx === -1 && matches.length ? 0 : idx;
}

function renderSearchHighlights(tab = getActivePane()) {
  if (!tab || !tab.searchHighlightLayer) return;
  const layer = tab.searchHighlightLayer;
  layer.replaceChildren();
  if (!tab.searchOpen || !tab.searchQuery) return;

  const matches = tab.searchMatches && tab.searchMatches.length ? tab.searchMatches : collectMatches(tab);
  tab.searchMatches = matches;
  if (!matches.length) return;

  const screen = tab.term.element && tab.term.element.querySelector('.xterm-screen');
  if (!screen || !tab.xtermHolder) return;
  const holderRect = tab.xtermHolder.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  if (!holderRect.width || !holderRect.height || !screenRect.width || !screenRect.height) return;

  const buffer = tab.term.buffer.active;
  const viewportY = typeof buffer.viewportY === 'number' ? buffer.viewportY : buffer.baseY;
  const cellWidth = screenRect.width / Math.max(1, tab.term.cols);
  const cellHeight = screenRect.height / Math.max(1, tab.term.rows);
  const active = activeMatchIndex(tab, matches);
  tab.activeSearchIndex = active;
  tab.searchCountText = matches.length ? `${active >= 0 ? active + 1 : '?'}/${matches.length}` : '0/0';
  if (isActivePane(tab) && state.searchCount) state.searchCount.textContent = tab.searchCountText;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const row = match.row - viewportY;
    if (row < 0 || row >= tab.term.rows) continue;
    const el = document.createElement('div');
    el.className = 'search-match-highlight' + (i === active ? ' active' : '');
    el.style.left = `${screenRect.left - holderRect.left + match.col * cellWidth}px`;
    el.style.top = `${screenRect.top - holderRect.top + row * cellHeight}px`;
    el.style.width = `${Math.max(cellWidth, match.length * cellWidth)}px`;
    el.style.height = `${cellHeight}px`;
    layer.appendChild(el);
  }
}

function clearRichSearchHighlights(tab = getActivePane()) {
  const root = tab && tab.richContent;
  if (!root) return;
  for (const mark of Array.from(root.querySelectorAll('.rich-search-mark'))) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    if (parent) parent.normalize();
  }
  for (const el of Array.from(root.querySelectorAll('.rich-search-row-match, .rich-search-row-active'))) {
    el.classList.remove('rich-search-row-match', 'rich-search-row-active');
  }
}

function rawSourceLine(tab, y) {
  try {
    const line = tab.term.buffer.active.getLine(y);
    return line ? line.translateToString(true) : '';
  } catch {
    return '';
  }
}

function wrapTextRange(root, start, length, active) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement && node.parentElement.closest('.rich-search-mark')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    const nodeStart = offset;
    const nodeEnd = offset + node.nodeValue.length;
    if (nodeEnd > start && nodeStart < start + length) {
      nodes.push({
        node,
        start: Math.max(0, start - nodeStart),
        end: Math.min(node.nodeValue.length, start + length - nodeStart)
      });
    }
    offset = nodeEnd;
  }

  for (let i = nodes.length - 1; i >= 0; i--) {
    const part = nodes[i];
    const textNode = part.node;
    const text = textNode.nodeValue;
    const before = text.slice(0, part.start);
    const middle = text.slice(part.start, part.end);
    const after = text.slice(part.end);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    if (middle) {
      const mark = document.createElement('span');
      mark.className = 'rich-search-mark' + (active ? ' active' : '');
      mark.textContent = middle;
      frag.appendChild(mark);
    }
    if (after) frag.appendChild(document.createTextNode(after));
    textNode.replaceWith(frag);
  }
}

function canInlineHighlight(tab, el, match) {
  if (!el || !el.classList.contains('rline')) return false;
  const yStart = parseInt(el.dataset.y);
  const yEnd = parseInt(el.dataset.yEnd || el.dataset.y);
  if (yStart !== match.y || yEnd !== match.y) return false;
  return el.textContent === rawSourceLine(tab, match.y);
}

function renderRichSearchHighlights(tab = getActivePane(), opts = {}) {
  if (!tab || !tab.richContent) return;
  const v = tab.richVirtual;
  if (opts.renderToken != null && (!v || String(v.renderToken) !== String(opts.renderToken))) return;
  clearRichSearchHighlights(tab);
  if (!isRichSearchMode(tab) || !tab.richSearchOpen || !tab.richSearchQuery) return;

  const matches = tab.richSearchMatches || [];
  if (!matches.length || !v || !v.windowEl) return;
  const { findElementForY } = require('./richView');
  const startY = v.expandedStartY != null ? v.expandedStartY : v.renderedStartY;
  const endY = v.expandedEndY != null ? v.expandedEndY : v.renderedEndY;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (startY != null && endY != null && (match.y < startY || match.y > endY)) continue;
    const el = findElementForY(v.windowEl, match.y);
    if (!el) continue;
    const active = i === tab.richSearchIndex;
    el.classList.add('rich-search-row-match');
    if (active) el.classList.add('rich-search-row-active');
    if (canInlineHighlight(tab, el, match)) wrapTextRange(el, match.col, match.length, active);
  }
}

module.exports = {
  openSearch,
  closeSearch,
  doSearchNext,
  doSearchPrev,
  initSearchListeners,
  saveSearchState,
  hydrateSearchBar,
  attachSearchBarToPane,
  attachSearchResultListener,
  renderSearchHighlights,
  renderRichSearchHighlights,
  clearRichSearchHighlights,
  isRichSearchMode,
  insertTextIntoSearchInput,
  isSearchBarOpen,
};
