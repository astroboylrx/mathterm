const assert = require('assert');
const katex = require('katex');
const { prepareDisplayLatex, repairPartialLatex } = require('../src/renderer/latexRepair');

const renders = s => {
  try { katex.renderToString(s, { displayMode: true, throwOnError: true }); return true; } catch { return false; }
};

// Paper-style blocks KaTeX rejects as written, rewritten into ones it accepts.
for (const src of [
  '\\begin{equation}\\label{eq:1} E=mc^2 \\end{equation}',
  '\\begin{eqnarray} a &=& b \\\\ c &=& d \\end{eqnarray}',
  '\\begin{multline} a + b \\\\ + c \\end{multline}',
  '\\begin{displaymath} x^2 \\end{displaymath}',
]) {
  assert.ok(!renders(src), `expected KaTeX to reject: ${src}`);
  assert.ok(renders(prepareDisplayLatex(src)), `prepareDisplayLatex did not fix: ${src}`);
}

// Blocks cut by the view: opener or closer out of sight.
for (const src of [
  'a &= b \\\\ c &= d',                                            // no environment in view
  'a &= b \\\\ c &= d \\end{aligned}\\right.',                     // view starts inside \left\{\begin{aligned}
  '\\left\\{\\begin{aligned} a &= b \\\\',                          // view stops inside it
  '\\frac{\\partial u}{\\partial t} &= \\nu \\\\ p &= \\rho c^2 \\end{aligned}\\right.',
  '\\left( \\frac{a}{b}',                                          // \left whose \right is cut off
]) {
  assert.ok(!renders(src), `expected KaTeX to reject: ${src}`);
  assert.ok(renders(repairPartialLatex(prepareDisplayLatex(src))), `repairPartialLatex did not fix: ${src}`);
}

// Matched \left / \right and complete environments are left alone.
const whole = '\\left( \\begin{aligned} a &= b \\end{aligned} \\right)';
assert.strictEqual(repairPartialLatex(whole), whole);

console.log('latex repair tests passed');
