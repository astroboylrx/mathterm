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

console.log('rich display math tests passed');
