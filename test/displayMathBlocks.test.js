const assert = require('assert');
if (typeof global.self === 'undefined') global.self = global;
const { Terminal } = require('@xterm/headless');
const { modelBlocksForLines, computeModelDisplayMathSpans, splitBlockLatex } = require('../src/renderer/displayMathBlocks');

const blocks = lines => modelBlocksForLines(lines).map(b => [b.start, b.end]);

// An ordinary block, and one the view entered part-way (the half-a-file case).
assert.deepStrictEqual(blocks(['The update rule is', '$$', '\\Sigma_{n+1} = \\Sigma_n + \\Delta t\\,F', '$$', 'which is explicit.']),
  [[1, 3]]);
const cut = modelBlocksForLines(['\\frac{\\partial u}{\\partial t} &= \\nu \\nabla^2 u \\\\', 'p &= \\rho c^2',
  '\\end{aligned} $$', 'where', '$$', 'a = b', '$$']);
assert.deepStrictEqual(cut.map(b => [b.start, b.end]), [[0, 2], [4, 6]]);
assert.ok(cut[0].partialStart && !cut[0].partialEnd, 'first block starts past its opener');

// A bare environment is a block; so is a one-line one, which nothing else draws.
assert.deepStrictEqual(blocks(['Consider', '\\begin{align}', 'a &= b \\\\', 'c &= d', '\\end{align}', 'so that']), [[1, 4]]);
assert.deepStrictEqual(blocks(['Hence', '\\begin{equation} E = mc^2 \\end{equation}', 'as claimed.']), [[1, 1]]);
// ...while a one-line $$x$$ stays with the inline renderer.
assert.deepStrictEqual(blocks(['Hence', '$$ E = mc^2 $$', 'as claimed.']), []);

// Fenced code is never math; a prompt row is never inside a block.
assert.deepStrictEqual(blocks(['```latex', '$$', 'not math here', '$$', '```', 'After the fence.']), []);
const prompted = modelBlocksForLines(['$$', 'a = b', 'user@host:~/p$ make', '$$'], i => i === 2);
assert.ok(prompted.every(b => !(b.start <= 2 && 2 <= b.end)), 'a block crossed a prompt row');

// LaTeX of a block, with prose on its first or last line split off.
assert.deepStrictEqual(splitBlockLatex(['where $$\\begin{aligned}', 'a &= b', '\\end{aligned}$$ so that']),
  { prefix: 'where', latex: '\\begin{aligned}\na &= b\n\\end{aligned}', suffix: 'so that' });
assert.deepStrictEqual(splitBlockLatex(['# $$', 'a = b + c', '', '$$']), { prefix: '', latex: '\na = b + c\n\n', suffix: '' });
// In a block the view entered part-way, a $$ on the first line is its closer.
assert.deepStrictEqual(splitBlockLatex(['a &= b $$ then'], { partialStart: true }),
  { prefix: '', latex: 'a &= b ', suffix: 'then' });

// Row spans through a real terminal: soft-wrapped lines join into one logical
// line, and a block's rows cover every wrapped row of its last line.
(async () => {
  const src = ['Intro text', '$$', '\\frac{a}{b} + ' + '\\alpha_{1} '.repeat(12), '$$', 'after'];
  const term = new Terminal({ cols: 40, rows: 10, scrollback: 500, allowProposedApi: true });
  await new Promise(r => term.write(src.join('\r\n'), r));
  const buf = term.buffer.active; const endY = buf.baseY + buf.cursorY;
  const { spans } = computeModelDisplayMathSpans(buf, 0, endY, null, null);
  assert.strictEqual(spans.length, 1);
  const bodyRows = [];
  for (let y = 0; y <= endY; y++) if (buf.getLine(y).translateToString(true).includes('alpha')) bodyRows.push(y);
  assert.ok(bodyRows.length > 1, 'the long formula line should have wrapped');
  assert.strictEqual(spans[0].startY, 1);
  assert.strictEqual(spans[0].endY, bodyRows[bodyRows.length - 1] + 1, 'span must end at the closing $$ row');
  term.dispose();
  console.log('display math blocks tests passed');
})().catch(err => { console.error(err); process.exit(1); });
