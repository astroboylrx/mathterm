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
  return !!(pane && pane.richVisible
    && ((pane.richVirtual && pane.richVirtual.active) || pane.richSearchSource));
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
  const source = tab && tab.richSearchSource;
  const buf = tab && tab.term && tab.term.buffer && tab.term.buffer.active;
  if (source && source.type === 'file') return source.lines || [];
  const startY = v && v.active ? v.sourceStartY : source && source.sourceStartY;
  const endY = v && v.active ? v.sourceEndY : source && source.sourceEndY;
  if (!buf || startY == null || endY == null) return [];
  const lines = [];
  for (let y = startY; y <= endY; y++) {
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
  for (const el of Array.from(root.querySelectorAll('.rich-search-cell-match, .rich-search-cell-active, .rich-search-generated-match, .rich-search-generated-active'))) {
    el.classList.remove(
      'rich-search-cell-match',
      'rich-search-cell-active',
      'rich-search-generated-match',
      'rich-search-generated-active'
    );
  }
}

function sourceLineText(tab, y) {
  const source = tab && tab.richSearchSource;
  if (source && source.type === 'file') {
    const line = (source.lines || [])[y];
    return line ? line.text : '';
  }
  try {
    const line = tab.term.buffer.active.getLine(y);
    return line ? line.translateToString(true) : '';
  } catch {
    return '';
  }
}

function wrapTextRange(root, start, length, active) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
  return el.textContent === sourceLineText(tab, match.y);
}

function findTableCellForMatch(el, match) {
  if (!el || !el.querySelector || !el.querySelector('td, th')) return null;
  const cells = Array.from(el.querySelectorAll('td[data-source-y], th[data-source-y]'));
  for (const cell of cells) {
    const yStart = parseInt(cell.dataset.sourceY);
    const yEnd = parseInt(cell.dataset.sourceYEnd || cell.dataset.sourceY);
    const colStart = parseInt(cell.dataset.sourceStartCol);
    const colEnd = parseInt(cell.dataset.sourceEndCol);
    if ([yStart, yEnd, colStart, colEnd].some(Number.isNaN)) continue;
    const matchEnd = match.col + match.length;
    if (match.y >= yStart && match.y <= yEnd && match.col >= colStart && matchEnd <= colEnd) {
      return cell;
    }
  }
  return null;
}

function highlightTableCell(cell, match, active) {
  cell.classList.add('rich-search-cell-match');
  if (active) cell.classList.add('rich-search-cell-active');
  const sourceText = cell.dataset.sourceText || '';
  if (!sourceText || cell.textContent !== sourceText) return false;
  const sourceStart = parseInt(cell.dataset.sourceStartCol);
  if (Number.isNaN(sourceStart)) return false;
  wrapTextRange(cell, match.col - sourceStart, match.length, active);
  return true;
}

function markGeneratedFallback(el, active) {
  if (!el) return;
  if (el.classList.contains('display-math') || el.querySelector?.('.katex')) {
    el.classList.add('rich-search-generated-match');
    if (active) el.classList.add('rich-search-generated-active');
  }
}

function renderRichSearchHighlights(tab = getActivePane(), opts = {}) {
  if (!tab || !tab.richContent) return;
  const v = tab.richVirtual;
  if (opts.renderToken != null && (!v || String(v.renderToken) !== String(opts.renderToken))) return;
  clearRichSearchHighlights(tab);
  if (!isRichSearchMode(tab) || !tab.richSearchOpen || !tab.richSearchQuery) return;

  const matches = tab.richSearchMatches || [];
  if (!matches.length) return;
  const { findElementForY } = require('./richView');
  const root = v && v.active && v.windowEl ? v.windowEl : tab.richContent;
  const source = tab.richSearchSource;
  const startY = v && v.active
    ? (v.expandedStartY != null ? v.expandedStartY : v.renderedStartY)
    : source && source.sourceStartY;
  const endY = v && v.active
    ? (v.expandedEndY != null ? v.expandedEndY : v.renderedEndY)
    : source && source.sourceEndY;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (startY != null && endY != null && (match.y < startY || match.y > endY)) continue;
    const el = findElementForY(root, match.y);
    if (!el) continue;
    const active = i === tab.richSearchIndex;
    const tableCell = findTableCellForMatch(el, match);
    if (tableCell) {
      highlightTableCell(tableCell, match, active);
      continue;
    }
    el.classList.add('rich-search-row-match');
    if (active) el.classList.add('rich-search-row-active');
    if (canInlineHighlight(tab, el, match)) {
      wrapTextRange(el, match.col, match.length, active);
    } else {
      markGeneratedFallback(el, active);
    }
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
