function stripLatexComments(source) {
  return String(source || '').split('\n').map(line => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '%' && line[i - 1] !== '\\') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

function readBrace(text, i) {
  i = skipWs(text, i);
  if (text[i] !== '{') return null;
  let depth = 1;
  let out = '';
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') {
      out += ch;
      if (j + 1 < text.length) out += text[++j];
      continue;
    }
    if (ch === '{') {
      depth++;
      out += ch;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) return { value: out, end: j + 1 };
      out += ch;
      continue;
    }
    out += ch;
  }
  return null;
}

function readOptionalBracket(text, i) {
  i = skipWs(text, i);
  if (text[i] !== '[') return null;
  const end = text.indexOf(']', i + 1);
  if (end === -1) return null;
  return { value: text.slice(i + 1, end), end: end + 1 };
}

function readMacroName(text, i) {
  i = skipWs(text, i);
  if (text[i] === '{') {
    const braced = readBrace(text, i);
    if (!braced) return null;
    const name = braced.value.trim();
    return /^\\[A-Za-z@]+$/.test(name) ? { name, end: braced.end } : null;
  }
  if (text[i] !== '\\') return null;
  let end = i + 1;
  if (/[A-Za-z@]/.test(text[end] || '')) {
    while (/[A-Za-z@]/.test(text[end] || '')) end++;
  } else {
    end++;
  }
  return { name: text.slice(i, end), end };
}

function parseNewCommandAt(text, i) {
  const cmd = text.slice(i).match(/^\\(?:(?:re)?newcommand|providecommand)\*?/);
  if (!cmd) return null;
  let pos = i + cmd[0].length;
  const macro = readMacroName(text, pos);
  if (!macro) return null;
  pos = macro.end;
  const argc = readOptionalBracket(text, pos);
  if (argc) pos = argc.end;
  const defaultArg = readOptionalBracket(text, pos);
  if (defaultArg) pos = defaultArg.end;
  const replacement = readBrace(text, pos);
  if (!replacement) return null;
  return { name: macro.name, value: replacement.value, end: replacement.end };
}

function parseDefAt(text, i) {
  const cmd = text.slice(i).match(/^\\(?:gdef|def)/);
  if (!cmd) return null;
  let pos = i + cmd[0].length;
  const macro = readMacroName(text, pos);
  if (!macro) return null;
  pos = macro.end;
  while (pos < text.length && text[pos] !== '{') {
    pos++;
  }
  const replacement = readBrace(text, pos);
  if (!replacement) return null;
  return { name: macro.name, value: replacement.value, end: replacement.end };
}

function parseLatexMacros(source) {
  const text = stripLatexComments(source);
  const macros = {};
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') continue;
    const parsed = parseNewCommandAt(text, i) || parseDefAt(text, i);
    if (!parsed) continue;
    macros[parsed.name] = parsed.value;
    i = parsed.end - 1;
  }
  return macros;
}

let _source = null;
let _macros = {};

function getKatexMacros(source) {
  const next = String(source || '');
  if (next !== _source) {
    _source = next;
    _macros = parseLatexMacros(next);
  }
  return _macros;
}

module.exports = {
  parseLatexMacros,
  getKatexMacros,
};
