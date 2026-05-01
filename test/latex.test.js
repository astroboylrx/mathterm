const assert = require('assert');
const { hasLatex, splitLatexSmart } = require('../src/latex');

function partsSummary(text) {
  return splitLatexSmart(text).map(part => ({
    type: part.type,
    closed: part.closed,
    raw: part.raw,
    content: part.content
  }));
}

function testEscapedDollarDoesNotLoop() {
  assert.deepStrictEqual(partsSummary('echo \\$ '), [
    { type: 'text', closed: undefined, raw: 'echo \\', content: 'echo \\' },
    { type: 'text', closed: undefined, raw: '$', content: '$' },
    { type: 'text', closed: undefined, raw: ' ', content: ' ' }
  ]);
}

function testEscapedPromptDollarWithShellSubstitution() {
  const parts = partsSummary('PROMPT=foo\\$ $(git_prompt_info)');
  assert.deepStrictEqual(parts.slice(0, 3), [
    { type: 'text', closed: undefined, raw: 'PROMPT=foo\\', content: 'PROMPT=foo\\' },
    { type: 'text', closed: undefined, raw: '$', content: '$' },
    { type: 'text', closed: undefined, raw: ' ', content: ' ' }
  ]);
  assert.strictEqual(hasLatex('PROMPT=foo\\$ $(git_prompt_info)'), false);
}

function testShellVariablesAreNotLatex() {
  assert.strictEqual(hasLatex('echo $HOME'), false);
  assert.strictEqual(hasLatex('echo $HOME $PATH'), false);
  assert.strictEqual(hasLatex('export OMPI_CC=$CC; export OMPI_CXX=$CXX'), false);
  assert.strictEqual(hasLatex('$(git_prompt_info) ${HOST%%-*} $((1+2))'), false);
  assert.strictEqual(hasLatex('echo $$'), false);
  assert.strictEqual(hasLatex('echo $$$$'), false);
  assert.strictEqual(hasLatex('echo $1 $? $@'), false);
  assert.strictEqual(hasLatex('price $5 and $10'), false);

  assert.deepStrictEqual(partsSummary('export OMPI_CC=$CC; export OMPI_CXX=$CXX'), [
    { type: 'text', closed: undefined, raw: 'export OMPI_CC=', content: 'export OMPI_CC=' },
    { type: 'text', closed: undefined, raw: '$CC', content: '$CC' },
    { type: 'text', closed: undefined, raw: '; export OMPI_CXX=', content: '; export OMPI_CXX=' },
    { type: 'text', closed: undefined, raw: '$CXX', content: '$CXX' }
  ]);
}

function testShellSubstitutionsAreTextInSplitter() {
  assert.deepStrictEqual(partsSummary('echo ${f} $(cmd) $((1+2))'), [
    { type: 'text', closed: undefined, raw: 'echo ', content: 'echo ' },
    { type: 'text', closed: undefined, raw: '${f}', content: '${f}' },
    { type: 'text', closed: undefined, raw: ' ', content: ' ' },
    { type: 'text', closed: undefined, raw: '$(cmd)', content: '$(cmd)' },
    { type: 'text', closed: undefined, raw: ' ', content: ' ' },
    { type: 'text', closed: undefined, raw: '$((1+2))', content: '$((1+2))' }
  ]);
}

function testZshPromptEscapesAreNotLatex() {
  const text = 'PROMPT=%{$fg_bold[green]%}m4p%{$reset_color%}';
  assert.strictEqual(hasLatex(text), false);
  assert.strictEqual(partsSummary(text).some(part => part.type === 'inline' || part.type === 'display'), false);
}

function testInlineMathStillWorks() {
  assert.strictEqual(hasLatex('cost is $x^2$'), true);
  assert.strictEqual(hasLatex('let $a_b$ be a coefficient'), true);
  assert.strictEqual(hasLatex('temperature $2500\\,{\\rm K}$ is fiducial'), true);
  assert.strictEqual(hasLatex('range $10$-$20\\,{\\rm m\\,s^{-1}}$ is optimistic'), true);
  assert.strictEqual(hasLatex('radius $10\\,{\\rm m}$ because $a_\\infty<10\\,{\\rm m}$'), true);
  assert.strictEqual(hasLatex('$-\\sin\\phi = +1$'), true);
  assert.strictEqual(hasLatex('smallest ($(1-\\alpha)^3$)'), true);
  assert.strictEqual(hasLatex('**The integral $I(\\alpha) > 0$ for all $0 < \\alpha < 1$**'), true);
  assert.strictEqual(hasLatex('For ${\\rm St}_{\\rm box}\\gg1$, using'), true);
  assert.deepStrictEqual(partsSummary('cost is $x^2$'), [
    { type: 'text', closed: undefined, raw: 'cost is ', content: 'cost is ' },
    { type: 'inline', closed: true, raw: '$x^2$', content: 'x^2' }
  ]);
  assert.deepStrictEqual(partsSummary('temperature $2500\\,{\\rm K}$ is fiducial'), [
    { type: 'text', closed: undefined, raw: 'temperature ', content: 'temperature ' },
    { type: 'inline', closed: true, raw: '$2500\\,{\\rm K}$', content: '2500\\,{\\rm K}' },
    { type: 'text', closed: undefined, raw: ' is fiducial', content: ' is fiducial' }
  ]);
  assert.deepStrictEqual(partsSummary('where $-\\sin\\phi = +1$ and smallest ($(1-\\alpha)^3$)'), [
    { type: 'text', closed: undefined, raw: 'where ', content: 'where ' },
    { type: 'inline', closed: true, raw: '$-\\sin\\phi = +1$', content: '-\\sin\\phi = +1' },
    { type: 'text', closed: undefined, raw: ' and smallest (', content: ' and smallest (' },
    { type: 'inline', closed: true, raw: '$(1-\\alpha)^3$', content: '(1-\\alpha)^3' },
    { type: 'text', closed: undefined, raw: ')', content: ')' }
  ]);
  assert.deepStrictEqual(partsSummary('For ${\\rm St}_{\\rm box}\\gg1$, using'), [
    { type: 'text', closed: undefined, raw: 'For ', content: 'For ' },
    { type: 'inline', closed: true, raw: '${\\rm St}_{\\rm box}\\gg1$', content: '{\\rm St}_{\\rm box}\\gg1' },
    { type: 'text', closed: undefined, raw: ', using', content: ', using' }
  ]);
}

function testClosedBacktickCodeDoesNotTriggerLatex() {
  assert.strictEqual(hasLatex('`code $x^2$` outside'), false);
  assert.strictEqual(hasLatex('plain `code $x^2$` and $y^2$'), true);
  assert.deepStrictEqual(partsSummary('`code $x^2$` outside'), [
    { type: 'code', closed: true, raw: '`code $x^2$`', content: 'code $x^2$' },
    { type: 'text', closed: undefined, raw: ' outside', content: ' outside' }
  ]);
}

function run() {
  testEscapedDollarDoesNotLoop();
  testEscapedPromptDollarWithShellSubstitution();
  testShellVariablesAreNotLatex();
  testShellSubstitutionsAreTextInSplitter();
  testZshPromptEscapesAreNotLatex();
  testInlineMathStillWorks();
  testClosedBacktickCodeDoesNotTriggerLatex();
  console.log('latex tests passed');
}

run();
