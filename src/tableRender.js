const { hasLatex, splitLatexSmart } = require('./latex');
const { renderKatexInto } = require('./katexRender');

const H_BORDER = /^[┌┬┐└┴┘├┼┤─━\s]+$/;
const V_SEPS = new Set(['│', '┃']);

function getText(item) {
  return typeof item === 'string' ? item : (item.text || '');
}

function extractCellsFromRow(text) {
  const cols = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '│' || text[i] === '┃') cols.push(i);
  }
  const cells = [];
  for (let c = 0; c < cols.length - 1; c++) {
    const start = cols[c] + 1;
    const end = cols[c + 1];
    const cell = text.slice(start, end).trim();
    cells.push(cell);
  }
  return cells;
}

function isTableBorder(item) {
  const t = getText(item).trim();
  if (!t) return false;
  return H_BORDER.test(t);
}

function isTableRow(item) {
  const t = getText(item).trim();
  return t.length > 0 && V_SEPS.has(t[0]) && V_SEPS.has(t[t.length - 1]);
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
    if (part.type === 'text') tokenizeInlineMarkdownText(part.content, tokens);
    else tokens.push(part);
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

function appendInlineToken(token, parent, stack) {
  const target = stack.length ? stack[stack.length - 1].node : parent;
  if (token.type === 'marker') {
    if (token.action === 'open') {
      const node = document.createElement(token.kind);
      target.appendChild(node);
      stack.push({ kind: token.kind, node });
    } else if (token.action === 'close') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === token.kind) {
          stack.length = i;
          break;
        }
      }
    } else {
      target.appendChild(document.createTextNode(token.raw));
    }
    return;
  }

  if (token.type === 'code') {
    const code = document.createElement('code');
    code.textContent = token.content;
    target.appendChild(code);
  } else if (token.type === 'inline' && token.closed) {
    const span = document.createElement('span');
    renderKatexInto(token.content, span, false);
    target.appendChild(span);
  } else if (token.type === 'display' && token.closed) {
    const span = document.createElement('span');
    renderKatexInto(token.content, span, true);
    target.appendChild(span);
  } else if (!token.closed && token.type !== 'text') {
    const span = document.createElement('span');
    span.className = 'latex-pending';
    span.textContent = token.raw;
    target.appendChild(span);
  } else {
    target.appendChild(document.createTextNode(token.content));
  }
}

function renderInlineLatex(text) {
  const frag = document.createDocumentFragment();
  const parts = hasLatex(text) || /[*`]/.test(text)
    ? splitLatexSmart(text)
    : [{ type: 'text', content: text || '', raw: text || '' }];
  const tokens = inlineRenderTokens(parts);
  const stack = [];
  for (const token of tokens) appendInlineToken(token, frag, stack);
  return frag;
}

function hasUnclosedInlineMath(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && (i === 0 || text[i - 1] !== '\\')) count++;
  }
  return count % 2 === 1;
}

function tryParseTableBlock(lines, startIdx) {
  if (startIdx >= lines.length) return null;
  if (!isTableBorder(lines[startIdx])) return null;

  let idx = startIdx + 1;
  const rows = [];

  while (idx < lines.length) {
    if (isTableBorder(lines[idx])) {
      idx++;
      continue;
    }
    if (!isTableRow(lines[idx])) break;

    const text = getText(lines[idx]);
    const cells = extractCellsFromRow(text);
    if (cells.length < 1) { idx++; continue; }
    rows.push(cells);
    idx++;
  }

  if (rows.length === 0) return null;

  const numCols = Math.max(...rows.map(r => r.length));
  const mergedRows = [];
  let currentRow = null;

  for (const row of rows) {
    while (row.length < numCols) row.push('');

    let isContinuation = false;
    if (currentRow) {
      for (let c = 0; c < numCols; c++) {
        const prev = currentRow[c];
        if (prev && hasUnclosedInlineMath(prev)) {
          isContinuation = true;
          break;
        }
      }
    }

    if (isContinuation && currentRow) {
      for (let c = 0; c < numCols; c++) {
        if (row[c]) {
          currentRow[c] = currentRow[c] ? currentRow[c] + ' ' + row[c] : row[c];
        }
      }
    } else {
      if (currentRow) mergedRows.push(currentRow);
      currentRow = row.slice();
    }
  }
  if (currentRow) mergedRows.push(currentRow);

  const table = document.createElement('table');
  table.className = 'box-table';

  const tbody = document.createElement('tbody');
  for (let r = 0; r < mergedRows.length; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < numCols; c++) {
      const td = document.createElement('td');
      const cellText = mergedRows[r][c] || '';
      td.appendChild(renderInlineLatex(cellText));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return { element: table, endIdx: idx };
}

function parseMdCells(text) {
  let t = text.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(c => c.trim());
}

const MD_SEP = /^\|?\s*[:\-]+\s*(\|\s*[:\-]+\s*)*\|?$/;

function isMdSeparator(item) {
  const t = getText(item).trim();
  if (!t) return false;
  if (!t.includes('|')) return false;
  const cells = parseMdCells(t);
  return cells.length >= 2 && cells.every(c => /^:?-+:?$/.test(c.trim()));
}

function isMdRow(item) {
  const t = getText(item).trim();
  return t.length > 0 && t.startsWith('|') && t.endsWith('|') && t.includes('|', 1);
}

function tryParseMarkdownTable(lines, startIdx) {
  if (startIdx >= lines.length) return null;
  if (!isMdRow(lines[startIdx])) return null;

  const headerCells = parseMdCells(getText(lines[startIdx]));
  if (headerCells.length < 2) return null;
  if (startIdx + 1 >= lines.length || !isMdSeparator(lines[startIdx + 1])) return null;

  const sepCells = parseMdCells(getText(lines[startIdx + 1]));
  const alignments = sepCells.map(c => {
    const s = c.trim();
    if (s.startsWith(':') && s.endsWith(':')) return 'center';
    if (s.endsWith(':')) return 'right';
    return 'left';
  });

  let idx = startIdx + 2;
  const dataRows = [];
  while (idx < lines.length && isMdRow(lines[idx])) {
    dataRows.push(parseMdCells(getText(lines[idx])));
    idx++;
  }

  const numCols = headerCells.length;
  const table = document.createElement('table');
  table.className = 'box-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (let c = 0; c < numCols; c++) {
    const th = document.createElement('th');
    th.appendChild(renderInlineLatex(headerCells[c] || ''));
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of dataRows) {
    const tr = document.createElement('tr');
    for (let c = 0; c < numCols; c++) {
      const td = document.createElement('td');
      td.appendChild(renderInlineLatex(row[c] || ''));
      if (alignments[c] === 'right') td.style.textAlign = 'right';
      else if (alignments[c] === 'center') td.style.textAlign = 'center';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return { element: table, endIdx: idx };
}

module.exports = { isTableBorder, isTableRow, tryParseTableBlock, tryParseMarkdownTable, renderInlineLatex };
