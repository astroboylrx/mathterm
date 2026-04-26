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

const BUILTIN_THEMES = {
  dark: { name: 'Dark', colors: DARK },
  nord: { name: 'Nord', colors: NORD },
  'solarized-dark': { name: 'Solarized Dark', colors: SOLARIZED_DARK },
  'catppuccin-mocha': { name: 'Catppuccin Mocha', colors: CATPPUCCIN_MOCHA },
  'gruvbox-dark': { name: 'Gruvbox Dark', colors: GRUVBOX_DARK },
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

module.exports = { BUILTIN_THEMES, resolveTheme, getThemeList, loadUserThemes, applyTheme };
