const { state, getActiveTab, updateStatusBar } = require('./state');
const { settings } = require('./settings');
const { hasLatex, splitLatexSmart } = require('./latex');
const { stripAnsi, lineToColoredSpans } = require('./ansi');
const { isPromptLine } = require('./promptTrack');
const { refreshTabTitle } = require('./titleTrack');
const { isTableBorder, tryParseTableBlock, tryParseMarkdownTable } = require('./tableRender');
const { renderMarkdownBlock, renderMarkdownFile } = require('./markdown');

const SECTION_BUFFER_MAX = 256 * 1024;
const SECTION_ELAPSED_MAX = 30000;

function renderLineFromBuffer(line) {
  const text = line.translateToString(true);
  if (!text.trim()) return null;
  const el = document.createElement('div');
  el.className = 'rline';
  if (hasLatex(text)) {
    const parts = splitLatexSmart(text);
    const katex = require('katex');
    for (const part of parts) {
      if (part.type === 'display' && part.closed) {
        const span = document.createElement('span');
        span.className = 'display-math';
        try { katex.render(part.content, span, { displayMode:true, throwOnError:false }); }
        catch { span.textContent = part.raw; }
        el.appendChild(span);
      } else if (part.type === 'inline' && part.closed) {
        const span = document.createElement('span');
        try { katex.render(part.content, span, { displayMode:false, throwOnError:false }); }
        catch { span.textContent = part.raw; }
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

function _t(item) { return typeof item === 'string' ? item : (item.text || ''); }

function collectBufferLines(buf, startY, endY) {
  const raw = [];
  for (let y = startY; y <= endY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { continue; }
    if (!line) continue;
    raw.push({ text: line.translateToString(true), _line: line, y, wrapped: !!line.isWrapped });
  }
  const textLines = [];
  for (const item of raw) {
    if (item.wrapped && textLines.length > 0) {
      const prev = textLines[textLines.length - 1];
      prev.text += item.text;
      prev.joined = true;
    } else {
      textLines.push({ text: item.text, _line: item._line, y: item.y });
    }
  }
  return textLines;
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

function renderRichLine(item, text, isPrompt) {
  const el = document.createElement('div');
  const trimmed = text.trimStart();
  const leading = text.length - trimmed.length;
  el.className = 'rline' + (isPrompt ? ' prompt-line' : '');

  if (/^#{1,6}\s/.test(trimmed)) {
    const level = trimmed.match(/^(#{1,6})\s/)[1].length;
    const hdr = document.createElement(`h${Math.min(level, 6)}`);
    renderInlineLatexOrMd(trimmed.slice(level + 1).trim(), hdr);
    el.appendChild(hdr);
    el.className += ' md-header';
  } else if (/^>\s/.test(trimmed)) {
    const bq = document.createElement('blockquote');
    bq.style.borderLeft = '3px solid var(--accent)';
    bq.style.paddingLeft = '8px';
    bq.style.margin = '2px 0';
    bq.style.color = 'var(--text-muted)';
    renderInlineLatexOrMd(trimmed.slice(2), bq);
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
    renderInlineLatexOrMd(trimmed.slice(2), span);
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
    renderInlineLatexOrMd(trimmed.slice(numMatch[0].length), span);
    li.appendChild(span);
    el.appendChild(li);
  } else if (hasLatex(text)) {
    renderInlineLatexToEl(text, el);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else if (typeof item === 'object' && item._line && !item.joined) {
    el.appendChild(lineToColoredSpans(item._line));
  } else {
    el.textContent = text;
  }
  return el;
}

function renderInlineLatexOrMd(text, el) {
  if (hasLatex(text)) {
    renderInlineLatexToEl(text, el);
  } else if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(text)) {
    applyInlineMarkdown(text, el);
  } else {
    el.textContent = text;
  }
}

function tryParseDisplayMath(textLines, startIdx) {
  const text = typeof textLines[startIdx] === 'string'
    ? textLines[startIdx] : (textLines[startIdx].text || '');
  const trimmed = text.trim();
  if (trimmed !== '$$') return null;

  let j = startIdx + 1;
  let mathLines = [];
  while (j < textLines.length) {
    const t = typeof textLines[j] === 'string'
      ? textLines[j] : (textLines[j].text || '');
    if (t.trim() === '$$') {
      const latex = mathLines.join('\n');
      const el = document.createElement('div');
      el.className = 'display-math';
      el.style.textAlign = 'center';
      el.style.margin = '8px 0';
      try {
        require('katex').render(latex, el, { displayMode: true, throwOnError: false });
      } catch {
        el.textContent = '$$\n' + latex + '\n$$';
      }
      return { element: el, endIdx: j + 1 };
    }
    mathLines.push(t.trimEnd());
    j++;
  }
  return null;
}

function renderLinesToContainer(textLines, container, promptLineChecker, tab) {
  let i = 0;
  let foundContent = false;

  while (i < textLines.length) {
    const item = textLines[i];
    const text = typeof item === 'string' ? item : (item.text || '');

    if (!text.trim()) { i++; continue; }

    foundContent = true;

    const tableResult = tryParseTableBlock(textLines, i)
      || tryParseMarkdownTable(textLines, i);
    if (tableResult) {
      container.appendChild(tableResult.element);
      i = tableResult.endIdx;
      continue;
    }

    const mathResult = tryParseDisplayMath(textLines, i);
    if (mathResult) {
      container.appendChild(mathResult.element);
      i = mathResult.endIdx;
      continue;
    }

    const isPrompt = typeof item === 'object' && item.y !== undefined
      && promptLineChecker && promptLineChecker(tab, text, item.y);

    container.appendChild(renderRichLine(item, text, isPrompt));
    i++;
  }
  return foundContent;
}

function renderInlineLatexToEl(text, el) {
  const parts = splitLatexSmart(text);
  for (const part of parts) {
    if (part.type === 'inline' && part.closed) {
      const span = document.createElement('span');
      try { require('katex').render(part.content, span, { displayMode: false, throwOnError: false }); }
      catch { span.textContent = part.raw; }
      el.appendChild(span);
    } else if (part.type === 'display' && part.closed) {
      const span = document.createElement('span');
      span.className = 'display-math';
      try { require('katex').render(part.content, span, { displayMode: true, throwOnError: false }); }
      catch { span.textContent = part.raw; }
      el.appendChild(span);
    } else if (!part.closed && part.type !== 'text') {
      const span = document.createElement('span');
      span.className = 'latex-pending';
      span.textContent = part.raw;
      el.appendChild(span);
    } else {
      const content = part.content;
      if (/\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`/.test(content)) {
        applyInlineMarkdown(content, el);
      } else {
        const span = document.createElement('span');
        span.textContent = content;
        el.appendChild(span);
      }
    }
  }
}

function tabShowRichView(tab, auto) {
  if (tab.richVisible) return;
  tab.richVisible = true;
  tab.richAutoTriggered = !!auto;
  tab.richView.classList.add('visible');
  tab.richView.focus();
  tab.term.blur();
  requestAnimationFrame(() => {
    tab.richView.scrollTop = tab.richView.scrollHeight > tab.richView.clientHeight + 10
      ? 0 : tab.richView.scrollHeight;
  });
  tab.richHint.textContent = auto
    ? 'Press Esc or q to return to terminal'
    : 'Esc/q/Ctrl+Shift+M to return \u00b7 Select & copy freely';
  if (tab.id === state.activeTabId) {
    updateStatusBar(tab);
  }
}

function tabHideRichView(tab) {
  if (!tab.richVisible) return;
  tab.richVisible = false;
  tab.richAutoTriggered = false;
  tab.richView.classList.remove('visible');
  if (tab.id === state.activeTabId) {
    updateStatusBar(tab);
  }
  tab.term.focus();
}

function toggleMathMode() {
  const tab = getActiveTab();
  if (!tab) return;
  if (tab.richVisible) tabHideRichView(tab);
  else showManualRichView(tab);
}

function tabResetSection(tab) {
  tab.sectionBuffer = '';
  tab.sectionHasLatex = false;
  tab.sectionStartY = 0;
  tab._sectionStartTime = 0;
}

function tabFlushSection(tab) {
  if (!tab.sectionHasLatex) { tabResetSection(tab); return; }
  const buf = tab.term.buffer.active;
  const endY = buf.baseY + buf.cursorY;
  tab.richContent.innerHTML = '';

  let startY = tab.sectionStartY;
  for (let y = tab.sectionStartY - 1; y >= Math.max(0, tab.sectionStartY - 10); y--) {
    let line;
    try { line = buf.getLine(y); } catch { break; }
    if (!line) break;
    const text = line.translateToString(true);
    if (!text.trim()) continue;
    if (isPromptLine(tab, text, y)) { startY = y; break; }
    break;
  }

  const textLines = collectBufferLines(buf, startY, endY);

  const foundContent = renderLinesToContainer(textLines, tab.richContent, isPromptLine, tab);
  if (foundContent) tabShowRichView(tab, true);
  tabResetSection(tab);
}

function tabFeedSection(tab, data) {
  if (!tab.autoRender) return;
  if (!tab.sectionBuffer) {
    const buf = tab.term.buffer.active;
    tab.sectionStartY = buf.baseY + buf.cursorY;
    tab._sectionStartTime = Date.now();
  }
  tab.sectionBuffer += data;
  if (tab.sectionBuffer.length > SECTION_BUFFER_MAX) {
    tab.sectionBuffer = tab.sectionBuffer.slice(-SECTION_BUFFER_MAX);
  }
  if (hasLatex(stripAnsi(tab.sectionBuffer))) tab.sectionHasLatex = true;
  const elapsed = Date.now() - tab._sectionStartTime;
  if (tab.sectionHasLatex && (tab.sectionBuffer.length >= SECTION_BUFFER_MAX || elapsed >= SECTION_ELAPSED_MAX)) {
    clearTimeout(tab.sectionTimer);
    tabFlushSection(tab);
  } else {
    clearTimeout(tab.sectionTimer);
    tab.sectionTimer = setTimeout(() => tabFlushSection(tab), settings.autoRenderDelay);
  }
}

function showManualRichView(tab) {
  const buf = tab.term.buffer.active;
  const endY = buf.baseY + buf.cursorY;
  tab.richContent.innerHTML = '';

  const textLines = collectBufferLines(buf, 0, endY);

  const foundContent = renderLinesToContainer(textLines, tab.richContent, isPromptLine, tab);
  if (foundContent) tabShowRichView(tab, false);
}

function renderFileContent(tab, content, filePath) {
  tab.richContent.innerHTML = '';
  const isMd = filePath && /\.md$/i.test(filePath);
  let shown = false;
  if (isMd) {
    renderMarkdownFile(content, tab.richContent);
    tabShowRichView(tab, false);
    shown = true;
  } else {
    const lines = content.split('\n');
    const foundContent = renderLinesToContainer(lines, tab.richContent, null, null);
    if (foundContent) { tabShowRichView(tab, false); shown = true; }
  }
  if (shown) {
    requestAnimationFrame(() => { tab.richView.scrollTop = 0; });
  }
}

function tabFlushSectionOnCommandEnd(tab) {
  if (!tab.autoRender) return;
  clearTimeout(tab.sectionTimer);
  if (tab.sectionHasLatex) {
    tabFlushSection(tab);
  } else {
    tabResetSection(tab);
  }
}

module.exports = {
  tabShowRichView, tabHideRichView, toggleMathMode,
  tabResetSection, tabFlushSection, tabFeedSection,
  tabFlushSectionOnCommandEnd,
  showManualRichView, renderFileContent,
  SECTION_BUFFER_MAX, SECTION_ELAPSED_MAX
};
