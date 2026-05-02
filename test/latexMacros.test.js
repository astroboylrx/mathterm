const assert = require('assert');
const { parseLatexMacros } = require('../src/latexMacros');

{
  const macros = parseLatexMacros(String.raw`
    % common aliases
    \newcommand{\R}{\mathbb{R}}
    \newcommand{\vect}[1]{\mathbf{#1}}
    \renewcommand{\eps}{\varepsilon}
    \def\NN{\mathbb{N}}
  `);
  assert.strictEqual(macros['\\R'], String.raw`\mathbb{R}`);
  assert.strictEqual(macros['\\vect'], String.raw`\mathbf{#1}`);
  assert.strictEqual(macros['\\eps'], String.raw`\varepsilon`);
  assert.strictEqual(macros['\\NN'], String.raw`\mathbb{N}`);
}

{
  const macros = parseLatexMacros(String.raw`
    \newcommand{\kept}{a\%b} % trailing comment
    % \newcommand{\ignored}{x}
  `);
  assert.strictEqual(macros['\\kept'], String.raw`a\%b`);
  assert.strictEqual(macros['\\ignored'], undefined);
}

console.log('latex macro tests passed');
