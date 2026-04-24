const katex = require('katex');
const { parseAnsiToSpans } = require('./ansi');

const LATEX_COMMANDS = /\\(?:frac|sqrt|sum|int|nabla|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Omega|cdot|times|div|mathbb|mathcal|mathrm|mathbf|text|begin|end|left|right|overline|hat|vec|bar|dot|tilde|infty|forall|exists|leq|geq|neq|approx|equiv|sim|propto|subset|supset|cup|cap|emptyset|quad|hbar|to|rightarrow|leftarrow|Rightarrow|iff|binom|pm|mp|circ|angle|ell)/;

function hasLatex(text) {
  if (/\\\[.*?\\\]/s.test(text)) return true;
  if (/\\\(.*?\\\)/s.test(text)) return true;
  if (/\$\$[\s\S]*?\$\$/.test(text)) return true;
  if (/\$\$/.test(text) && (text.match(/\$\$/g)||[]).length >= 2) return true;
  const matches = text.match(/\$([^$\n]+)\$/g);
  if (matches) {
    for (const m of matches) {
      const inner = m.slice(1,-1);
      if (!inner.trim()) continue;
      if (LATEX_COMMANDS.test(inner)) return true;
      if (/[_^]\{/.test(inner)) return true;
      if (/[_^][0-9a-zA-Z]/.test(inner)) return true;
      if (/\\/.test(inner) && inner.length > 2) return true;
      if (/^[0-9a-zA-Z+\-*/().,=<>!\s\\^_{}]+$/.test(inner)) return true;
    }
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
    if (text[i] === '\\' && text[i+1] === '(' ) {
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
    } else if (text[i] === '$' && text[i+1] === '$' && !isEscapedDollar(text, i)) {
      const end = text.indexOf('$$', i+2);
      if (end !== -1) {
        parts.push({ type:'display', closed:true, content:text.slice(i+2,end), raw:text.slice(i,end+2) });
        i = end+2;
      } else {
        parts.push({ type:'display', closed:false, content:text.slice(i+2), raw:text.slice(i) });
        i = text.length;
      }
    } else if (text[i] === '$' && !isEscapedDollar(text, i)) {
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
    } else {
      const next = text.indexOf('$', i);
      const np = text.indexOf('\\(', i);
      const nb = text.indexOf('\\[', i);
      let end = text.length;
      if (next !== -1) end = Math.min(end, next);
      if (np !== -1) end = Math.min(end, np);
      if (nb !== -1) end = Math.min(end, nb);
      parts.push({ type:'text', content:text.slice(i,end), raw:text.slice(i,end) });
      i = end;
    }
  }
  return parts;
}

module.exports = { hasLatex, splitLatexSmart, LATEX_COMMANDS };
