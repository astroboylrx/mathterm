const katex = require('katex');
const { settings } = require('./settings');
const { getKatexMacros } = require('./latexMacros');
const { repairPartialLatex } = require('./latexRepair');

const MAX_CACHE_ENTRIES = 512;
const htmlCache = new Map();

function cacheKey(latex, displayMode) {
  return String(settings.latexMacros || '') + '\n' + (displayMode ? '1:' : '0:') + latex;
}

function remember(key, html) {
  if (htmlCache.has(key)) htmlCache.delete(key);
  htmlCache.set(key, html);
  if (htmlCache.size > MAX_CACHE_ENTRIES) {
    const oldest = htmlCache.keys().next().value;
    htmlCache.delete(oldest);
  }
}

function renderKatexHtml(latex, displayMode) {
  const key = cacheKey(latex, displayMode);
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const html = katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    macros: getKatexMacros(settings.latexMacros),
  });
  remember(key, html);
  return html;
}

function renderKatexInto(latex, el, displayMode) {
  try {
    el.innerHTML = renderKatexHtml(latex, displayMode);
  } catch {
    el.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
  }
}

// Throws on any parse error instead of drawing it in red. Cached apart from
// the lenient renders, whose entry for the same LaTeX may be an error render.
function renderKatexHtmlStrict(latex, displayMode) {
  const key = 's:' + cacheKey(latex, displayMode);
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const html = katex.renderToString(latex, {
    displayMode,
    throwOnError: true,
    macros: getKatexMacros(settings.latexMacros),
  });
  remember(key, html);
  return html;
}

// A block found by the display-math model: try its LaTeX as is, then repaired
// when the view cut into the block, and only then give up -- to plain text for
// a cut block, whose red parse error would say nothing useful, otherwise to the
// lenient render that marks just the offending part.
function renderDisplayBlockInto(latex, el, { repair = false, fallback = 'error' } = {}) {
  const candidates = repair ? [latex, repairPartialLatex(latex)] : [latex];
  for (const candidate of candidates) {
    try {
      el.innerHTML = renderKatexHtmlStrict(candidate, true);
      return;
    } catch {}
  }
  if (fallback === 'text') {
    el.textContent = latex;
    el.classList.add('display-math-fallback');
    return;
  }
  renderKatexInto(latex, el, true);
}

module.exports = { renderKatexHtml, renderKatexInto, renderDisplayBlockInto };
