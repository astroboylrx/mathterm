const assert = require('assert');
const path = require('path');

require.cache[require.resolve('../src/renderer/settings')] = { exports: { settings: {}, isMac: false } };
const captured = [];
require.cache[require.resolve('../src/renderer/richKatexQueue')] = {
  exports: { queueKatex: (latex) => captured.push(latex) }
};
global.document = {
  createElement: () => ({ className: '', style: {}, dataset: {}, appendChild() {}, set textContent(v) {} })
};

const { tryParseDisplayMath } = require('../src/renderer/richBlockParse');
const { computeDisplayMathSpans } = require('../src/renderer/richVirtual');

function parse(src) {
  captured.length = 0;
  const lines = src.split('\n').map((text, y) => ({ y, text }));
  let i = 0;
  while (i < lines.length) {
    const r = tryParseDisplayMath(lines, i, null, null, null);
    if (r) { i = r.endIdx; continue; }
    i++;
  }
  return captured.slice();
}

// The virtualized path precomputes spans and tryParseDisplayMath defers to
// them, so the two must agree or a scrolled pane renders differently.
function spans(src) {
  const lines = src.split('\n');
  const buf = {
    getLine: y => (y >= 0 && y < lines.length
      ? { isWrapped: false, translateToString: () => lines[y] }
      : null)
  };
  return computeDisplayMathSpans(buf, 0, lines.length - 1, null, null);
}

const LOADED = [
  '$$ \\left\\{\\begin{aligned}',
  '  \\frac{\\partial a}{\\partial t} &= b, \\\\',
  '  c &= \\frac{d}{e}.',
  '\\end{aligned}\\right. $$'
].join('\n');

// A delimiter carrying math opens and closes a block -- the dominant style.
let got = parse(LOADED);
assert.strictEqual(got.length, 1, 'loaded delimiters must form one block');
assert.ok(got[0].includes('\\begin{aligned}') && got[0].includes('\\end{aligned}'));

// Mixed forms: loaded open with a bare close, and the reverse.
assert.strictEqual(parse('$$  \\frac{a}{b},\n$$').length, 1);
assert.strictEqual(parse('$$\n\\frac{a}{b}\n\\frac{c}{d} $$').length, 1);

// The long-standing bare form is untouched.
assert.strictEqual(parse('$$\na = b + c\n$$').length, 1);

// `$$x$$` on one line stays with the inline renderer.
assert.strictEqual(parse('$$ \\frac{a}{b} $$').length, 0);

// A loaded opener may not span a blank line.
assert.strictEqual(parse('$$ \\frac{a}{b}\n\ntext\n\n\\frac{c}{d} $$').length, 0);

// `$$` is the shell pid and Make's escaped `$`: those must never become math.
assert.strictEqual(parse('$ echo $$ > /tmp/p.$$\n12345\n$ kill -9 $$; echo done $$').length, 0);
assert.strictEqual(parse('\tfor f in *.c; do echo $$f; done\n\t@echo "pid $$"').length, 0);
assert.strictEqual(
  parse('\t@wc -c $(A)/$(B) | sed -e "s|$(A).*$$||" | xargs printf "%012d"\n\t@cat $(C) >> $(D)\n\t@wc -c $(C) | sed -e "s|$(C).*$$||" | xargs printf').length,
  0,
  'Makefile recipes must not pair across lines'
);

// Both parsers must see the same blocks.
for (const src of [LOADED, '$$\na = b + c\n$$', '$$  \\frac{a}{b},\n$$',
                   '$ echo $$ > /tmp/p.$$\n12345\n$ kill -9 $$; echo done $$']) {
  assert.strictEqual(spans(src).length, parse(src).length,
    'richVirtual spans and richBlockParse must agree on: ' + JSON.stringify(src.slice(0, 40)));
}

// A real prompt must stop an unclosed block. `head -n` cut a file inside a
// formula, then the next command ran; prompts showing ~/dev_projects, a `_` in
// a directory, a git status of (main=) or a PowerShell path used to read as
// math body and let the block run on through the command output.
for (const prompt of [
  'user@host:~/dev_projects/mathterm$ npm test',
  '(asf) user@host:~/my_runs$ npm test',
  'user@host ~/proj (main=) $ npm test',
  'PS C:\\Users\\me\\proj> npm test'
]) {
  const lines = [
    'The update rule is',
    '$$',
    '\\Sigma_{n+1} = \\Sigma_n + \\Delta t \\, F(\\Sigma_n)',
    prompt,
    'backendLifecycle tests passed',
    prompt.replace('npm test', 'cat other.md'),
    '$$',
    'a = b',
    '$$'
  ];
  const promptRows = new Set([3, 5]);
  const items = lines.map((text, y) => ({ y, text }));
  const checker = (_p, _t, y) => promptRows.has(y);
  captured.length = 0;
  const blocks = [];
  let i = 0;
  while (i < items.length) {
    const r = tryParseDisplayMath(items, i, null, {}, checker);
    if (r) { blocks.push([i, r.endIdx - 1]); i = r.endIdx; continue; }
    i++;
  }
  assert.deepStrictEqual(blocks, [[6, 8]], `unclosed block crossed the prompt: ${prompt}`);

  const buf = {
    getLine: y => (y >= 0 && y < lines.length ? { isWrapped: false, translateToString: () => lines[y] } : null)
  };
  assert.deepStrictEqual(
    computeDisplayMathSpans(buf, 0, lines.length - 1, (_t, y) => promptRows.has(y), null),
    [{ startY: 6, endY: 8 }],
    `virtual spans crossed the prompt: ${prompt}`
  );
}

// ...while a formula row that prompt tracking tags by mistake still does not
// break its block (the case the override exists for).
{
  const lines = ['$$', '\\rho_{\\rm g}(R,z) =', '\\rho_0 \\left(\\frac{R}{R_p}\\right)^{-9/4}', '$$'];
  const items = lines.map((text, y) => ({ y, text }));
  captured.length = 0;
  const r = tryParseDisplayMath(items, 0, null, {}, (_p, _t, y) => y === 1);
  assert.ok(r && r.endIdx === 4, 'a falsely tagged formula row must not break the block');
}

console.log('rich display math tests passed');
