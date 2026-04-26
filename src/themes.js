const mt = window.mathterm;

const DARK = {
  bg: '#1a1a2e', bgAlt: '#16213e', bgDark: '#0f0f23',
  fg: '#e0e0e0', fgMuted: '#888', fgDim: '#555',
  accent: '#51cf66',
  border: '#333',
  red: '#ff6b6b', yellow: '#ffd43b', blue: '#74c0fc',
  purple: '#da77f2', cyan: '#66d9e8', orange: '#ffa94d',
  highlight: '#f0883e',
  ansi: [
    '#1e1e1e','#cd3131','#0dbc79','#e5e510',
    '#2472c8','#bc3fbc','#11a8cd','#e5e5e5',
    '#666666','#f14c4c','#23d18b','#f5f543',
    '#3b8eea','#d670d6','#29b8db','#e5e5e5'
  ]
};

const NORD = {
  bg: '#2e3440', bgAlt: '#3b4252', bgDark: '#242933',
  fg: '#eceff4', fgMuted: '#d8dee9', fgDim: '#4c566a',
  accent: '#88c0d0',
  border: '#434c5e',
  red: '#bf616a', yellow: '#ebcb8b', blue: '#81a1c1',
  purple: '#b48ead', cyan: '#88c0d0', orange: '#d08770',
  highlight: '#d08770',
  ansi: [
    '#3b4252','#bf616a','#a3be8c','#ebcb8b',
    '#81a1c1','#b48ead','#88c0d0','#e5e9f0',
    '#4c566a','#bf616a','#a3be8c','#ebcb8b',
    '#81a1c1','#b48ead','#8fbcbb','#eceff4'
  ]
};

const SOLARIZED_DARK = {
  bg: '#002b36', bgAlt: '#073642', bgDark: '#001e26',
  fg: '#839496', fgMuted: '#657b83', fgDim: '#586e75',
  accent: '#268bd2',
  border: '#0a4a5e',
  red: '#dc322f', yellow: '#b58900', blue: '#268bd2',
  purple: '#6c71c4', cyan: '#2aa198', orange: '#cb4b16',
  highlight: '#cb4b16',
  ansi: [
    '#073642','#dc322f','#859900','#b58900',
    '#268bd2','#6c71c4','#2aa198','#eee8d5',
    '#002b36','#cb4b16','#859900','#b58900',
    '#268bd2','#6c71c4','#2aa198','#fdf6e3'
  ]
};

const CATPPUCCIN_MOCHA = {
  bg: '#1e1e2e', bgAlt: '#181825', bgDark: '#11111b',
  fg: '#cdd6f4', fgMuted: '#a6adc8', fgDim: '#585b70',
  accent: '#89b4fa',
  border: '#313244',
  red: '#f38ba8', yellow: '#f9e2af', blue: '#89b4fa',
  purple: '#cba6f7', cyan: '#94e2d5', orange: '#fab387',
  highlight: '#fab387',
  ansi: [
    '#45475a','#f38ba8','#a6e3a1','#f9e2af',
    '#89b4fa','#cba6f7','#94e2d5','#bac2de',
    '#585b70','#f38ba8','#a6e3a1','#f9e2af',
    '#89b4fa','#cba6f7','#94e2d5','#a6adc8'
  ]
};

const GRUVBOX_DARK = {
  bg: '#282828', bgAlt: '#3c3836', bgDark: '#1d2021',
  fg: '#ebdbb2', fgMuted: '#bdae93', fgDim: '#665c54',
  accent: '#b8bb26',
  border: '#504945',
  red: '#fb4934', yellow: '#fabd2f', blue: '#83a598',
  purple: '#d3869b', cyan: '#8ec07c', orange: '#fe8019',
  highlight: '#fe8019',
  ansi: [
    '#282828','#cc241d','#98971a','#d79921',
    '#458588','#b16286','#689d6a','#a89984',
    '#928374','#fb4934','#b8bb26','#fabd2f',
    '#83a598','#d3869b','#8ec07c','#ebdbb2'
  ]
};

const SOLARIZED_LIGHT = {
  bg: '#fdf6e3', bgAlt: '#eee8d5', bgDark: '#f5eed8',
  fg: '#657b83', fgMuted: '#839496', fgDim: '#93a1a1',
  accent: '#268bd2',
  border: '#d3cbb7',
  red: '#dc322f', yellow: '#b58900', blue: '#268bd2',
  purple: '#6c71c4', cyan: '#2aa198', orange: '#cb4b16',
  highlight: '#cb4b16',
  ansi: [
    '#073642','#dc322f','#859900','#b58900',
    '#268bd2','#6c71c4','#2aa198','#eee8d5',
    '#002b36','#cb4b16','#859900','#b58900',
    '#268bd2','#6c71c4','#2aa198','#fdf6e3'
  ]
};

const CATPPUCCIN_LATTE = {
  bg: '#eff1f5', bgAlt: '#e6e9ef', bgDark: '#e4e7ec',
  fg: '#4c4f69', fgMuted: '#5c5f77', fgDim: '#7c7f93',
  accent: '#1e66f5',
  border: '#bcc0cc',
  red: '#d20f39', yellow: '#df8e1d', blue: '#1e66f5',
  purple: '#8839ef', cyan: '#179299', orange: '#fe640b',
  highlight: '#fe640b',
  ansi: [
    '#5c5f77','#d20f39','#40a02b','#df8e1d',
    '#1e66f5','#8839ef','#179299','#4c4f69',
    '#6c6f85','#d20f39','#40a02b','#df8e1d',
    '#1e66f5','#8839ef','#179299','#acb0be'
  ]
};

const VSCODE_DARK = {
  bg: '#1e1e1e', bgAlt: '#252526', bgDark: '#181818',
  fg: '#d4d4d4', fgMuted: '#cccccc', fgDim: '#858585',
  accent: '#569cd6',
  border: '#3c3c3c',
  red: '#f44747', yellow: '#dcdcaa', blue: '#569cd6',
  purple: '#c586c0', cyan: '#4ec9b0', orange: '#ce9178',
  highlight: '#264f78',
  ansi: [
    '#000000','#cd3131','#0dbc79','#e5e510',
    '#2472c8','#bc3fbc','#11a8cd','#e5e5e5',
    '#666666','#f14c4c','#23d18b','#f5f543',
    '#3b8eea','#d670d6','#29b8db','#e5e5e5'
  ]
};

const VSCODE_LIGHT = {
  bg: '#ffffff', bgAlt: '#f3f3f3', bgDark: '#e7e7e7',
  fg: '#3b3b3b', fgMuted: '#616161', fgDim: '#a0a0a0',
  accent: '#0451a5',
  border: '#d4d4d4',
  red: '#cd3131', yellow: '#795e26', blue: '#0451a5',
  purple: '#af00db', cyan: '#0598bc', orange: '#dd6b17',
  highlight: '#0451a5',
  ansi: [
    '#000000','#cd3131','#00bc00','#949800',
    '#0451a5','#bc05bc','#0598bc','#555555',
    '#666666','#cd3131','#14ce14','#b5ba00',
    '#0451a5','#bc05bc','#0598bc','#a5a5a5'
  ]
};

const TOKYO_NIGHT = {
  bg: '#1a1b26', bgAlt: '#16161e', bgDark: '#15161e',
  fg: '#a9b1d6', fgMuted: '#9aa5ce', fgDim: '#565f89',
  accent: '#7aa2f7',
  border: '#3b4261',
  red: '#f7768e', yellow: '#e0af68', blue: '#7aa2f7',
  purple: '#bb9af7', cyan: '#7dcfff', orange: '#ff9e64',
  highlight: '#ff9e64',
  ansi: [
    '#15161e','#f7768e','#9ece6a','#e0af68',
    '#7aa2f7','#bb9af7','#7dcfff','#a9b1d6',
    '#414868','#f7768e','#9ece6a','#e0af68',
    '#7aa2f7','#bb9af7','#7dcfff','#c0caf5'
  ]
};

const DRACULA = {
  bg: '#282a36', bgAlt: '#44475a', bgDark: '#21222c',
  fg: '#f8f8f2', fgMuted: '#bdbed1', fgDim: '#6272a4',
  accent: '#bd93f9',
  border: '#44475a',
  red: '#ff5555', yellow: '#f1fa8c', blue: '#8be9fd',
  purple: '#ff79c6', cyan: '#8be9fd', orange: '#ffb86c',
  highlight: '#ff79c6',
  ansi: [
    '#21222c','#ff5555','#50fa7b','#f1fa8c',
    '#bd93f9','#ff79c6','#8be9fd','#f8f8f2',
    '#6272a4','#ff6e6e','#69ff94','#ffffa5',
    '#d6acff','#ff92df','#a4ffff','#ffffff'
  ]
};

const BUILTIN_THEMES = {
  dark: { name: 'Dark', colors: DARK },
  'vscode-dark': { name: 'VS Code Dark+', colors: VSCODE_DARK },
  'tokyo-night': { name: 'Tokyo Night', colors: TOKYO_NIGHT },
  dracula: { name: 'Dracula', colors: DRACULA },
  nord: { name: 'Nord', colors: NORD },
  'solarized-dark': { name: 'Solarized Dark', colors: SOLARIZED_DARK },
  'catppuccin-mocha': { name: 'Catppuccin Mocha', colors: CATPPUCCIN_MOCHA },
  'gruvbox-dark': { name: 'Gruvbox Dark', colors: GRUVBOX_DARK },
  'vscode-light': { name: 'VS Code Light+', colors: VSCODE_LIGHT },
  'solarized-light': { name: 'Solarized Light', colors: SOLARIZED_LIGHT },
  'catppuccin-latte': { name: 'Catppuccin Latte', colors: CATPPUCCIN_LATTE },
};

let _userThemes = {};

function _hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = hex.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexToRgba(hex, alpha) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return `rgba(0,0,0,${alpha})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function _luminance(hex) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return 0;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function selectionBgFor(c) {
  const alpha = _luminance(c.bg) > 0.5 ? 0.1 : 0.2;
  return hexToRgba(c.accent, alpha);
}

function resolveTheme(id) {
  if (BUILTIN_THEMES[id]) return BUILTIN_THEMES[id].colors;
  if (_userThemes[id]) return _userThemes[id].colors;
  return DARK;
}

function getThemeList() {
  const list = [];
  for (const [id, t] of Object.entries(BUILTIN_THEMES)) {
    list.push({ id, name: t.name, builtin: true });
  }
  for (const [id, t] of Object.entries(_userThemes)) {
    list.push({ id, name: t.name, builtin: false });
  }
  return list;
}

function _validColor(v) {
  if (typeof v !== 'string') return false;
  if (typeof CSS !== 'undefined' && CSS.supports) return CSS.supports('color', v);
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(rgb|hsl)a?\(/i.test(v);
}

function loadUserThemes() {
  const configHome = mt.os.env.XDG_CONFIG_HOME || mt.path.join(mt.os.homedir(), '.config');
  const themesDir = mt.path.join(configHome, 'mathterm', 'themes');
  _userThemes = {};
  let entries;
  try { entries = mt.fs.readdirSync(themesDir); } catch { return; }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.replace(/\.json$/, '');
    if (BUILTIN_THEMES[id]) {
      console.warn(`[themes] ignoring user theme "${entry}": id collides with built-in`);
      continue;
    }
    try {
      const raw = mt.fs.readFileSync(mt.path.join(themesDir, entry), 'utf8');
      const parsed = JSON.parse(raw);
      const colors = { ...DARK };
      if (parsed.colors && typeof parsed.colors === 'object') {
        for (const [k, v] of Object.entries(parsed.colors)) {
          if (_validColor(v)) colors[k] = v;
          else console.warn(`[themes] ${entry}: invalid color for "${k}": ${v}`);
        }
      }
      if (Array.isArray(parsed.ansi) && parsed.ansi.length === 16 && parsed.ansi.every(_validColor)) {
        colors.ansi = parsed.ansi;
      } else if (parsed.ansi !== undefined) {
        console.warn(`[themes] ${entry}: ansi must be a 16-entry array of valid colors`);
      }
      _userThemes[id] = { name: parsed.name || id, colors };
    } catch (e) {
      console.warn(`[themes] failed to load ${entry}: ${e.message}`);
    }
  }
}

function applyTheme(id) {
  const c = resolveTheme(id);
  const root = document.documentElement.style;
  root.setProperty('--bg', c.bg);
  root.setProperty('--bg-alt', c.bgAlt);
  root.setProperty('--bg-dark', c.bgDark);
  root.setProperty('--fg', c.fg);
  root.setProperty('--fg-muted', c.fgMuted);
  root.setProperty('--fg-dim', c.fgDim);
  root.setProperty('--accent', c.accent);
  root.setProperty('--accent-subtle', hexToRgba(c.accent, 0.15));
  root.setProperty('--selection-bg', selectionBgFor(c));
  root.setProperty('--border', c.border);
  root.setProperty('--red', c.red);
  root.setProperty('--yellow', c.yellow);
  root.setProperty('--blue', c.blue);
  root.setProperty('--purple', c.purple);
  root.setProperty('--cyan', c.cyan);
  root.setProperty('--orange', c.orange);
  root.setProperty('--highlight', c.highlight);
  const ansi = (Array.isArray(c.ansi) && c.ansi.length === 16) ? c.ansi : DARK.ansi;
  for (let i = 0; i < 16; i++) {
    root.setProperty(`--ansi-${i}`, ansi[i]);
  }

  const { setAnsiColors } = require('./ansi');
  setAnsiColors(ansi);

  return c;
}

module.exports = { BUILTIN_THEMES, resolveTheme, getThemeList, loadUserThemes, applyTheme, hexToRgba, selectionBgFor };
