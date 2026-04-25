const { isMac } = require('./settings');

const SHORTCUTS = [
  { section: 'Tabs', items: [
    { keys: 'Mod+Shift+T', desc: 'New tab' },
    { keys: 'Mod+Shift+W', desc: 'Close tab' },
    { keys: 'Mod+1 … Mod+9', desc: 'Switch to tab N' },
    { keys: 'Mod+PageDown', desc: 'Next tab' },
    { keys: 'Mod+PageUp', desc: 'Previous tab' },
  ]},
  { section: 'Math', items: [
    { keys: 'Mod+Shift+M', desc: 'Toggle Math mode' },
    { keys: 'Mod+Shift+R', desc: 'Toggle auto-render LaTeX' },
    { keys: 'Mod+Shift+O', desc: 'Open file in Math mode' },
  ]},
  { section: 'Editing', items: [
    { keys: 'Mod+Shift+C', desc: 'Copy' },
    { keys: 'Mod+Shift+V', desc: 'Paste' },
    { keys: 'Mod+Shift+A', desc: 'Select all (in math view)' },
    { keys: 'Mod+Shift+F', desc: 'Find' },
  ]},
  { section: 'Navigation', items: [
    { keys: 'Ctrl+Up', desc: 'Jump to previous prompt' },
    { keys: 'Ctrl+Down', desc: 'Jump to next prompt' },
  ]},
  { section: 'View', items: [
    { keys: 'Mod+=', desc: 'Zoom in' },
    { keys: 'Mod+-', desc: 'Zoom out' },
    { keys: 'Mod+0', desc: 'Reset zoom' },
  ]},
  { section: 'In Math View', items: [
    { keys: 'Esc / q', desc: 'Exit math view' },
    { keys: 'PageDown / Space', desc: 'Scroll page down' },
    { keys: 'PageUp', desc: 'Scroll page up' },
    { keys: 'Home / End', desc: 'Jump to top / bottom' },
    { keys: '↑ / ↓', desc: 'Scroll line up / down' },
  ]},
];

function formatKeys(keys) {
  return keys.replace(/\bMod\b/g, isMac ? '⌘' : 'Ctrl');
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-content');
  if (!container || container.childElementCount > 0) return;
  for (const group of SHORTCUTS) {
    const h = document.createElement('h3');
    h.textContent = group.section;
    container.appendChild(h);
    const tbl = document.createElement('table');
    for (const it of group.items) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.className = 'key';
      td1.textContent = formatKeys(it.keys);
      const td2 = document.createElement('td');
      td2.textContent = it.desc;
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbl.appendChild(tr);
    }
    container.appendChild(tbl);
  }
}

function openShortcuts() {
  renderShortcuts();
  document.getElementById('shortcuts-dialog').showModal();
}

function closeShortcuts() {
  document.getElementById('shortcuts-dialog').close();
}

module.exports = { openShortcuts, closeShortcuts };
