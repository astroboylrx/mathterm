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
  assert.deepStrictEqual(partsSummary('cost is $x^2$'), [
    { type: 'text', closed: undefined, raw: 'cost is ', content: 'cost is ' },
    { type: 'inline', closed: true, raw: '$x^2$', content: 'x^2' }
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
