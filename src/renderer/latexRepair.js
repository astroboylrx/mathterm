// Rewrites applied to a display-math block before KaTeX sees it.

const ENV_TOKEN_RE = /\\(begin|end)\{([a-zA-Z*]+)\}/g;

// KaTeX has no \label and lacks a few display environments common in papers;
// rewrite those to the nearest ones it has so a cat'ed .tex block renders.
function prepareDisplayLatex(latex) {
  return String(latex)
    .replace(/\\label\{[^{}]*\}/g, '')
    .replace(/\\(?:begin|end)\{displaymath\}/g, '')
    .replace(/\\begin\{eqnarray\*?\}/g, '\\begin{array}{rcl}')
    .replace(/\\end\{eqnarray\*?\}/g, '\\end{array}')
    .replace(/\\(begin|end)\{multline(\*?)\}/g, '\\$1{gather$2}')
    .replace(/\\(begin|end)\{flalign(\*?)\}/g, '\\$1{align$2}');
}

const SIZED_DELIM_RE = /\\(left|right)\s*(\\[a-zA-Z]+|\\[{}|]|[()[\]|./<>])/g;

// \left / \right whose partner is out of view become the plain delimiter.
// Adding the missing half instead does not work: once the rows are wrapped in
// an aligned environment the two halves sit in different cells.
function neutralizeUnmatchedDelims(s) {
  const stack = [];
  const unmatched = new Set();
  for (const m of s.matchAll(SIZED_DELIM_RE)) {
    if (m[1] === 'left') stack.push(m.index);
    else if (stack.length) stack.pop();
    else unmatched.add(m.index);
  }
  for (const i of stack) unmatched.add(i);
  return s.replace(SIZED_DELIM_RE, (whole, _side, delim, offset) => {
    if (!unmatched.has(offset)) return whole;
    return delim === '.' ? '' : delim;
  });
}

// A block the view cut into -- it starts past its opener or stops before its
// closer -- is missing pieces KaTeX insists on. Best effort: drop an \end whose
// \begin is out of view, close a \begin whose \end is, turn a \left / \right
// whose partner is out of view into a plain delimiter, and give bare `&` / `\\`
// rows an aligned environment.
function repairPartialLatex(latex) {
  let s = String(latex);
  const open = [];
  const orphans = [];
  for (const m of s.matchAll(ENV_TOKEN_RE)) {
    if (m[1] === 'begin') open.push(m[2]);
    else if (open.length && open[open.length - 1] === m[2]) open.pop();
    else orphans.push(m);
  }
  for (let k = orphans.length - 1; k >= 0; k--) {
    const m = orphans[k];
    s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
  }
  for (let k = open.length - 1; k >= 0; k--) s += `\\end{${open[k]}}`;
  s = neutralizeUnmatchedDelims(s);
  if (!/\\begin\{/.test(s) && (/(^|[^\\])&/.test(s) || /\\\\/.test(s))) {
    s = `\\begin{aligned}${s}\\end{aligned}`;
  }
  return s;
}

module.exports = { prepareDisplayLatex, repairPartialLatex };
