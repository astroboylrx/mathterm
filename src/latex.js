const katex = require('katex');
const { parseAnsiToSpans } = require('./ansi');

const LATEX_COMMANDS = /\\(?:frac|sqrt|sum|int|nabla|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Omega|cdot|times|div|mathbb|mathcal|mathrm|mathbf|text|begin|end|left|right|overline|hat|vec|bar|dot|tilde|infty|forall|exists|leq|geq|neq|approx|equiv|sim|propto|subset|supset|cup|cap|emptyset|quad|hbar|to|rightarrow|leftarrow|Rightarrow|iff|binom|pm|mp|circ|angle|ell)/;

function findBalancedShellEnd(text, start, opener, closer) {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

function findNextUnescapedDollar(text, pos) {
  let idx = text.indexOf('$', pos);
  while (idx !== -1 && isEscapedDollar(text, idx)) idx = text.indexOf('$', idx + 1);
  return idx;
}

function hasStrongInlineMathSignal(inner) {
  const trimmed = inner.trim();
  if (/^[a-z]$/.test(trimmed)) return true;
  if (LATEX_COMMANDS.test(trimmed)) return true;
  if (/[_^]/.test(trimmed)) return true;
  if (/\\/.test(trimmed)) return true;
  return /[A-Za-z0-9]\s*[=+\-*/<>]\s*[A-Za-z0-9]/.test(trimmed);
}

function parseShellDollar(text, pos) {
  if (text[pos] !== '$' || isEscapedDollar(text, pos)) return null;
  const next = text[pos + 1] || '';
  if (/[$?!#*@-]/.test(next)) return { raw: text.slice(pos, pos + 2), end: pos + 2, kind: 'special' };
  if (/[0-9]/.test(next)) {
    let end = pos + 2;
    while (/[0-9]/.test(text[end] || '')) end++;
    return { raw: text.slice(pos, end), end, kind: 'positional' };
  }
  if (/[A-Za-z_]/.test(next)) {
    let end = pos + 2;
    while (/[A-Za-z0-9_]/.test(text[end] || '')) end++;
    if (pos >= 2 && text[pos - 1] === '{' && text[pos - 2] === '%') {
      return { raw: text.slice(pos, end), end, kind: 'zsh-prompt-variable' };
    }
    const closing = findNextUnescapedDollar(text, end);
    const pairedInner = closing === -1 ? '' : text.slice(pos + 1, closing);
    if (/[;]/.test(pairedInner) || /\b(?:export|local|typeset|declare)\b/.test(pairedInner)) {
      return { raw: text.slice(pos, end), end, kind: 'variable' };
    }
    if (closing !== -1 && hasStrongInlineMathSignal(text.slice(pos + 1, closing))) return null;
    return { raw: text.slice(pos, end), end, kind: 'variable' };
  }
  if (next === '{') {
    const end = findBalancedShellEnd(text, pos + 2, '{', '}');
    if (end !== -1) return { raw: text.slice(pos, end), end, kind: 'braced' };
  }
  if (next === '(' && text[pos + 2] === '(') {
    const end = text.indexOf('))', pos + 3);
    if (end !== -1) return { raw: text.slice(pos, end + 2), end: end + 2, kind: 'arithmetic' };
  }
  if (next === '(') {
    const end = findBalancedShellEnd(text, pos + 2, '(', ')');
    if (end !== -1) return { raw: text.slice(pos, end), end, kind: 'command' };
  }
  return null;
}

function stripClosedCodeSpans(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      result += text[i];
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;
    const closer = '`'.repeat(n);
    const end = text.indexOf(closer, i + n);
    if (end === -1) {
      result += text.slice(i);
      break;
    }
    result += ' '.repeat(end + n - i);
    i = end + n;
  }
  return result;
}

function hasLatex(text) {
  text = stripClosedCodeSpans(text);
  if (/\\\[.*?\\\]/s.test(text)) return true;
  if (/\\\(.*?\\\)/s.test(text)) return true;
  for (const part of splitLatexSmart(text)) {
    if (part.type !== 'inline' && part.type !== 'display') continue;
    if (!part.closed) continue;
    const inner = part.content || '';
    if (!inner.trim()) continue;
    if (LATEX_COMMANDS.test(inner)) return true;
    if (/[_^]\{/.test(inner)) return true;
    if (/[_^][0-9a-zA-Z]/.test(inner)) return true;
    if (/\\/.test(inner) && inner.length > 2) return true;
    if (/^[0-9a-zA-Z+\-*/().,=<>!\s\\^_{}]+$/.test(inner)) return true;
  }
  return false;
}

function isEscapedDollar(text, pos) {
  let bs = 0;
  let p = pos - 1;
  while (p >= 0 && text[p] === '\\') { bs++; p--; }
  return bs % 2 === 1;
}

function splitLatexSmart(text) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      let n = 0;
      while (text[i+n] === '`') n++;
      const closer = '`'.repeat(n);
      const end = text.indexOf(closer, i + n);
      if (end !== -1) {
        parts.push({ type:'code', closed:true, content:text.slice(i+n, end), raw:text.slice(i, end+n) });
        i = end + n;
      } else {
        parts.push({ type:'text', content:text.slice(i, i+n), raw:text.slice(i, i+n) });
        i += n;
      }
    } else if (text[i] === '\\' && text[i+1] === '(' ) {
      const end = text.indexOf('\\)', i + 2);
      if (end !== -1) {
        parts.push({ type:'inline', closed:true, content:text.slice(i+2,end), raw:text.slice(i,end+2) });
        i = end + 2;
      } else {
        parts.push({ type:'inline', closed:false, content:text.slice(i+2), raw:text.slice(i) });
        i = text.length;
      }
    } else if (text[i] === '\\' && text[i+1] === '[') {
      const end = text.indexOf('\\]', i + 2);
      if (end !== -1) {
        parts.push({ type:'display', closed:true, content:text.slice(i+2,end), raw:text.slice(i,end+2) });
        i = end + 2;
      } else {
        parts.push({ type:'display', closed:false, content:text.slice(i+2), raw:text.slice(i) });
        i = text.length;
      }
    } else if (text[i] === '$' && text[i+1] === '$' && text[i+2] === '$' && text[i+3] === '$' && !isEscapedDollar(text, i)) {
      const shellFirst = parseShellDollar(text, i);
      const shellSecond = parseShellDollar(text, shellFirst ? shellFirst.end : i + 2);
      if (shellFirst && shellSecond) {
        parts.push({ type:'text', content:shellFirst.raw + shellSecond.raw, raw:shellFirst.raw + shellSecond.raw });
        i = shellSecond.end;
      } else {
        parts.push({ type:'display', closed:true, content:'', raw:'$$$$' });
        i += 4;
      }
    } else if (text[i] === '$' && text[i+1] === '$' && !isEscapedDollar(text, i)) {
      const end = text.indexOf('$$', i+2);
      if (end !== -1) {
        parts.push({ type:'display', closed:true, content:text.slice(i+2,end), raw:text.slice(i,end+2) });
        i = end+2;
      } else {
        parts.push({ type:'text', content:'$$', raw:'$$' });
        i += 2;
      }
    } else if (text[i] === '$' && !isEscapedDollar(text, i)) {
      const shellDollar = parseShellDollar(text, i);
      if (shellDollar) {
        parts.push({ type:'text', content:shellDollar.raw, raw:shellDollar.raw });
        i = shellDollar.end;
        continue;
      }
      const end = text.indexOf('$', i+1);
      if (end !== -1 && end > i+1 && !isEscapedDollar(text, end)) {
        parts.push({ type:'inline', closed:true, content:text.slice(i+1,end), raw:text.slice(i,end+1) });
        i = end+1;
      } else if (end === -1) {
        parts.push({ type:'inline', closed:false, content:text.slice(i+1), raw:text.slice(i) });
        i = text.length;
      } else {
        parts.push({ type:'text', content:'$', raw:'$' }); i++;
      }
    } else if (text[i] === '$') {
      parts.push({ type:'text', content:'$', raw:'$' });
      i++;
    } else {
      const next = text.indexOf('$', i);
      const np = text.indexOf('\\(', i);
      const nb = text.indexOf('\\[', i);
      const ng = text.indexOf('`', i);
      let end = text.length;
      if (next !== -1) end = Math.min(end, next);
      if (np !== -1) end = Math.min(end, np);
      if (nb !== -1) end = Math.min(end, nb);
      if (ng !== -1) end = Math.min(end, ng);
      parts.push({ type:'text', content:text.slice(i,end), raw:text.slice(i,end) });
      i = end;
    }
  }
  return parts;
}

module.exports = { hasLatex, splitLatexSmart, LATEX_COMMANDS };
