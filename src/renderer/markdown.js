const { Marked } = require('marked');
const createDOMPurify = require('dompurify');
const { renderKatexHtml } = require('./katexRender');

function renderKatexBlockHtml(latex, displayMode) {
  try {
    return renderKatexHtml(latex, displayMode);
  } catch {
    const span = document.createElement('span');
    if (displayMode) span.className = 'display-math';
    span.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
    return span.outerHTML;
  }
}

// marked has no notion of $$ blocks, so they are lifted out before parsing and
// put back afterwards. Both halves of that round trip need care: a $$ pair
// allowed to match anywhere joins two dollar amounts several paragraphs apart
// into one formula, and a fixed placeholder collides with source text that
// happens to contain it.

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

function fenceCloses(line, fence) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return !!match && match[1][0] === fence[0] && match[1].length >= fence.length;
}

// `$$` alone at the end of a line opens a block that runs until a lone `$$`
// line, so a body may contain blank lines. `$$` with math already on the same
// line pairs with the next `$$`, but its body may not span a blank line -- a
// blank line ends a markdown block, and that is what keeps "costs $$5" and
// "revenue $$7" two paragraphs apart from merging into one formula.
function matchDisplayMath(text, start) {
  const rest = text.slice(start + 2);
  if (/^[ \t]*(?:\n|$)/.test(rest)) {
    const close = rest.match(/\n[ \t]*\$\$[ \t]*(?=\n|$)/);
    if (!close) return null;
    return { latex: rest.slice(0, close.index), end: start + 2 + close.index + close[0].length };
  }
  const close = rest.indexOf('$$');
  if (close === -1) return null;
  const latex = rest.slice(0, close);
  if (/\n[ \t]*\n/.test(latex)) return null;
  return { latex, end: start + 2 + close + 2 };
}

function scanProseForMath(text, ctx) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const closer = '`'.repeat(n);
      const end = text.indexOf(closer, i + n);
      if (end !== -1) {
        result += text.slice(i, end + n);
        i = end + n;
        continue;
      }
      result += text.slice(i, i + n);
      i += n;
      continue;
    }
    if (text[i] === '$' && text[i + 1] === '$') {
      const span = matchDisplayMath(text, i);
      if (span) {
        const idx = ctx.map.length;
        ctx.map.push(renderKatexBlockHtml(span.latex, true));
        result += `<!--${ctx.token}${idx}-->`;
        i = span.end;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function extractDisplayMath(text, ctx) {
  const out = [];
  let prose = [];
  let fence = null;
  const flushProse = () => {
    if (!prose.length) return;
    out.push(scanProseForMath(prose.join('\n'), ctx));
    prose = [];
  };
  for (const line of text.split('\n')) {
    if (fence) {
      // Inside a fence, and inside one that is never closed, nothing is math.
      out.push(line);
      if (fenceCloses(line, fence)) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN_RE);
    if (open) {
      flushProse();
      out.push(line);
      fence = open[1];
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join('\n');
}

function restorePlaceholders(html, ctx) {
  return html.replace(new RegExp(`<!--${ctx.token}(\\d+)-->`, 'g'), (_, idx) => ctx.map[Number(idx)] || '');
}

const katexInlineExtension = {
  name: 'katexInline',
  level: 'inline',
  start(src) {
    return src.indexOf('$');
  },
  tokenizer(src) {
    // Pandoc's rule: no space just inside either delimiter, and the closing one
    // is not followed by a digit. Leaves "$5 and sells for $7" as prose.
    const match = src.match(/^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/);
    if (match) {
      return { type: 'katexInline', raw: match[0], latex: match[1] };
    }
  },
  renderer(token) {
    return renderKatexBlockHtml(token.latex, false);
  }
};

const marked = new Marked({
  extensions: [katexInlineExtension],
  breaks: true,
  gfm: true
});

// marked passes raw HTML from the source straight through, and the result goes
// to innerHTML in a renderer that holds pty.spawn and fs. A markdown file is
// untrusted input, so the output is sanitized before it can reach the DOM.
// DOMPurify's default scheme list has no `file:`, and a markdown file opened
// from disk can only reach an image by absolute file:// URL -- a relative path
// would resolve against dist/index.html, not the document. `data:` needs no
// entry here; DOMPurify allows it on media tags of its own accord.
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|file|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ALLOWED_URI_REGEXP
};

let purifier;
function sanitizeHtml(html) {
  if (purifier === undefined) {
    purifier = typeof window !== 'undefined' ? createDOMPurify(window) : null;
  }
  if (!purifier || !purifier.isSupported) {
    // Fail closed when DOMPurify is unavailable: escape the markup so it shows
    // as text. Done with string replacement rather than a detached element,
    // since the reason this branch exists is that the DOM cannot be relied on.
    return String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return purifier.sanitize(html, SANITIZE_CONFIG);
}

function renderMarkdownToHtml(text, { sanitize = true } = {}) {
  const ctx = { token: 'MT' + Math.random().toString(36).slice(2, 10), map: [] };
  const preprocessed = extractDisplayMath(String(text == null ? '' : text), ctx);
  const restored = restorePlaceholders(marked.parse(preprocessed), ctx);
  return sanitize ? sanitizeHtml(restored) : restored;
}

function renderMarkdownBlock(lines, container) {
  const text = lines.map(l => (typeof l === 'string' ? l : (l.text || ''))).join('\n');
  const wrapper = document.createElement('div');
  wrapper.className = 'md-block';
  wrapper.innerHTML = renderMarkdownToHtml(text);
  container.appendChild(wrapper);
}

function renderMarkdownFile(content, container) {
  try {
    const wrapper = document.createElement('div');
    wrapper.className = 'md-block';
    wrapper.innerHTML = renderMarkdownToHtml(content);
    container.appendChild(wrapper);
  } catch (err) {
    console.error('renderMarkdownFile error:', err);
    const pre = document.createElement('pre');
    pre.textContent = content;
    container.appendChild(pre);
  }
}

module.exports = { renderMarkdownToHtml, renderMarkdownBlock, renderMarkdownFile };
