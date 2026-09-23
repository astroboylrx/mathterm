const assert = require('assert');
const fixture = require('./fixtures/displayMathModelParity.json');
const {
  scoreLine,
  seqAttrs,
  viterbi,
  tagsToSpans,
  detectDisplayMathSpans
} = require('../src/renderer/displayMathModel');
const model = require('../src/renderer/displayMathModel.json');

// The fixture is produced by the training pipeline from the exported JSON:
// every per-line logit and every decoded tag here must match it, or the app
// is running a different model from the one that was evaluated.
let worst = 0;
for (const { text, z } of fixture.lines) {
  const got = scoreLine(text);
  worst = Math.max(worst, Math.abs(got - z));
  assert.ok(Math.abs(got - z) < 1e-6, `stage-1 logit for ${JSON.stringify(text)}: ${got} vs ${z}`);
}

for (const { lines, prompts, tags } of fixture.sequences) {
  const zs = lines.map(t => scoreLine(t));
  const got = viterbi(seqAttrs(lines, zs, prompts), prompts, model.crf).join('');
  assert.strictEqual(got, tags, `CRF tags for ${JSON.stringify(lines)}`);
}

assert.deepStrictEqual(tagsToSpans([...'OBIEOSO']), [[1, 3], [5, 5]]);
assert.deepStrictEqual(tagsToSpans([...'IIEOBI']), [[0, 2], [4, 5]]);

// Fenced code can only be outside a block when the caller says so; the model
// alone still reads a fenced $$ ... $$ as math.
const fenced = ['```latex', '$$', 'not math here', '$$', '```', 'After the fence.'];
const inFence = i => i >= 0 && i <= 4;
assert.deepStrictEqual(detectDisplayMathSpans(fenced, { isForcedOutside: inFence }), []);

// A prompt row is never inside a block.
const withPrompt = ['$$', 'a = b', 'user@host:~/p$ make', '$$'];
for (const span of detectDisplayMathSpans(withPrompt, { isPrompt: i => i === 2 })) {
  assert.ok(!(span.start <= 2 && 2 <= span.end), 'a block crossed a prompt row');
}

console.log(`display math model tests passed (max logit diff ${worst.toExponential(1)})`);
