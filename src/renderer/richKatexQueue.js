const { renderKatexInto } = require('./katexRender');

const _katexQueue = [];
let _katexRaf = 0;
const KATEX_CHUNK = 48;
const KATEX_FRAME_BUDGET_MS = 12;

function queueKatex(latex, el, displayMode, opts) {
  el.textContent = latex;
  el.dataset.katexPending = '1';
  let token = null;
  if (opts && opts.renderToken != null) {
    token = String(opts.renderToken);
    el.dataset.richRenderToken = token;
  }
  _katexQueue.push({ latex, el, displayMode, token });
  scheduleKatexFlush();
}

function scheduleKatexFlush() {
  if (_katexRaf) return;
  _katexRaf = requestAnimationFrame(() => {
    _katexRaf = requestAnimationFrame(_flushKatex);
  });
}

function prioritizeKatexQueue(viewportEl) {
  if (!_katexQueue.length || !viewportEl) return;
  const top = Math.max(0, viewportEl.scrollTop - viewportEl.clientHeight);
  const bottom = viewportEl.scrollTop + viewportEl.clientHeight * 2;
  const scored = _katexQueue.map((entry, index) => ({
    entry,
    index,
    score: katexViewportScore(entry.el, top, bottom)
  }));
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  _katexQueue.length = 0;
  for (const item of scored) _katexQueue.push(item.entry);
}

function katexViewportScore(el, top, bottom) {
  if (!el.isConnected) return Number.MAX_SAFE_INTEGER;
  const line = el.closest('.rline, .display-math') || el;
  const elTop = line.offsetTop;
  const elBottom = elTop + line.offsetHeight;
  if (elBottom >= top && elTop <= bottom) return 0;
  return Math.min(Math.abs(elBottom - top), Math.abs(elTop - bottom));
}

function _flushKatex() {
  const started = performance.now();
  let rendered = 0;
  let consumed = 0;
  while (consumed < _katexQueue.length) {
    if (rendered > 0
      && (rendered >= KATEX_CHUNK || performance.now() - started >= KATEX_FRAME_BUDGET_MS)) {
      break;
    }
    const { latex, el, displayMode, token } = _katexQueue[consumed];
    consumed++;
    if (!el.isConnected) continue;
    if (token != null && el.dataset.richRenderToken !== token) continue;
    renderKatexInto(latex, el, displayMode);
    delete el.dataset.katexPending;
    rendered++;
  }
  if (consumed > 0) _katexQueue.splice(0, consumed);
  if (_katexQueue.length > 0) {
    _katexRaf = requestAnimationFrame(_flushKatex);
  } else {
    _katexRaf = 0;
  }
}

async function drainKatexQueue() {
  let guard = 0;
  while (_katexQueue.length > 0 && guard < 600) {
    await new Promise(r => requestAnimationFrame(r));
    guard++;
  }
}

module.exports = {
  queueKatex,
  prioritizeKatexQueue,
  drainKatexQueue
};
