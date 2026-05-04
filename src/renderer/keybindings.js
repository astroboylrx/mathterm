const KEY_ALIASES = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  pgup: 'PageUp', pageup: 'PageUp', pgdn: 'PageDown', pagedown: 'PageDown',
  esc: 'Escape', escape: 'Escape',
  ret: 'Enter', return: 'Enter', enter: 'Enter',
  space: ' ',
  plus: '+', minus: '-',
};

function _normKey(s) {
  const lower = s.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (lower.length === 1) return lower;
  return s;
}

function parseShortcut(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out = { mod: false, ctrl: false, shift: false, alt: false, meta: false, key: null };
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (lower === 'mod' || lower === 'cmdorctrl') out.mod = true;
    else if (lower === 'ctrl' || lower === 'control') out.ctrl = true;
    else if (lower === 'shift') out.shift = true;
    else if (lower === 'alt' || lower === 'option') out.alt = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') out.meta = true;
    else out.key = _normKey(raw);
  }
  if (!out.key) return null;
  return out;
}

function matchShortcut(spec, e, isMac) {
  if (!spec) return false;
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (eventKey !== spec.key) return false;
  if (spec.mod) {
    const modPressed = isMac ? e.metaKey : e.ctrlKey;
    if (!modPressed) return false;
    const otherMod = isMac ? e.ctrlKey : e.metaKey;
    if (otherMod) return false;
  } else {
    if (e.ctrlKey !== spec.ctrl) return false;
    if (e.metaKey !== spec.meta) return false;
  }
  if (e.shiftKey !== spec.shift) return false;
  if (e.altKey !== spec.alt) return false;
  return true;
}

function formatShortcut(spec, isMac) {
  if (!spec) return '';
  const parts = [];
  if (spec.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (spec.ctrl) parts.push('Ctrl');
  if (spec.meta) parts.push(isMac ? '⌘' : 'Meta');
  if (spec.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (spec.shift) parts.push('Shift');
  parts.push(spec.key.length === 1 ? spec.key.toUpperCase() : spec.key);
  return parts.join('+');
}

function shortcutToAccelerator(str) {
  if (!str) return '';
  return str
    .split('+')
    .map(p => p.trim())
    .map(p => {
      const lower = p.toLowerCase();
      if (lower === 'mod' || lower === 'cmdorctrl') return 'CmdOrCtrl';
      if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
      return p;
    })
    .join('+');
}

module.exports = { parseShortcut, matchShortcut, formatShortcut, shortcutToAccelerator };
