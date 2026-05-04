const mt = window.mathterm;
const {
  DEFAULTS,
  SETTINGS_PATH,
  configHome,
  isMac,
  loadSettings,
  saveSettingsFile,
  mergeIncoming,
} = require('./settingsStore');
const { loadUserThemes, getThemeList, resolveTheme, applyTheme } = require('./themes');

loadUserThemes();

let settings = loadSettings();
let activeTab = new URLSearchParams(window.location.search).get('tab') || 'settings';

function $(id) { return document.getElementById(id); }

function setActiveTab(tab) {
  activeTab = tab === 'shortcuts' ? 'shortcuts' : 'settings';
  $('tab-settings').classList.toggle('active', activeTab === 'settings');
  $('tab-shortcuts').classList.toggle('active', activeTab === 'shortcuts');
  $('settings-panel').classList.toggle('active', activeTab === 'settings');
  $('shortcuts-panel').classList.toggle('active', activeTab === 'shortcuts');
}

function updateThemePreview(themeId) {
  const c = resolveTheme(themeId);
  const el = $('theme-preview');
  el.innerHTML = '';
  for (const key of ['bg', 'fg', 'accent', 'red', 'yellow', 'blue', 'purple', 'cyan', 'orange']) {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c[key];
    sw.title = `${key}: ${c[key]}`;
    el.appendChild(sw);
  }
}

function hydrateThemes() {
  const sel = $('theme');
  sel.innerHTML = '';
  for (const t of getThemeList()) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + (t.builtin ? '' : ' (custom)');
    if (t.id === settings.theme) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    updateThemePreview(sel.value);
    applyTheme(sel.value);
  };
}

function fillForm() {
  hydrateThemes();
  document.documentElement.style.setProperty('--ui-font-size', settings.fontSize + 'px');
  document.documentElement.style.setProperty('--ui-font-family', settings.fontFamily || DEFAULTS.fontFamily);
  $('scrollback').value = settings.scrollback;
  $('fontSize').value = settings.fontSize;
  $('fontFamily').value = settings.fontFamily;
  $('autoRender').checked = !!settings.autoRender;
  $('autoRenderDelay').value = settings.autoRenderDelay;
  $('mathSymbolSearch').checked = !!settings.mathSymbolSearch;
  $('cursorStyle').value = settings.cursorStyle;
  $('inheritCwd').checked = !!settings.inheritCwd;
  $('restoreLastSession').checked = !!settings.restoreLastSession;
  $('copyOnSelect').checked = !!settings.copyOnSelect;
  $('backgroundCommandMarker').checked = !!settings.backgroundCommandMarker;
  $('backgroundCommandNotifications').checked = !!settings.backgroundCommandNotifications;
  $('quit-last-tab-row').style.display = isMac ? 'flex' : 'none';
  $('quitWhenLastTabClosed').checked = !!settings.quitWhenLastTabClosed;
  $('latexMacros').value = settings.latexMacros || '';
  $('config-path').textContent = `Config: ${SETTINGS_PATH}. Custom themes: ${mt.path.join(configHome, 'mathterm', 'themes')}.`;
  applyTheme(settings.theme);
  updateThemePreview(settings.theme);
}

function collectForm() {
  return mergeIncoming({
    ...settings,
    theme: $('theme').value || DEFAULTS.theme,
    scrollback: parseInt($('scrollback').value, 10) || DEFAULTS.scrollback,
    fontSize: parseInt($('fontSize').value, 10) || DEFAULTS.fontSize,
    fontFamily: $('fontFamily').value || DEFAULTS.fontFamily,
    autoRender: $('autoRender').checked,
    autoRenderDelay: parseInt($('autoRenderDelay').value, 10) || DEFAULTS.autoRenderDelay,
    mathSymbolSearch: $('mathSymbolSearch').checked,
    cursorStyle: ['block', 'bar', 'underline'].includes($('cursorStyle').value)
      ? $('cursorStyle').value : DEFAULTS.cursorStyle,
    inheritCwd: $('inheritCwd').checked,
    restoreLastSession: $('restoreLastSession').checked,
    copyOnSelect: $('copyOnSelect').checked,
    backgroundCommandMarker: $('backgroundCommandMarker').checked,
    backgroundCommandNotifications: $('backgroundCommandNotifications').checked,
    quitWhenLastTabClosed: isMac ? $('quitWhenLastTabClosed').checked : false,
    latexMacros: $('latexMacros').value || '',
  });
}

function shortcutSections() {
  const sc = settings.shortcuts || {};
  return [
    { section: 'Tabs', items: [
      { keys: isMac ? 'Mod+N' : 'Mod+Shift+N', desc: 'New window' },
      { keys: isMac ? 'Mod+T' : 'Mod+Shift+T', desc: 'New tab' },
      { keys: 'Mod+1 ... Mod+9', desc: 'Switch to tab N' },
      { keys: isMac ? 'Mod+Shift+]' : 'Mod+PageDown', desc: 'Next tab' },
      { keys: isMac ? 'Mod+Shift+[' : 'Mod+PageUp', desc: 'Previous tab' },
    ]},
    { section: 'Math', items: [
      { id: 'toggleMath', keys: sc.toggleMath, desc: 'Toggle Math mode' },
      { id: 'toggleAutoRender', keys: sc.toggleAutoRender, desc: 'Toggle auto-render LaTeX' },
      { keys: 'Mod+Shift+O', desc: 'Open file in Math mode' },
    ]},
    { section: 'Editing', items: [
      { id: 'copy', keys: sc.copy, desc: 'Copy' },
      { id: 'paste', keys: sc.paste, desc: 'Paste' },
      { id: 'selectAll', keys: sc.selectAll, desc: 'Select all' },
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
    { section: 'Panes', items: [
      { id: 'splitPaneRight', keys: sc.splitPaneRight, desc: 'Split pane right' },
      { id: 'splitPaneDown', keys: sc.splitPaneDown, desc: 'Split pane down' },
      { id: 'closePane', keys: sc.closePane, desc: 'Close active pane' },
      { id: 'togglePaneMaximize', keys: sc.togglePaneMaximize, desc: 'Maximize or restore active pane' },
      { id: 'nextPane', keys: sc.nextPane, desc: 'Next pane' },
      { id: 'prevPane', keys: sc.prevPane, desc: 'Previous pane' },
      { keys: isMac ? 'Mod+Option+Arrow' : 'Alt+Arrow', desc: 'Focus pane by direction' },
    ]},
    { section: 'In Math View', items: [
      { keys: 'Esc / q', desc: 'Exit math view' },
      { keys: 'PageDown / Space', desc: 'Scroll page down' },
      { keys: 'PageUp', desc: 'Scroll page up' },
      { keys: 'Home / End', desc: 'Jump to top / bottom' },
      { keys: 'Up / Down', desc: 'Scroll line up / down' },
    ]},
  ];
}

function formatKeys(keys) {
  if (!keys) return '';
  return keys.replace(/\bMod\b/g, isMac ? 'Cmd' : 'Ctrl');
}

function renderShortcuts() {
  const container = $('shortcuts-content');
  container.innerHTML = '';
  for (const group of shortcutSections()) {
    const h = document.createElement('h3');
    h.textContent = group.section;
    container.appendChild(h);
    const table = document.createElement('table');
    for (const item of group.items) {
      if (!item.keys) continue;
      const tr = document.createElement('tr');
      const key = document.createElement('td');
      key.className = 'key';
      key.textContent = formatKeys(item.keys);
      const desc = document.createElement('td');
      desc.textContent = item.desc;
      if (item.id) {
        desc.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'bindable';
        desc.appendChild(badge);
      }
      tr.appendChild(key);
      tr.appendChild(desc);
      table.appendChild(tr);
    }
    container.appendChild(table);
  }
  $('shortcuts-note').textContent = `Items marked bindable can be customized in ${SETTINGS_PATH} under shortcuts.<id>. Save preferences or restart MathTerm to apply shortcut changes.`;
}

function save() {
  settings = collectForm();
  saveSettingsFile(settings);
  mt.ipc.send('preferences-saved', settings);
  window.close();
}

document.addEventListener('DOMContentLoaded', () => {
  fillForm();
  renderShortcuts();
  setActiveTab(activeTab);
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
  $('save').addEventListener('click', save);
  $('cancel').addEventListener('click', () => window.close());
});

mt.ipc.on('preferences-section', tab => setActiveTab(tab));
