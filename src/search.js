const { state, getActiveTab } = require('./state');

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

function saveSearchState(tab = getActiveTab()) {
  if (!tab || !state.searchInput || !state.searchCount) return;
  tab.searchOpen = state.searchBar.classList.contains('open');
  tab.searchQuery = state.searchInput.value;
  tab.searchCountText = state.searchCount.textContent || '';
}

function hydrateSearchBar(tab = getActiveTab(), { focus = false, refresh = false } = {}) {
  if (!state.searchBar || !state.searchInput || !state.searchCount) return;
  if (!tab || !tab.searchOpen) {
    state.searchBar.classList.remove('open');
    state.searchInput.value = '';
    state.searchCount.textContent = '';
    return;
  }

  state.searchInput.value = tab.searchQuery || '';
  state.searchCount.textContent = tab.searchCountText || '';
  state.searchBar.classList.add('open');
  renderSearchHighlights(tab);
  if (refresh && tab.searchQuery) runSearch(tab, 'next', { incremental: true });
  if (focus) {
    state.searchInput.focus();
    state.searchInput.select();
  }
}

function openSearch() {
  const tab = getActiveTab();
  if (!tab) return;
  const { tabHideRichView } = require('./richView');
  if (tab.richVisible) tabHideRichView(tab);
  tab.searchOpen = true;
  hydrateSearchBar(tab, { focus: true, refresh: true });
  state.searchInput.focus();
  state.searchInput.select();
}

function closeSearch() {
  const tab = getActiveTab();
  if (tab) {
    tab.searchOpen = false;
    tab.searchQuery = state.searchInput.value;
    tab.searchCountText = '';
    tab.searchMatches = [];
    tab.activeSearchIndex = -1;
    tab.searchAddon.clearDecorations();
    tab.term.clearSelection();
    renderSearchHighlights(tab);
    tab.term.focus();
  }
  state.searchBar.classList.remove('open');
  state.searchCount.textContent = '';
}

function doSearchNext() {
  const tab = getActiveTab();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  tab.searchQuery = q;
  runSearch(tab, 'next', { incremental: true });
}

function doSearchPrev() {
  const tab = getActiveTab();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  tab.searchQuery = q;
  runSearch(tab, 'previous');
}

function initSearchListeners() {
  state.searchInput.addEventListener('input', () => {
    const tab = getActiveTab();
    if (!tab) return;
    const q = state.searchInput.value;
    tab.searchOpen = true;
    tab.searchQuery = q;
    tab.searchCountText = state.searchCount.textContent || '';
    if (!q) {
      tab.searchAddon.clearDecorations();
      tab.term.clearSelection();
      tab.searchMatches = [];
      tab.activeSearchIndex = -1;
      state.searchCount.textContent = '';
      tab.searchCountText = '';
      renderSearchHighlights(tab);
      return;
    }
    runSearch(tab, 'next', { incremental: true });
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

function updateSearchResults(tab) {
  const matches = collectMatches(tab);
  tab.searchMatches = matches;
  const active = activeMatchIndex(tab, matches);
  tab.activeSearchIndex = active;
  tab.searchCountText = matches.length ? `${active >= 0 ? active + 1 : '?'}/${matches.length}` : '0/0';
  if (tab.id === state.activeTabId && state.searchCount) {
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

function renderSearchHighlights(tab = getActiveTab()) {
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
  if (tab.id === state.activeTabId && state.searchCount) state.searchCount.textContent = tab.searchCountText;

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

module.exports = {
  openSearch,
  closeSearch,
  doSearchNext,
  doSearchPrev,
  initSearchListeners,
  saveSearchState,
  hydrateSearchBar,
  attachSearchResultListener,
  renderSearchHighlights,
};
