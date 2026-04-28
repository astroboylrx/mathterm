const mt = window.mathterm;
const { state, getActivePane, forEachPane } = require('./state');
const { createDefaultShortcuts, LEGACY_T14_SHORTCUTS, LEGACY_MAC_SHORTCUTS } = require('../shortcutDefaults');

const isMac = mt.os.platform === 'darwin';

const configHome = mt.os.env.XDG_CONFIG_HOME || mt.path.join(mt.os.homedir(), '.config');
const SETTINGS_PATH = mt.path.join(configHome, 'mathterm', 'mathterm.json');

const DEFAULT_SHORTCUTS = createDefaultShortcuts(isMac);

const DEFAULTS = {
  scrollback: 16384,
  fontSize: 16,
  fontFamily: '"JetBrainsMono Nerd Font Mono", monospace',
  autoRender: false,
  autoRenderDelay: 1500,
  theme: 'dark',
  cursorStyle: 'block',
  inheritCwd: false,
  copyOnSelect: true,
  backgroundCommandMarker: true,
  quitWhenLastTabClosed: false,
  _copyOnSelectDefaultVersion: 2,
  shortcuts: DEFAULT_SHORTCUTS,
};

const LEGACY_KEYS = ['bg', 'fg', 'cursor'];
function _migrateShortcutDefaults(shortcuts) {
  if (shortcuts.prevPrompt === LEGACY_T14_SHORTCUTS.prevPrompt) {
    shortcuts.prevPrompt = DEFAULT_SHORTCUTS.prevPrompt;
  }
  if (shortcuts.nextPrompt === LEGACY_T14_SHORTCUTS.nextPrompt) {
    shortcuts.nextPrompt = DEFAULT_SHORTCUTS.nextPrompt;
  }
  if (shortcuts.selectLastCommand === LEGACY_T14_SHORTCUTS.selectLastCommand) {
    shortcuts.selectLastCommand = DEFAULT_SHORTCUTS.selectLastCommand;
  }
  if (shortcuts.scrollToCursor === LEGACY_T14_SHORTCUTS.scrollToCursor) {
    shortcuts.scrollToCursor = DEFAULT_SHORTCUTS.scrollToCursor;
  }
  if (isMac) {
    for (const [key, legacyValue] of Object.entries(LEGACY_MAC_SHORTCUTS)) {
      if (shortcuts[key] === legacyValue) shortcuts[key] = DEFAULT_SHORTCUTS[key];
    }
  }
  if (!shortcuts.togglePaneMaximize) {
    shortcuts.togglePaneMaximize = DEFAULT_SHORTCUTS.togglePaneMaximize;
  }
  return shortcuts;
}

function _needsShortcutMigration(incoming) {
  const sc = (incoming && incoming.shortcuts) || {};
  return Object.keys(LEGACY_T14_SHORTCUTS).some(k => sc[k] === LEGACY_T14_SHORTCUTS[k])
    || (isMac && Object.keys(LEGACY_MAC_SHORTCUTS).some(k => sc[k] === LEGACY_MAC_SHORTCUTS[k]))
    || !sc.togglePaneMaximize;
}

function _mergeIncoming(incoming) {
  const cleaned = { ...(incoming || {}) };
  for (const k of LEGACY_KEYS) delete cleaned[k];
  const shortcuts = _migrateShortcutDefaults({ ...DEFAULT_SHORTCUTS, ...(cleaned.shortcuts || {}) });
  if (isMac && cleaned._copyOnSelectDefaultVersion !== 2 && cleaned.copyOnSelect === false) {
    cleaned.copyOnSelect = true;
  }
  return {
    ...DEFAULTS,
    ...cleaned,
    shortcuts,
  };
}

function loadSettings() {
  let raw;
  try { raw = mt.fs.readFileSync(SETTINGS_PATH, 'utf8'); } catch { raw = null; }
  const incoming = raw ? JSON.parse(raw) : {};
  const merged = _mergeIncoming(incoming);
  const hasLegacy = LEGACY_KEYS.some(k => k in (incoming || {}));
  const needsCopyOnSelectMigration = isMac
    && incoming._copyOnSelectDefaultVersion !== 2
    && incoming.copyOnSelect === false;
  if (raw === null || !incoming.shortcuts || hasLegacy || _needsShortcutMigration(incoming) || needsCopyOnSelectMigration) {
    try { saveSettingsFile(merged); } catch {}
  }
  return merged;
}

function saveSettingsFile(s) {
  mt.fs.mkdirSync(mt.path.dirname(SETTINGS_PATH), { recursive: true });
  mt.fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n');
}

const settings = loadSettings();

function _updateThemePreview(themeId) {
  const { resolveTheme } = require('./themes');
  const c = resolveTheme(themeId);
  const el = document.getElementById('s-theme-preview');
  if (!el || !c) return;
  el.innerHTML = '';
  const keys = ['bg', 'fg', 'accent', 'red', 'yellow', 'blue', 'purple', 'cyan', 'orange'];
  for (const k of keys) {
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = c[k];
    sw.title = `${k}: ${c[k]}`;
    el.appendChild(sw);
  }
}

function openSettings() {
  const { getThemeList } = require('./themes');
  const sel = document.getElementById('s-theme');
  sel.innerHTML = '';
  for (const t of getThemeList()) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + (t.builtin ? '' : ' (custom)');
    if (t.id === settings.theme) opt.selected = true;
    sel.appendChild(opt);
  }
  _updateThemePreview(settings.theme);
  sel.onchange = () => _updateThemePreview(sel.value);

  document.getElementById('s-scrollback').value = settings.scrollback;
  document.getElementById('s-fontsize').value = settings.fontSize;
  document.getElementById('s-fontfamily').value = settings.fontFamily;
  document.getElementById('s-autorender').checked = settings.autoRender;
  document.getElementById('s-delay').value = settings.autoRenderDelay;
  document.getElementById('s-cursorstyle').value = settings.cursorStyle;
  document.getElementById('s-inheritcwd').checked = settings.inheritCwd;
  document.getElementById('s-copyonselect').checked = settings.copyOnSelect;
  document.getElementById('s-attentionmarker').checked = settings.backgroundCommandMarker;
  const quitLastTabRow = document.getElementById('s-quitlasttab-row');
  const quitLastTab = document.getElementById('s-quitlasttab');
  if (quitLastTabRow) quitLastTabRow.classList.toggle('hidden', !isMac);
  if (quitLastTab) quitLastTab.checked = !!settings.quitWhenLastTabClosed;
  const cfgNote = document.getElementById('s-config-path');
  if (cfgNote) cfgNote.textContent = `For shortcuts and custom themes, edit files in ${mt.path.join(configHome, 'mathterm')}.`;
  document.getElementById('settings-dialog').showModal();
}

function closeSettings() {
  document.getElementById('settings-dialog').close();
}

function saveSettings() {
  settings.theme = document.getElementById('s-theme').value || 'dark';
  settings.scrollback = parseInt(document.getElementById('s-scrollback').value) || DEFAULTS.scrollback;
  settings.fontSize = parseInt(document.getElementById('s-fontsize').value) || DEFAULTS.fontSize;
  settings.fontFamily = document.getElementById('s-fontfamily').value || DEFAULTS.fontFamily;
  settings.autoRender = document.getElementById('s-autorender').checked;
  settings.autoRenderDelay = parseInt(document.getElementById('s-delay').value) || DEFAULTS.autoRenderDelay;
  settings.cursorStyle = ['block', 'bar', 'underline'].includes(document.getElementById('s-cursorstyle').value)
    ? document.getElementById('s-cursorstyle').value : DEFAULTS.cursorStyle;
  settings.inheritCwd = document.getElementById('s-inheritcwd').checked;
  settings.copyOnSelect = document.getElementById('s-copyonselect').checked;
  settings.backgroundCommandMarker = document.getElementById('s-attentionmarker').checked;
  const quitLastTab = document.getElementById('s-quitlasttab');
  settings.quitWhenLastTabClosed = isMac && quitLastTab ? quitLastTab.checked : false;

  saveSettingsFile(settings);
  applySettings();
  closeSettings();
}

function applySettings() {
  const { applyTheme, selectionBgFor } = require('./themes');
  const { applyZoomToTab } = require('./zoom');
  const c = applyTheme(settings.theme);

  const tab = getActivePane();
  if (tab) tab.autoRender = settings.autoRender;
  const active = tab ? tab.autoRender : settings.autoRender;
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = active ? '' : 'off';
  document.documentElement.style.setProperty('--ui-font-size', settings.fontSize + 'px');
  applyButtonTitles();
  forEachPane((pane) => {
    pane.term.options.fontFamily = settings.fontFamily;
    pane.term.options.theme = {
      background: c.bg,
      foreground: c.fg,
      cursor: c.accent,
      selectionBackground: selectionBgFor(c)
    };
    pane.term.options.cursorStyle = settings.cursorStyle;
    applyZoomToTab(pane);
  });
  const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (activeWorkspace) {
    const { fitVisiblePanes } = require('./tabs');
    fitVisiblePanes(activeWorkspace);
  }
  mt.ipc.send('rebuild-menu', active);
}

function applyButtonTitles() {
  const { parseShortcut, formatShortcut } = require('./keybindings');
  const sc = settings.shortcuts || {};
  if (state.mathBtn) {
    const chord = formatShortcut(parseShortcut(sc.toggleMath), isMac);
    state.mathBtn.title = chord ? `Toggle Math mode (${chord})` : 'Toggle Math mode';
  }
  if (state.autoIndicator) {
    const chord = formatShortcut(parseShortcut(sc.toggleAutoRender), isMac);
    state.autoIndicator.title = chord
      ? `Toggle auto-render LaTeX, per tab (${chord})`
      : 'Toggle auto-render LaTeX (per tab)';
  }
}

module.exports = { settings, DEFAULTS, SETTINGS_PATH, isMac, openSettings, closeSettings, saveSettings, applySettings };
