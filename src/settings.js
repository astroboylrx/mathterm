const mt = window.mathterm;
const { state, getActiveTab, updateStatusBar } = require('./state');

const isMac = mt.os.platform === 'darwin';

const configHome = mt.os.env.XDG_CONFIG_HOME || mt.path.join(mt.os.homedir(), '.config');
const SETTINGS_PATH = mt.path.join(configHome, 'mathterm', 'mathterm.json');

const DEFAULTS = {
  scrollback: 16384,
  fontSize: 16,
  fontFamily: '"JetBrainsMono Nerd Font Mono", monospace',
  autoRender: true,
  autoRenderDelay: 1500,
  bg: '#1a1a2e',
  fg: '#e0e0e0',
  cursor: '#51cf66',
  cursorStyle: 'block',
  inheritCwd: false,
  copyOnSelect: !isMac,
};

function loadSettings() {
  try {
    const raw = mt.fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettingsFile(s) {
  mt.fs.mkdirSync(mt.path.dirname(SETTINGS_PATH), { recursive: true });
  mt.fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n');
}

const settings = loadSettings();

function openSettings() {
  document.getElementById('s-scrollback').value = settings.scrollback;
  document.getElementById('s-fontsize').value = settings.fontSize;
  document.getElementById('s-fontfamily').value = settings.fontFamily;
  document.getElementById('s-autorender').checked = settings.autoRender;
  document.getElementById('s-delay').value = settings.autoRenderDelay;
  document.getElementById('s-bg').value = settings.bg;
  document.getElementById('s-fg').value = settings.fg;
  document.getElementById('s-cursor').value = settings.cursor;
  document.getElementById('s-cursorstyle').value = settings.cursorStyle;
  document.getElementById('s-inheritcwd').checked = settings.inheritCwd;
  document.getElementById('s-copyonselect').checked = settings.copyOnSelect;
  document.getElementById('settings-dialog').showModal();
}

function closeSettings() {
  document.getElementById('settings-dialog').close();
}

function saveSettings() {
  const validateColor = (v, fallback) => {
    if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', v)) return v;
    return fallback;
  };
  settings.scrollback = parseInt(document.getElementById('s-scrollback').value) || DEFAULTS.scrollback;
  settings.fontSize = parseInt(document.getElementById('s-fontsize').value) || DEFAULTS.fontSize;
  settings.fontFamily = document.getElementById('s-fontfamily').value || DEFAULTS.fontFamily;
  settings.autoRender = document.getElementById('s-autorender').checked;
  settings.autoRenderDelay = parseInt(document.getElementById('s-delay').value) || DEFAULTS.autoRenderDelay;
  settings.bg = validateColor(document.getElementById('s-bg').value || DEFAULTS.bg, DEFAULTS.bg);
  settings.fg = validateColor(document.getElementById('s-fg').value || DEFAULTS.fg, DEFAULTS.fg);
  settings.cursor = validateColor(document.getElementById('s-cursor').value || DEFAULTS.cursor, DEFAULTS.cursor);
  settings.cursorStyle = ['block', 'bar', 'underline'].includes(document.getElementById('s-cursorstyle').value)
    ? document.getElementById('s-cursorstyle').value : DEFAULTS.cursorStyle;
  settings.inheritCwd = document.getElementById('s-inheritcwd').checked;
  settings.copyOnSelect = document.getElementById('s-copyonselect').checked;

  saveSettingsFile(settings);
  applySettings();
  closeSettings();
}

function applySettings() {
  const tab = getActiveTab();
  if (tab) tab.autoRender = settings.autoRender;
  const active = tab ? tab.autoRender : settings.autoRender;
  state.autoIndicator.textContent = 'AUTO';
  state.autoIndicator.className = active ? '' : 'off';
  document.documentElement.style.setProperty('--ui-font-size', settings.fontSize + 'px');
  for (const tab of state.tabs) {
    tab.term.options.fontSize = settings.fontSize;
    tab.term.options.fontFamily = settings.fontFamily;
    tab.term.options.theme = {
      background: settings.bg,
      foreground: settings.fg,
      cursor: settings.cursor
    };
    tab.term.options.cursorStyle = settings.cursorStyle;
    if (tab.container.classList.contains('active')) tab.fitAddon.fit();
    tab.richView.style.fontSize = settings.fontSize + 'px';
  }
  mt.ipc.send('rebuild-menu', active);
}

module.exports = { settings, DEFAULTS, SETTINGS_PATH, isMac, openSettings, closeSettings, saveSettings, applySettings };
