const assert = require('assert');
if (typeof global.self === 'undefined') global.self = global;
const { Terminal } = require('@xterm/headless');

require.cache[require.resolve('../src/renderer/settings')] = { exports: { settings: {}, isMac: false } };
const captured = [];
require.cache[require.resolve('../src/renderer/richKatexQueue')] = {
  exports: { queueKatex: (latex) => captured.push(latex) }
};
global.document = {
  createElement: () => ({ className: '', style: {}, dataset: {}, appendChild() {}, set textContent(v) {} })
};

const { computeDisplayMathSpans } = require('../src/renderer/richVirtual');
const { collectLogicalBufferLines } = require('../src/renderer/bufferText');
const { tryParseDisplayMath } = require('../src/renderer/richBlockParse');

// A long prose paragraph carrying inline math, then a display block whose body
// contains `|`. Walking physical rows made both heuristics see a wrap fragment,
// so whether the block was detected depended on the terminal width.
const DOC = [
  'where the source term $S$ represents the custom wind profile that drains gas, the constant $\\mathcal{C} \\propto m_\\star^2/\\mu_0 \\alpha_D$ and $m_\\star$ is the stellar dipole momentum ($\\simeq B_\\star R_\\star^3$). We can estimate the value of $\\mathcal{C}$ at a certain disk radius $r_{\\rm c}$',
  '$$',
  '\\mathcal{C} = \\left. r^4 \\frac{3}{2}\\frac{\\partial }{\\partial r} \\left(\\Sigma_{\\rm g} \\nu \\Omega r^2 \\right) \\right|_{r_c}.',
  '$$',
  '',
  'The gas velocity can be calculated as',
  '$$',
  '  u = -\\frac{3}{\\Sigma_{\\rm g}r^{1/2}}\\frac{\\partial }{\\partial r}\\left(\\Sigma_{\\rm g} \\nu r^{1/2} \\right).',
  '$$',
  ''
].join('\n');

async function parseAt(cols) {
  const term = new Terminal({ cols, rows: 40, scrollback: 5000, allowProposedApi: true });
  await new Promise(r => term.write(DOC.replace(/\n/g, '\r\n'), r));
  const buf = term.buffer.active;
  const endY = buf.baseY + buf.cursorY;
  const spans = computeDisplayMathSpans(buf, 0, endY, null, null);
  const starts = new Set(spans.map(s => s.startY));
  const textLines = collectLogicalBufferLines(buf, 0, endY);
  captured.length = 0;
  let i = 0;
  while (i < textLines.length) {
    const r = tryParseDisplayMath(textLines, i, { displayMathSpanStarts: starts }, null, null);
    if (r) { i = r.endIdx; continue; }
    i++;
  }
  const logicalYs = new Set(textLines.map(l => l.y));
  const result = {
    spans: spans.length,
    blocks: captured.slice(),
    orphanStarts: [...starts].filter(y => !logicalYs.has(y)).length
  };
  term.dispose();
  return result;
}

const norm = t => t.replace(/\s+/g, ' ').trim();

(async () => {
for (let cols = 40; cols <= 220; cols++) {
  const r = await parseAt(cols);
  assert.strictEqual(r.spans, 2, `cols=${cols}: expected 2 display spans, got ${r.spans}`);
  assert.strictEqual(r.blocks.length, 2, `cols=${cols}: expected 2 parsed blocks`);
  assert.strictEqual(r.orphanStarts, 0,
    `cols=${cols}: every span start must land on a logical line start`);
  // Prose must never end up inside a formula.
  for (const b of r.blocks) {
    assert.ok(!/gas velocity can be calculated/.test(norm(b)),
      `cols=${cols}: prose swallowed into a formula`);
    assert.ok(/\\mathcal\{C\}|\\frac/.test(b), `cols=${cols}: block body is not math`);
  }
}

console.log('rich display math wrap tests passed');
})().catch(err => { console.error(err); process.exit(1); });
