const MATH_SYMBOLS = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\phi': 'φ',
  '\\varphi': 'φ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Phi': 'Φ',
  '\\Omega': 'Ω'
};

function isAsciiLetter(ch) {
  return /^[A-Za-z]$/.test(ch);
}

function normalizeMathSearchText(text) {
  const source = String(text || '');
  let normalizedText = '';
  const map = [];

  for (let i = 0; i < source.length;) {
    if (source[i] === '\\' && isAsciiLetter(source[i + 1] || '')) {
      let end = i + 2;
      while (end < source.length && isAsciiLetter(source[end])) end++;
      const command = source.slice(i, end);
      const replacement = MATH_SYMBOLS[command];
      if (replacement) {
        normalizedText += replacement;
        for (let j = 0; j < replacement.length; j++) {
          map.push({ col: i, length: command.length });
        }
        i = end;
        continue;
      }
    }

    normalizedText += source[i];
    map.push({ col: i, length: 1 });
    i++;
  }

  return { normalizedText, map };
}

function getCachedNormalizedLine(line, cache) {
  if (!cache || line.y === undefined || line.y === null) {
    return normalizeMathSearchText(line.text);
  }
  const prev = cache.get(line.y);
  if (prev && prev.raw === line.text) return prev;
  const normalized = normalizeMathSearchText(line.text);
  const entry = { raw: line.text, ...normalized };
  cache.set(line.y, entry);
  return entry;
}

function findCaseInsensitive(text, query, onMatch) {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  let col = 0;
  while (col <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, col);
    if (found === -1) break;
    onMatch(found);
    col = found + Math.max(1, needle.length);
  }
}

function isLatexCommandQuery(query) {
  return /^\\[A-Za-z]+$/.test(query);
}

function isMathUnicodeQuery(query) {
  return Object.values(MATH_SYMBOLS).includes(query);
}

function isInsideLatexCommand(text, index) {
  let start = index;
  while (start > 0 && isAsciiLetter(text[start - 1])) start--;
  return start > 0 && text[start - 1] === '\\';
}

function rawMatchAllowed(text, query, index) {
  if (isLatexCommandQuery(query)) {
    return !isAsciiLetter(text[index + query.length] || '');
  }
  if (/^[A-Za-z]+$/.test(query) && isInsideLatexCommand(text, index)) {
    return false;
  }
  return true;
}

function findCaseSensitive(text, query, onMatch) {
  let col = 0;
  while (col <= text.length - query.length) {
    const found = text.indexOf(query, col);
    if (found === -1) break;
    onMatch(found);
    col = found + Math.max(1, query.length);
  }
}

function findRawMatches(text, query, onMatch) {
  if (isLatexCommandQuery(query) || isMathUnicodeQuery(query)) {
    findCaseSensitive(text, query, onMatch);
  } else {
    findCaseInsensitive(text, query, onMatch);
  }
}

function addMatch(matches, seen, line, col, length, normalized) {
  const key = `${line.y}:${col}:${length}`;
  if (seen.has(key)) return;
  seen.add(key);
  matches.push({
    y: line.y,
    col,
    length,
    text: line.text.slice(col, col + length),
    ...(normalized !== undefined ? { normalized } : {})
  });
}

function normalizedSpanFor(map, index, length) {
  if (!map[index] || !map[index + length - 1]) return null;
  const start = map[index];
  const end = map[index + length - 1];
  return {
    col: start.col,
    length: end.col + end.length - start.col
  };
}

function collectRichSearchMatches(lines, query, opts = {}) {
  const q = String(query || '');
  if (!q) return [];

  const matches = [];
  const seen = new Set();
  const symbolSearch = opts.mathSymbolSearch !== false;
  const normalizeCache = opts.normalizeCache || null;

  const sourceLines = lines || [];
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    const rawLine = sourceLines[lineIndex];
    const line = typeof rawLine === 'string'
      ? { y: lineIndex, text: rawLine }
      : { y: rawLine.y, text: String(rawLine.text || '') };
    if (line.y === undefined || line.y === null) continue;

    findRawMatches(line.text, q, col => {
      if (!rawMatchAllowed(line.text, q, col)) return;
      addMatch(matches, seen, line, col, q.length);
    });

    if (!symbolSearch) continue;

    const sourceNorm = getCachedNormalizedLine(line, normalizeCache);
    const queryNorm = normalizeMathSearchText(q);
    const normalizedNeedle = queryNorm.normalizedText;
    if (!normalizedNeedle) continue;

    findCaseSensitive(sourceNorm.normalizedText, normalizedNeedle, index => {
      const span = normalizedSpanFor(sourceNorm.map, index, normalizedNeedle.length);
      if (!span) return;
      addMatch(
        matches,
        seen,
        line,
        span.col,
        span.length,
        sourceNorm.normalizedText.slice(index, index + normalizedNeedle.length)
      );
    });
  }

  matches.sort((a, b) => a.y - b.y || a.col - b.col || a.length - b.length);
  return matches;
}

module.exports = {
  MATH_SYMBOLS,
  normalizeMathSearchText,
  collectRichSearchMatches
};
