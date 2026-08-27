const mt = window.mathterm;
const { getActivePane } = require('./state');
const { settings, isMac } = require('./settings');
const { parseShortcut, formatShortcut } = require('./keybindings');

function getSelectionText() {
  const tab = getActivePane();
  if (!tab) return '';
  if (tab.richVisible) {
    const sel = window.getSelection();
    return sel ? sel.toString() : '';
  }
  return tab.term.getSelection();
}

function doCopy() {
  const text = getSelectionText();
  if (text) mt.clipboard.writeText(text);
}

function doPaste() {
  const tab = getActivePane();
  if (!tab) return;
  const text = mt.clipboard.readText();
  const search = require('./search');
  if (search.isSearchBarOpen() && search.insertTextIntoSearchInput(text)) return;
  if (tab.richVisible || tab._richSnapshotPending) return;
  if (text) tab.ptyProc.write('\x1b[200~' + text + '\x1b[201~');
}

function doSelectAll() {
  const tab = getActivePane();
  if (!tab) return;
  if (tab._richSnapshotPending) return;
  if (tab.richVisible) {
    const range = document.createRange();
    range.selectNodeContents(tab.richContent);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    tab.term.selectAll();
  }
}

function hasSelection() {
  const tab = getActivePane();
  if (!tab) return false;
  if (tab.richVisible) {
    const sel = window.getSelection();
    return sel && sel.toString().length > 0;
  }
  return tab.term.hasSelection();
}

function showContextMenu(x, y) {
  const tab = getActivePane();
  const state = require('./state').state;
  const copyItem = document.getElementById('ctx-copy');
  if (hasSelection()) copyItem.classList.remove('disabled');
  else copyItem.classList.add('disabled');
  state.contextMenu.style.left = x + 'px';
  state.contextMenu.style.top = y + 'px';
  state.contextMenu.classList.add('open');
}

function hideContextMenu() {
  const state = require('./state').state;
  state.contextMenu.classList.remove('open');
}

function focusActivePaneSurface() {
  const tab = getActivePane();
  if (!tab) return;
  requestAnimationFrame(() => {
    if (tab.richVisible) tab.richView?.focus();
    else tab.term?.focus();
  });
}

function setContextShortcutLabel(id, shortcut) {
  const el = document.querySelector(`#${id} .shortcut`);
  if (!el) return;
  el.textContent = formatShortcut(parseShortcut(shortcut), isMac);
}

function updateContextShortcutLabels() {
  const sc = settings.shortcuts || {};
  setContextShortcutLabel('ctx-copy', sc.copy);
  setContextShortcutLabel('ctx-paste', sc.paste);
  setContextShortcutLabel('ctx-search', sc.openSearch);
}

function initClipboardListeners() {
  const state = require('./state').state;
  updateContextShortcutLabels();
  document.getElementById('ctx-copy').addEventListener('click', () => { doCopy(); hideContextMenu(); focusActivePaneSurface(); });
  document.getElementById('ctx-paste').addEventListener('click', () => { doPaste(); hideContextMenu(); focusActivePaneSurface(); });
  document.getElementById('ctx-selectall').addEventListener('click', () => { doSelectAll(); hideContextMenu(); focusActivePaneSurface(); });
  document.getElementById('ctx-search').addEventListener('click', () => {
    const { openSearch } = require('./search');
    openSearch(); hideContextMenu();
  });
  state.termContainer.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  document.addEventListener('click', e => {
    if (!state.contextMenu.contains(e.target)) hideContextMenu();
  });

  document.addEventListener('mouseup', () => {
    if (!settings.copyOnSelect) return;
    const tab = getActivePane();
    if (!tab || !tab.richVisible) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      mt.clipboard.writeText(sel.toString());
    }
  });
}

module.exports = { doCopy, doPaste, doSelectAll, showContextMenu, hideContextMenu, initClipboardListeners };
