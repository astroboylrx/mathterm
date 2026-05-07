function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function stripAnsi(text) {
  if (!/[\x1b\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return text;
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\][^\x1b]*/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[^[\]][\x20-\x2f]*[\x30-\x7e]/g, '')
    .replace(/\x1b[^[\]][A-Za-z]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function parseAnsiToSpans(text) {
  const fragment = document.createDocumentFragment();
  let i = 0, classes = [], buf = '';
  function flushBuf() {
    if (!buf) return;
    const span = document.createElement('span');
    if (classes.length) span.className = classes.join(' ');
    span.textContent = buf;
    fragment.appendChild(span);
    buf = '';
  }
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const m = text.slice(i).match(/^\x1b\[([0-9;?]*)([a-zA-Z])/);
      if (m) {
        flushBuf();
        const codes = m[1].replace(/\?/g,'').split(';').filter(Boolean).map(Number);
        for (const c of codes) {
          if (c === 0) classes = [];
          else if (c === 1) classes.push('ansi-bold');
          else if (c === 2) classes.push('ansi-dim');
          else if (c === 3) classes.push('ansi-italic');
          else if (c === 4) classes.push('ansi-underline');
          else if (c >= 30 && c <= 37) { classes = classes.filter(x => !/^ansi-[39]\d$/.test(x)); classes.push('ansi-'+c); }
          else if (c >= 90 && c <= 97) { classes = classes.filter(x => !/^ansi-[39]\d$/.test(x)); classes.push('ansi-'+c); }
          else if (c === 39 || c === 49) { classes = classes.filter(x => !/^ansi-[39]\d$/.test(x)); }
        }
        i += m[0].length; continue;
      }
    }
    if (text[i] === '\x1b' && text[i + 1] === ']') {
      flushBuf();
      const end1 = text.indexOf('\x07',i), end2 = text.indexOf('\x1b\\',i);
      if (end1 !== -1 && end2 !== -1) i = Math.min(end1,end2)+1;
      else if (end1 !== -1) i = end1+1;
      else if (end2 !== -1) i = end2+2;
      else i = text.length;
      continue;
    }
    if (text[i] === '\x1b') { flushBuf(); i += 2; continue; }
    if (text.charCodeAt(i) < 0x20 && text[i] !== '\n') { flushBuf(); i++; continue; }
    buf += text[i]; i++;
  }
  flushBuf();
  return fragment;
}

let ANSI_16_COLORS = [
  '#1e1e1e','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5',
  '#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#e5e5e5'
];

function setAnsiColors(colors16) {
  if (colors16 && colors16.length === 16) ANSI_16_COLORS = colors16;
}

function cellFgColor(cell) {
  const mode = cell.getFgColorMode();
  switch (mode) {
    case 16777216:
    case 33554432: {
      const idx = cell.getFgColor();
      if (idx < 16) return ANSI_16_COLORS[idx];
      return null;
    }
    case 50331648: {
      const rgb = cell.getFgColor();
      const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
      return `rgb(${r},${g},${b})`;
    }
    default: return null;
  }
}

function lineToColoredSpans(line) {
  const fragment = document.createDocumentFragment();
  const cols = line.length;
  let cellRef = line.getCell(0);
  if (!cellRef) return fragment;
  let span = document.createElement('span');
  let currentClasses = [];
  let currentColor = null;
  let buf = '';

  function _emitSpan(classes, text) {
    if (!text) return;
    const s = document.createElement('span');
    if (currentColor) s.style.color = currentColor;
    if (classes.length) s.className = classes.join(' ');
    s.textContent = text;
    fragment.appendChild(s);
  }

  function flushBuf() {
    if (!buf) {
      span = document.createElement('span');
      return;
    }
    // Strip ansi-underline from trailing whitespace so a TUI "heading bar"
    // (underlined text padded with underlined spaces to end of line) doesn't
    // render as a window-wide rule.
    if (currentClasses.includes('ansi-underline')) {
      const m = buf.match(/^([\s\S]*?)(\s*)$/);
      const head = m[1], tail = m[2];
      _emitSpan(currentClasses, head);
      _emitSpan(currentClasses.filter(c => c !== 'ansi-underline'), tail);
    } else {
      _emitSpan(currentClasses, buf);
    }
    span = document.createElement('span');
    currentClasses = [];
    currentColor = null;
    buf = '';
  }

  for (let x = 0; x < cols; x++) {
    cellRef = line.getCell(x, cellRef);
    if (!cellRef) break;
    const ch = cellRef.getChars();
    if (!ch || (ch.length === 1 && ch.charCodeAt(0) === 0)) {
      buf += ' ';
      continue;
    }
    const code = cellRef.getCode();
    if (code === 0 && !buf) continue;

    const classes = [];
    if (cellRef.isBold()) classes.push('ansi-bold');
    if (cellRef.isDim()) classes.push('ansi-dim');
    if (cellRef.isItalic()) classes.push('ansi-italic');
    if (cellRef.isUnderline()) classes.push('ansi-underline');
    const color = cellFgColor(cellRef);

    const classesKey = classes.join(',');
    const styleChanged = color !== currentColor || classesKey !== currentClasses.join(',');
    if (styleChanged && buf) flushBuf();

    currentClasses = classes;
    currentColor = color;
    buf += ch;
  }
  flushBuf();
  return fragment;
}

module.exports = { escapeHtml, stripAnsi, parseAnsiToSpans, lineToColoredSpans, setAnsiColors };
