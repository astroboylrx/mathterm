const assert = require('assert');
const { stripAnsi } = require('../src/renderer/ansi');

function testPlainTextReturnsUnchanged() {
  const text = 'plain text\nwith tabs\tand unicode é';
  assert.strictEqual(stripAnsi(text), text);
}

function testAnsiAndControlsAreStripped() {
  assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m\r\nnext\rhidden\x07'), 'red\nnexthidden');
}

testPlainTextReturnsUnchanged();
testAnsiAndControlsAreStripped();

console.log('ansi tests passed');
