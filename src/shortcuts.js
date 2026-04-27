const { isMac, settings, SETTINGS_PATH } = require('./settings');

function buildShortcutSections() {
  const sc = settings.shortcuts || {};
  return [
    { section: 'Tabs', items: [
      { keys: 'Mod+Shift+T', desc: 'New tab' },
      { keys: 'Mod+Shift+W', desc: 'Close tab' },
      { keys: 'Mod+1 … Mod+9', desc: 'Switch to tab N' },
      { keys: 'Mod+PageDown', desc: 'Next tab' },
      { keys: 'Mod+PageUp', desc: 'Previous tab' },
    ]},
    { section: 'Math', items: [
      { id: 'toggleMath', keys: sc.toggleMath, desc: 'Toggle Math mode' },
      { id: 'toggleAutoRender', keys: sc.toggleAutoRender, desc: 'Toggle auto-render LaTeX' },
      { keys: 'Mod+Shift+O', desc: 'Open file in Math mode' },
    ]},
    { section: 'Editing', items: [
      { id: 'copy', keys: sc.copy, desc: 'Copy (in math view)' },
      { id: 'paste', keys: sc.paste, desc: 'Paste (in math view)' },
      { id: 'selectAll', keys: sc.selectAll, desc: 'Select all (in math view)' },
      { id: 'openSearch', keys: sc.openSearch, desc: 'Find' },
    ]},
    { section: 'Navigation', items: [
      { id: 'prevPrompt', keys: sc.prevPrompt, desc: 'Jump to previous prompt' },
      { id: 'nextPrompt', keys: sc.nextPrompt, desc: 'Jump to next prompt' },
      { id: 'selectLastCommand', keys: sc.selectLastCommand, desc: 'Select last command output' },
      { id: 'scrollToCursor', keys: sc.scrollToCursor, desc: 'Scroll to cursor' },
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
}

function formatKeys(keys) {
  if (!keys) return '';
  return keys.replace(/\bMod\b/g, isMac ? '⌘' : 'Ctrl');
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-content');
  if (!container) return;
  container.innerHTML = '';
  for (const group of buildShortcutSections()) {
    const h = document.createElement('h3');
    h.textContent = group.section;
    container.appendChild(h);
    const tbl = document.createElement('table');
    for (const it of group.items) {
      if (!it.keys) continue;
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.className = 'key';
      td1.textContent = formatKeys(it.keys);
      const td2 = document.createElement('td');
      td2.textContent = it.desc;
      if (it.id) {
        const badge = document.createElement('span');
        badge.className = 'bindable-badge';
        badge.textContent = 'bindable';
        td2.appendChild(document.createTextNode(' '));
        td2.appendChild(badge);
      }
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbl.appendChild(tr);
    }
    container.appendChild(tbl);
  }
  const note = document.getElementById('shortcuts-note');
  if (note) note.textContent = `Items marked “bindable” can be customized in ${SETTINGS_PATH} (key shortcuts.<id>). Restart MathTerm to apply.`;
}

function openShortcuts() {
  renderShortcuts();
  document.getElementById('shortcuts-dialog').showModal();
}

function closeShortcuts() {
  document.getElementById('shortcuts-dialog').close();
}

module.exports = { openShortcuts, closeShortcuts };
