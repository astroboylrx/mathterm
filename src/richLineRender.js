const { hasLatex, splitLatexSmart } = require('./latex');
const { lineToColoredSpans } = require('./ansi');
const { queueKatex } = require('./richKatexQueue');

function renderLineFromBuffer(line) {
  const text = line.translateToString(true);
  if (!text.trim()) return null;
  const el = document.createElement('div');
  el.className = 'rline';
  if (hasLatex(text)) {
    const parts = splitLatexSmart(text);
    for (const part of parts) {
      if (part.type === 'code') {
        const code = document.createElement('code');
        code.textContent = part.content;
        el.appendChild(code);
      } else if (part.type === 'display' && part.closed) {
        const span = document.createElement('span');
        span.className = 'display-math';
        queueKatex(part.content, span, true);
        el.appendChild(span);
      } else if (part.type === 'inline' && part.closed) {
        const span = document.createElement('span');
        queueKatex(part.content, span, false);
        el.appendChild(span);
      } else if (!part.closed && part.type !== 'text') {
        const span = document.createElement('span');
        span.className = 'latex-pending';
        span.textContent = part.raw;
        el.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.textContent = part.content;
        el.appendChild(span);
      }
    }
  } else {
    el.appendChild(lineToColoredSpans(line));
  }
  return el;
}

function applyInlineMarkdown(text, el) {
  const parts = [];
  let rest = text;
  const re = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(``.*?``)/;
  while (rest) {
    const m = rest.match(re);
    if (!m) { parts.push({ type: 'text', value: rest }); break; }
    const idx = m.index;
    if (idx > 0) parts.push({ type: 'text', value: rest.slice(0, idx) });
    const raw = m[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      parts.push({ type: 'strong', value: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      parts.push({ type: 'code', value: raw.replace(/^`+|`+$/g, '') });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      parts.push({ type: 'em', value: raw.slice(1, -1) });
    }
    rest = rest.slice(idx + raw.length);
  }
  for (const p of parts) {
    let node;
    if (p.type === 'strong') { node = document.createElement('strong'); node.textContent = p.value; }
    else if (p.type === 'em') { node = document.createElement('em'); node.textContent = p.value; }
    else if (p.type === 'code') { node = document.createElement('code'); node.textContent = p.value; }
    else { node = document.createTextNode(p.value); }
    el.appendChild(node);
  }
}

// Horizontals + dashed + tees, but NOT corners or verticals; corners signal a
// box border (top/bottom edge), which we want to keep as literal text.
const BOX_RULE_RE = /^[─━┄┅┈┉╌╍═├┤┬┴┼\s]+$/;

function isBoxRule(text) {
  const t = text.trim();
  return t.length >= 6 && BOX_RULE_RE.test(t);
}

function filePathToUrl(filePath) {
  if (!filePath.startsWith('/')) return '';
  return 'file://' + filePath.split('/').map(encodeURIComponent).join('/');
}

function markdownImageTargetToSrc(target) {
  let src = target.trim();
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
  const titleMatch = src.match(/^(.*?)\s+["'][^"']*["']$/);
  if (titleMatch) src = titleMatch[1].trim();
  if (!/\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(src)) return '';
  if (/^(?:https?:|data:image\/)/i.test(src)) return src;
  if (src.startsWith('file://')) return src;
  if (src.startsWith('/')
    && typeof window.mathterm?.fs?.existsSync === 'function'
    && window.mathterm.fs.existsSync(src)) return filePathToUrl(src);
  return '';
}

function renderMarkdownImageLine(item, text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
  if (!match) return null;
  const src = markdownImageTargetToSrc(match[2]);
  if (!src) return null;

  const wrap = document.createElement('div');
  wrap.className = 'rline markdown-image-line';
  if (typeof item === 'object' && item.y !== undefined) {
    wrap.dataset.y = item.y;
    wrap.dataset.yEnd = item.yEnd !== undefined ? item.yEnd : item.y;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = match[1] || 'image';
  img.loading = 'lazy';
  wrap.appendChild(img);
  if (match[1]) {
    const caption = document.createElement('div');
    caption.className = 'markdown-image-caption';
    caption.textContent = match[1];
    wrap.appendChild(caption);
  }
  return wrap;
}

function renderRichLine(item, text, isPrompt, opts) {
  const imageEl = renderMarkdownImageLine(item, text);
  if (imageEl) return imageEl;

  const el = document.createElement('div');
  if (typeof item === 'object' && item.y !== undefined) {
    el.dataset.y = item.y;
    el.dataset.yEnd = item.yEnd !== undefined ? item.yEnd : item.y;
  }
  const trimmed = text.trimStart();
  el.className = 'rline' + (isPrompt ? ' prompt-line' : '');

  if (!isPrompt && isBoxRule(text)) {
    el.className = 'rline rule';
    el.style.width = text.trim().length + 'ch';
    return el;
  }

  if (/^#{1,6}\s/.test(trimmed)) {
    const level = trimmed.match(/^(#{1,6})\s/)[1].length;
    const hdr = document.createElement(`h${Math.min(level, 6)}`);
    renderInlineLatexOrMd(trimmed.slice(level + 1).trim(), hdr, opts);
    el.appendChild(hdr);
    el.className += ' md-header';
  } else if (/^>\s/.test(trimmed)) {
    const bq = document.createElement('blockquote');
    bq.style.borderLeft = '3px solid var(--accent)';
    bq.style.paddingLeft = '8px';
    bq.style.margin = '2px 0';
    bq.style.color = 'var(--fg-muted)';
    renderInlineLatexOrMd(trimmed.slice(2), bq, opts);
    el.appendChild(bq);
  } else if (/^[-*]\s/.test(trimmed)) {
    const li = document.createElement('div');
    li.style.paddingLeft = '16px';
    li.style.position = 'relative';
    const bullet = document.createElement('span');
    bullet.textContent = trimmed[0] === '*' ? '•' : '•';
    bullet.style.position = 'absolute';
    bullet.style.left = '4px';
    li.appendChild(bullet);
    const span = document.createElement('span');
    span.style.paddingLeft = '12px';
    renderInlineLatexOrMd(trimmed.slice(2), span, opts);
    li.appendChild(span);
    el.appendChild(li);
  } else if (/^\d+\.\s/.test(trimmed)) {
    const numMatch = trimmed.match(/^(\d+\.)\s/);
    const li = document.createElement('div');
    li.style.paddingLeft = '16px';
    li.style.position = 'relative';
    const num = document.createElement('span');
    num.textContent = numMatch[1];
    num.style.position = 'absolute';
    num.style.left = '0';
    num.style.fontWeight = 'bold';
    li.appendChild(num);
    const span = document.createElement('span');
    span.style.paddingLeft = (numMatch[1].length + 1) + 'ch';
    renderInlineLatexOrMd(trimmed.slice(numMatch[0].length), span, opts);
    li.appendChild(span);
    el.appendChild(li);
  } else if (hasLatex(text)) {
    renderInlineLatexToEl(text, el, opts);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else if (typeof item === 'object' && item._line && !item.joined) {
    el.appendChild(lineToColoredSpans(item._line));
  } else {
    el.textContent = text;
  }
  return el;
}

function renderInlineLatexOrMd(text, el, opts) {
  if (hasLatex(text)) {
    renderInlineLatexToEl(text, el, opts);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else {
    el.textContent = text;
  }
}

function tokenizeInlineMarkdownText(text, tokens) {
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const isStrong = text[i] === '*' && text[i + 1] === '*';
    const isEm = text[i] === '*' && text[i + 1] !== '*' && text[i - 1] !== '*';
    if (!isStrong && !isEm) {
      i++;
      continue;
    }
    if (i > start) tokens.push({ type: 'text', content: text.slice(start, i) });
    if (isStrong) {
      tokens.push({ type: 'marker', kind: 'strong', raw: '**' });
      i += 2;
    } else {
      tokens.push({ type: 'marker', kind: 'em', raw: '*' });
      i++;
    }
    start = i;
  }
  if (start < text.length) tokens.push({ type: 'text', content: text.slice(start) });
}

function inlineRenderTokens(parts) {
  const tokens = [];
  for (const part of parts) {
    if (part.type === 'text') {
      tokenizeInlineMarkdownText(part.content, tokens);
    } else {
      tokens.push(part);
    }
  }

  const open = { strong: [], em: [] };
  for (const token of tokens) {
    if (token.type !== 'marker') continue;
    const stack = open[token.kind];
    if (stack.length > 0) {
      const opener = stack.pop();
      opener.action = 'open';
      token.action = 'close';
    } else {
      stack.push(token);
    }
  }
  for (const kind of Object.keys(open)) {
    for (const token of open[kind]) {
      token.type = 'text';
      token.content = token.raw;
    }
  }
  return tokens;
}

function appendInlineToken(token, el, stack, opts) {
  const parent = stack.length ? stack[stack.length - 1].node : el;
  if (token.type === 'marker') {
    if (token.action === 'open') {
      const node = document.createElement(token.kind);
      parent.appendChild(node);
      stack.push({ kind: token.kind, node });
    } else if (token.action === 'close') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === token.kind) {
          stack.length = i;
          break;
        }
      }
    } else {
      parent.appendChild(document.createTextNode(token.raw));
    }
    return;
  }
  if (token.type === 'code') {
    const code = document.createElement('code');
    code.textContent = token.content;
    parent.appendChild(code);
  } else if (token.type === 'inline' && token.closed) {
    const span = document.createElement('span');
    queueKatex(token.content, span, false, opts);
    parent.appendChild(span);
  } else if (token.type === 'display' && token.closed) {
    const span = document.createElement('span');
    span.className = 'display-math';
    queueKatex(token.content, span, true, opts);
    parent.appendChild(span);
  } else if (!token.closed && token.type !== 'text') {
    const span = document.createElement('span');
    span.className = 'latex-pending';
    span.textContent = token.raw;
    parent.appendChild(span);
  } else {
    parent.appendChild(document.createTextNode(token.content));
  }
}

function renderInlineLatexToEl(text, el, opts) {
  const tokens = inlineRenderTokens(splitLatexSmart(text));
  const stack = [];
  for (const token of tokens) appendInlineToken(token, el, stack, opts);
}

module.exports = {
  renderLineFromBuffer,
  renderRichLine,
  isBoxRule,
  renderInlineLatexOrMd,
  renderInlineLatexToEl,
  applyInlineMarkdown,
  tokenizeInlineMarkdownText,
  inlineRenderTokens,
  appendInlineToken,
  renderMarkdownImageLine,
  markdownImageTargetToSrc,
  filePathToUrl,
  BOX_RULE_RE
};
