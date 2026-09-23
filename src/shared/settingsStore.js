const mt = window.mathterm;
const { createDefaultShortcuts, LEGACY_T14_SHORTCUTS, LEGACY_MAC_SHORTCUTS } = require('./shortcutDefaults');

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
  mathSymbolSearch: true,
  latexMacros: '',
  theme: 'dark',
  cursorStyle: 'block',
  inheritCwd: false,
  splitPaneInheritsCwd: true,
  macOptionAsMeta: true,
  restoreLastSession: false,
  copyOnSelect: true,
  backgroundCommandMarker: true,
  backgroundCommandNotifications: true,
  backgroundCommandNotificationMinMs: 10000,
  quitWhenLastTabClosed: false,
  defaultProfile: 'auto',
  // 'model': trained display-math detector; 'rules': the older $$ pairing.
  mathBlockDetection: 'model',
  // Developer option: save each Math Mode view locally for refining the model.
  captureMathViews: false,
  _copyOnSelectDefaultVersion: 2,
  shortcuts: DEFAULT_SHORTCUTS,
};

const LEGACY_KEYS = ['bg', 'fg', 'cursor'];

function migrateShortcutDefaults(shortcuts) {
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

function needsShortcutMigration(incoming) {
  const sc = (incoming && incoming.shortcuts) || {};
  return Object.keys(LEGACY_T14_SHORTCUTS).some(k => sc[k] === LEGACY_T14_SHORTCUTS[k])
    || (isMac && Object.keys(LEGACY_MAC_SHORTCUTS).some(k => sc[k] === LEGACY_MAC_SHORTCUTS[k]))
    || !sc.togglePaneMaximize;
}

function mergeIncoming(incoming) {
  const cleaned = { ...(incoming || {}) };
  for (const k of LEGACY_KEYS) delete cleaned[k];
  const shortcuts = migrateShortcutDefaults({ ...DEFAULT_SHORTCUTS, ...(cleaned.shortcuts || {}) });
  if (isMac && cleaned._copyOnSelectDefaultVersion !== 2 && cleaned.copyOnSelect === false) {
    cleaned.copyOnSelect = true;
  }
  return {
    ...DEFAULTS,
    ...cleaned,
    shortcuts,
    latexMacros: typeof cleaned.latexMacros === 'string' ? cleaned.latexMacros : DEFAULTS.latexMacros,
    mathBlockDetection: cleaned.mathBlockDetection === 'rules' ? 'rules' : 'model',
    captureMathViews: cleaned.captureMathViews === true,
    backgroundCommandNotificationMinMs: Number.isFinite(Number(cleaned.backgroundCommandNotificationMinMs))
      ? Math.max(0, Number(cleaned.backgroundCommandNotificationMinMs))
      : DEFAULTS.backgroundCommandNotificationMinMs,
  };
}

function loadSettings() {
  let raw;
  try { raw = mt.fs.readFileSync(SETTINGS_PATH, 'utf8'); } catch { raw = null; }
  const incoming = raw ? JSON.parse(raw) : {};
  const merged = mergeIncoming(incoming);
  const hasLegacy = LEGACY_KEYS.some(k => k in (incoming || {}));
  const needsCopyOnSelectMigration = isMac
    && incoming._copyOnSelectDefaultVersion !== 2
    && incoming.copyOnSelect === false;
  if (raw === null || !incoming.shortcuts || hasLegacy || needsShortcutMigration(incoming) || needsCopyOnSelectMigration) {
    try { saveSettingsFile(merged); } catch {}
  }
  return merged;
}

function saveSettingsFile(s) {
  mt.fs.mkdirSync(mt.path.dirname(SETTINGS_PATH), { recursive: true });
  mt.fs.writeFileSync(SETTINGS_PATH, JSON.stringify(mergeIncoming(s), null, 2) + '\n');
}

module.exports = {
  DEFAULTS,
  DEFAULT_SHORTCUTS,
  SETTINGS_PATH,
  configHome,
  isMac,
  loadSettings,
  saveSettingsFile,
  mergeIncoming,
};
