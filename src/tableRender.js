const katex = require('katex');
const { hasLatex, splitLatexSmart } = require('./latex');

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

function renderInlineLatex(text) {
  if (!text || !hasLatex(text)) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }
  const frag = document.createDocumentFragment();
  const parts = splitLatexSmart(text);
  for (const part of parts) {
    if (part.type === 'inline' && part.closed) {
      const span = document.createElement('span');
      try { katex.render(part.content, span, { displayMode: false, throwOnError: false }); }
      catch { span.textContent = part.raw; }
      frag.appendChild(span);
    } else if (part.type === 'display' && part.closed) {
      const span = document.createElement('span');
      try { katex.render(part.content, span, { displayMode: true, throwOnError: false }); }
      catch { span.textContent = part.raw; }
      frag.appendChild(span);
    } else if (!part.closed && part.type !== 'text') {
      const span = document.createElement('span');
      span.className = 'latex-pending';
      span.textContent = part.raw;
      frag.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.textContent = part.content;
      frag.appendChild(span);
    }
  }
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

module.exports = { isTableBorder, isTableRow, tryParseTableBlock, renderInlineLatex };
