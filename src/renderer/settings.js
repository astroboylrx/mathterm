const mt = window.mathterm;
const { state, getActivePane, forEachPane } = require('./state');
const {
  DEFAULTS,
  SETTINGS_PATH,
  isMac,
  loadSettings,
  mergeIncoming,
} = require('../shared/settingsStore');

const settings = loadSettings();
let _lastMenuAutoRender = null;

function requestMenuRebuild(autoRender, opts = {}) {
  const active = !!autoRender;
  if (!opts.force && _lastMenuAutoRender === active) return;
  _lastMenuAutoRender = active;
  mt.ipc.send('rebuild-menu', active);
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
  requestMenuRebuild(active);
  window.dispatchEvent(new CustomEvent('mathterm-settings-applied'));
}

function replaceSettings(next) {
  const merged = mergeIncoming(next || loadSettings());
  for (const key of Object.keys(settings)) {
    if (!(key in merged)) delete settings[key];
  }
  Object.assign(settings, merged);
  return settings;
}

function reloadSettingsFromDisk() {
  replaceSettings(loadSettings());
  applySettings();
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

module.exports = {
  settings,
  DEFAULTS,
  SETTINGS_PATH,
  isMac,
  applySettings,
  requestMenuRebuild,
  replaceSettings,
  reloadSettingsFromDisk,
};
