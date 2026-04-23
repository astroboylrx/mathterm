const { state, getActiveTab } = require('./state');

function openSearch() {
  const tab = getActiveTab();
  if (!tab) return;
  const { tabHideRichView } = require('./richView');
  if (tab.richVisible) tabHideRichView(tab);
  state.searchBar.classList.add('open');
  state.searchInput.focus();
  state.searchInput.select();
}

function closeSearch() {
  state.searchBar.classList.remove('open');
  state.searchCount.textContent = '';
  const tab = getActiveTab();
  if (tab) {
    tab.searchAddon.clearDecorations();
    tab.term.focus();
  }
}

function doSearchNext() {
  const tab = getActiveTab();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  tab.searchAddon.findNext(q, { incremental: true });
}

function doSearchPrev() {
  const tab = getActiveTab();
  if (!tab) return;
  const q = state.searchInput.value;
  if (!q) return;
  tab.searchAddon.findPrevious(q);
}

function initSearchListeners() {
  state.searchInput.addEventListener('input', () => {
    const tab = getActiveTab();
    if (!tab) return;
    const q = state.searchInput.value;
    if (!q) { tab.searchAddon.clearDecorations(); state.searchCount.textContent = ''; return; }
    tab.searchAddon.findNext(q, { incremental: true });
  });

  state.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSearchNext(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    e.stopPropagation();
  });
}

module.exports = { openSearch, closeSearch, doSearchNext, doSearchPrev, initSearchListeners };
