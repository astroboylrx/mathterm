const assert = require('assert');

// markdown.js only needs settings for the KaTeX macro lookup.
require.cache[require.resolve('../src/renderer/settings')] = { exports: { settings: {}, isMac: false } };
// No DOM here, so exercise the markdown pipeline unsanitized; the sanitizer
// itself fails closed without a document and is smoke-tested in the app.
global.document = {
  createElement: () => ({
    className: '',
    set textContent(v) { this._t = v; },
    get outerHTML() { return '<span>' + this._t + '</span>'; }
  })
};
const { renderMarkdownToHtml } = require('../src/renderer/markdown');

const render = src => renderMarkdownToHtml(src, { sanitize: false });
const isMath = html => /class="katex/.test(html);

// A $$ block opened at end of line closes on a lone $$ line, even across a
// blank line, and works inside a heading.
assert.ok(isMath(render('$$\na = b + c\n$$')));
assert.ok(isMath(render('# $$\na = b + c\n\n$$')));
assert.ok(/<h1>/.test(render('# $$\na = b + c\n\n$$')));
assert.ok(isMath(render('# $$a = b + c$$')));

// Two dollar amounts in separate paragraphs must not pair up and swallow the
// prose between them.
const prices = render('The widget costs $$5.\n\nA second paragraph.\n\nRevenue was $$7 last year.');
assert.ok(!isMath(prices), 'stray $$ must not form a formula');
assert.ok(/A second paragraph\./.test(prices), 'prose between stray $$ must survive');
assert.strictEqual((prices.match(/<p>/g) || []).length, 3);

// Same for single-dollar inline math: pandoc's delimiter rule keeps prices out.
const inlinePrices = render('It costs $5 and sells for $7 each.');
assert.ok(!isMath(inlinePrices));
assert.ok(/sells for/.test(inlinePrices));
// ...while real inline math still renders.
assert.ok(isMath(render('Let $a = b + c$ hold.')));
assert.ok(isMath(render('Take $5x + 3$ here.')));

// Math inside a fenced code block stays literal, closed fence or not.
const closedFence = render('```js\nconst a = $$x$$;\n```');
assert.ok(!isMath(closedFence));
assert.ok(/\$\$x\$\$/.test(closedFence));
const openFence = render('```\n$$x$$');
assert.ok(!isMath(openFence));
assert.ok(/\$\$x\$\$/.test(openFence), 'unclosed fence must not leak a placeholder');
assert.ok(!/MT[a-z0-9]+\d/.test(openFence), 'placeholder must never reach the output');

// Source text that looks like a placeholder is not substituted.
const collision = render('Real math: $$x$$\n\nLiteral: <!--MATH0--> <!--MT0-->');
assert.strictEqual((collision.match(/<annotation encoding/g) || []).length, 1,
  'the literal placeholder must not be turned into a second formula');
assert.ok(/<!--MATH0-->/.test(collision));

// No placeholder comment ever survives into the output.
assert.ok(!/<!--MT[a-z0-9]+\d+-->/.test(render('$$a$$\n\ntext $$b$$')));

// The common LaTeX style opens $$ with math already on the same line and runs
// over several lines before closing -- it must render.
const multilineBlock = [
  '$$ \\left\\{\\begin{aligned}',
  '  a &= b, \\\\',
  '  c &= d.',
  '\\end{aligned}\\right. $$'
].join('\n');
assert.ok(isMath(render(multilineBlock)), 'content on the opening $$ line must still open a block');
assert.ok(isMath(render(['$$  \\frac{a}{b},', '$$'].join('\n'))));

// ...but such a pair still may not span a blank line, or stray $$ in prose
// merge again.
assert.ok(!isMath(render(['costs $$5 and', '', 'later revenue $$7'].join('\n'))));

console.log('markdown math tests passed');
