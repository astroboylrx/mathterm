const { state, getActiveTab, updateStatusBar } = require('./state');
const { settings } = require('./settings');
const { hasLatex, splitLatexSmart, renderRichLine } = require('./latex');
const { stripAnsi, lineToColoredSpans } = require('./ansi');
const { isPromptLine } = require('./promptTrack');
const { refreshTabTitle } = require('./titleTrack');

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

function tabShowRichView(tab, auto) {
  if (tab.richVisible) return;
  tab.richVisible = true;
  tab.richAutoTriggered = !!auto;
  tab.richView.classList.add('visible');
  tab.richView.scrollTop = tab.richView.scrollHeight;
  tab.richHint.textContent = auto
    ? 'Press q to return to terminal'
    : 'Esc or Ctrl+Shift+M to return \u00b7 Select & copy freely';
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
  let blankCount = 0, foundContent = false;

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

  for (let y = startY; y <= endY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { continue; }
    if (!line) continue;
    const text = line.translateToString(true);
    if (!text.trim()) {
      if (foundContent && blankCount < 1) {
        blankCount++;
        const el = document.createElement('div'); el.className = 'rline'; el.innerHTML = '\u00a0';
        tab.richContent.appendChild(el);
      }
      continue;
    }
    blankCount = 0; foundContent = true;

    if (text.trim() === '$$') {
      let mathContent = '', j = y + 1;
      while (j <= endY) {
        let nextLine;
        try { nextLine = buf.getLine(j); } catch { break; }
        if (!nextLine) break;
        const nextText = nextLine.translateToString(true);
        if (nextText.trim() === '$$') {
          const el = document.createElement('div'); el.className = 'rline';
          const ms = document.createElement('span'); ms.className = 'display-math';
          try { require('katex').render(mathContent.trim(), ms, { displayMode:true, throwOnError:false }); }
          catch { ms.textContent = '$$\n' + mathContent + '\n$$'; }
          el.appendChild(ms); tab.richContent.appendChild(el);
          y = j; break;
        }
        mathContent += (mathContent ? '\n' : '') + nextText.trim(); j++;
      }
      if (j > endY) {
        const el = document.createElement('div'); el.className = 'rline';
        const span = document.createElement('span'); span.className = 'latex-pending';
        span.textContent = '$$' + (mathContent ? '\n'+mathContent : '');
        el.appendChild(span); tab.richContent.appendChild(el); y = j;
      }
      continue;
    }
    const el = renderLineFromBuffer(line);
    if (!el) continue;
    if (isPromptLine(tab, text, y)) el.classList.add('prompt-line');
    tab.richContent.appendChild(el);
  }
  if (foundContent) tabShowRichView(tab, true);
  tabResetSection(tab);
}

function tabFeedSection(tab, data) {
  if (!state.autoRender) return;
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
  let blankCount = 0, foundContent = false;
  let promptCount = 0;

  for (let y = 0; y <= endY; y++) {
    let line;
    try { line = buf.getLine(y); } catch { continue; }
    if (!line) continue;
    const text = line.translateToString(true);
    if (!text.trim()) {
      if (foundContent && blankCount < 1) {
        blankCount++;
        const el = document.createElement('div'); el.className = 'rline'; el.innerHTML = '\u00a0';
        tab.richContent.appendChild(el);
      }
      continue;
    }
    blankCount = 0; foundContent = true;

    if (text.trim() === '$$') {
      let mathContent = '', j = y + 1;
      while (j <= endY) {
        let nextLine;
        try { nextLine = buf.getLine(j); } catch { break; }
        if (!nextLine) break;
        const nextText = nextLine.translateToString(true);
        if (nextText.trim() === '$$') {
          const el = document.createElement('div'); el.className = 'rline';
          const ms = document.createElement('span'); ms.className = 'display-math';
          try { require('katex').render(mathContent.trim(), ms, { displayMode:true, throwOnError:false }); }
          catch { ms.textContent = '$$\n' + mathContent + '\n$$'; }
          el.appendChild(ms); tab.richContent.appendChild(el); y = j; break;
        }
        mathContent += (mathContent ? '\n' : '') + nextText.trim(); j++;
      }
      continue;
    }
    const el = renderLineFromBuffer(line);
    if (!el) continue;
    if (isPromptLine(tab, text, y)) {
      el.classList.add('prompt-line');
      promptCount++;
    }
    tab.richContent.appendChild(el);
  }
  if (foundContent) tabShowRichView(tab, false);
}

function renderFileContent(tab, content, filePath) {
  const katex = require('katex');
  tab.richContent.innerHTML = '';
  const lines = content.split('\n');
  let blankCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim() === '$$') {
      let mathContent = '';
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].trim() === '$$') {
          const el = document.createElement('div');
          el.className = 'rline';
          const mathSpan = document.createElement('span');
          mathSpan.className = 'display-math';
          try { katex.render(mathContent.trim(), mathSpan, { displayMode: true, throwOnError: false }); }
          catch { mathSpan.textContent = '$$\n' + mathContent + '\n$$'; }
          el.appendChild(mathSpan);
          tab.richContent.appendChild(el);
          i = j; break;
        }
        mathContent += (mathContent ? '\n' : '') + lines[j];
        j++;
      }
      if (j >= lines.length && lines[lines.length - 1].trim() !== '$$') {
        const el = document.createElement('div');
        el.className = 'rline';
        const span = document.createElement('span');
        span.className = 'latex-pending';
        span.textContent = '$$' + (mathContent ? '\n' + mathContent : '');
        el.appendChild(span);
        tab.richContent.appendChild(el);
        i = lines.length;
      }
      continue;
    }
    if (!text.trim()) {
      if (blankCount < 1) {
        blankCount++;
        const el = document.createElement('div');
        el.className = 'rline';
        el.innerHTML = '\u00a0';
        tab.richContent.appendChild(el);
      }
      continue;
    }
    blankCount = 0;
    const el = renderRichLine(text, text);
    tab.richContent.appendChild(el);
  }
  tabShowRichView(tab, false);
}

function tabFlushSectionOnCommandEnd(tab) {
  if (!state.autoRender) return;
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
