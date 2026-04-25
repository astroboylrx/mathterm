const { Marked } = require('marked');
const katex = require('katex');

function renderKatexHtml(latex, displayMode) {
  const span = document.createElement('span');
  if (displayMode) span.className = 'display-math';
  try {
    katex.render(latex, span, { displayMode, throwOnError: false });
  } catch {
    span.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
  }
  return span.outerHTML;
}

const PLACEHOLDER_PREFIX = '<!--MATH';
const PLACEHOLDER_SUFFIX = '-->';

let placeholderMap = [];

function extractDisplayMath(text) {
  placeholderMap = [];
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      let n = 0;
      while (text[i+n] === '`') n++;
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
    if (text[i] === '$' && text[i+1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const latex = text.slice(i + 2, end);
        const idx = placeholderMap.length;
        placeholderMap.push(renderKatexHtml(latex, true));
        result += `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
        i = end + 2;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function restorePlaceholders(html) {
  return html.replace(/<!--MATH(\d+)-->/g, (_, idx) => {
    return placeholderMap[parseInt(idx)] || '';
  });
}

const katexInlineExtension = {
  name: 'katexInline',
  level: 'inline',
  start(src) {
    return src.indexOf('$');
  },
  tokenizer(src) {
    const match = src.match(/^\$([^\$\n]+?)\$/);
    if (match) {
      return { type: 'katexInline', raw: match[0], latex: match[1] };
    }
  },
  renderer(token) {
    return renderKatexHtml(token.latex, false);
  }
};

const marked = new Marked({
  extensions: [katexInlineExtension],
  breaks: true,
  gfm: true
});

function renderMarkdownToHtml(text) {
  const preprocessed = extractDisplayMath(text);
  const parsed = marked.parse(preprocessed);
  return restorePlaceholders(parsed);
}

function renderMarkdownBlock(lines, container) {
  const text = lines.map(l => (typeof l === 'string' ? l : (l.text || ''))).join('\n');
  const html = renderMarkdownToHtml(text);
  const wrapper = document.createElement('div');
  wrapper.className = 'md-block';
  wrapper.innerHTML = html;
  container.appendChild(wrapper);
}

function renderMarkdownFile(content, container) {
  try {
    const html = renderMarkdownToHtml(content);
    const wrapper = document.createElement('div');
    wrapper.className = 'md-block';
    wrapper.innerHTML = html;
    container.appendChild(wrapper);
  } catch (err) {
    console.error('renderMarkdownFile error:', err);
    const pre = document.createElement('pre');
    pre.textContent = content;
    container.appendChild(pre);
  }
}

module.exports = { renderMarkdownToHtml, renderMarkdownBlock, renderMarkdownFile };
