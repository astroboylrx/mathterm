const mt = window.mathterm;
const { isMac } = require('./settings');
const { wrappedRangeForLine } = require('./promptTrack');

// Match gnome-terminal / iTerm: Ctrl-click (Cmd on mac) on a URL opens it in
// the default browser. We hit-test against the xterm buffer ourselves rather
// than rely on WebLinksAddon's click path, which doesn't reach the activate
// handler under the WebGL renderer in xterm.js 5.5.
const URL_LINK_RE = /\b((?:https?:\/\/|mailto:)[^\s'"<>()\[\]{}]+|www\d*\.[^\s'"<>()\[\]{}]+)/gi;

function trimTrailingPunctuation(url) {
  return url.replace(/[.,;:!?)\]}'"]+$/, '');
}

function normalizeUrlForOpen(url) {
  const trimmed = trimTrailingPunctuation(url);
  if (/^www\d*\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function isOpenableUrl(url) {
  try {
    const parsed = new URL(normalizeUrlForOpen(url));
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function urlAtBufferPosition(term, col, row) {
  const buf = term.buffer.active;
  const wrappedRange = wrappedRangeForLine(buf, row);
  const startRow = wrappedRange ? Math.max(wrappedRange.first, row - 8) : row;
  const endRow = wrappedRange ? Math.min(wrappedRange.last, row + 8) : row;
  let text = '';
  let cursorIdx = -1;
  for (let y = startRow; y <= endRow; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const part = line.translateToString(true);
    if (y === row) cursorIdx = text.length + col;
    text += part;
  }
  if (cursorIdx < 0) return null;
  let m;
  URL_LINK_RE.lastIndex = 0;
  while ((m = URL_LINK_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (cursorIdx >= start && cursorIdx < end) return normalizeUrlForOpen(m[0]);
  }
  return null;
}

function linksForBufferLine(term, row) {
  const line = term.buffer.active.getLine(row);
  if (!line) return [];
  const text = line.translateToString(true);
  const links = [];
  let m;
  URL_LINK_RE.lastIndex = 0;
  while ((m = URL_LINK_RE.exec(text)) !== null) {
    const raw = m[0];
    if (!isOpenableUrl(raw)) continue;
    const trimmed = trimTrailingPunctuation(raw);
    const startX = m.index + 1;
    const endX = m.index + trimmed.length;
    links.push({
      range: {
        start: { x: startX, y: row + 1 },
        end: { x: endX, y: row + 1 }
      },
      text: trimmed,
      activate: () => {}
    });
  }
  return links;
}

function attachBareUrlHoverProvider(term) {
  term.registerLinkProvider({
    provideLinks(y, callback) {
      callback(linksForBufferLine(term, y - 1));
    }
  });
}

function attachUrlClickHandler(pane, term, xtermHolder) {
  xtermHolder.addEventListener('click', e => {
    const wantsOpen = isMac ? e.metaKey : e.ctrlKey;
    if (!wantsOpen) return;
    const screen = term.element && term.element.querySelector('.xterm-screen');
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right
        || e.clientY < rect.top || e.clientY > rect.bottom) return;
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    if (!(cellW > 0) || !(cellH > 0)) return;
    const col = Math.min(term.cols - 1, Math.max(0, Math.floor((e.clientX - rect.left) / cellW)));
    const viewportRow = Math.min(term.rows - 1, Math.max(0, Math.floor((e.clientY - rect.top) / cellH)));
    const row = term.buffer.active.viewportY + viewportRow;
    const url = urlAtBufferPosition(term, col, row);
    if (!url) return;
    if (!isOpenableUrl(url)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      Promise.resolve(mt.shell.openExternal(url)).catch(err => {
        console.error('openExternal failed for', url, err);
      });
    } catch (err) {
      console.error('openExternal threw for', url, err);
    }
  }, true);
}

module.exports = {
  attachBareUrlHoverProvider,
  attachUrlClickHandler,
  trimTrailingPunctuation,
  normalizeUrlForOpen,
  isOpenableUrl,
  urlAtBufferPosition,
  linksForBufferLine
};
