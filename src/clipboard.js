const mt = window.mathterm;
const { getActiveTab } = require('./state');
const { settings } = require('./settings');

function doCopy() {
  const tab = getActiveTab();
  if (!tab) return;
  const sel = tab.term.getSelection();
  if (sel) mt.clipboard.writeText(sel);
}

function doPaste() {
  const tab = getActiveTab();
  if (!tab) return;
  const text = mt.clipboard.readText();
  if (text) tab.ptyProc.write('\x1b[200~' + text + '\x1b[201~');
}

function doSelectAll() {
  const tab = getActiveTab();
  if (tab) tab.term.selectAll();
}

function showContextMenu(x, y) {
  const tab = getActiveTab();
  const state = require('./state').state;
  const hasSel = tab && tab.term.hasSelection();
  const copyItem = document.getElementById('ctx-copy');
  if (hasSel) copyItem.classList.remove('disabled');
  else copyItem.classList.add('disabled');
  state.contextMenu.style.left = x + 'px';
  state.contextMenu.style.top = y + 'px';
  state.contextMenu.classList.add('open');
}

function hideContextMenu() {
  const state = require('./state').state;
  state.contextMenu.classList.remove('open');
}

function initClipboardListeners() {
  const state = require('./state').state;
  document.getElementById('ctx-copy').addEventListener('click', () => { doCopy(); hideContextMenu(); });
  document.getElementById('ctx-paste').addEventListener('click', () => { doPaste(); hideContextMenu(); });
  document.getElementById('ctx-selectall').addEventListener('click', () => { doSelectAll(); hideContextMenu(); });
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
}

module.exports = { doCopy, doPaste, doSelectAll, showContextMenu, hideContextMenu, initClipboardListeners };
