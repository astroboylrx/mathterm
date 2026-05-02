const katex = require('katex');
const { settings } = require('./settings');
const { getKatexMacros } = require('./latexMacros');

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

module.exports = { renderKatexHtml, renderKatexInto };
