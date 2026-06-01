const assert = require('assert');
const { stripAnsi, lineToColoredSpans } = require('../src/renderer/ansi');

function installFakeDocument() {
  if (global.document) return;
  class Node {
    constructor(tagName = '') {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
      this.className = '';
      this._textContent = '';
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    get textContent() {
      return this._textContent + this.children.map(child => child.textContent || '').join('');
    }
    set textContent(value) {
      this._textContent = String(value || '');
      this.children = [];
    }
  }
  global.document = {
    createDocumentFragment: () => new Node('#fragment'),
    createElement: tagName => new Node(tagName)
  };
}

function testPlainTextReturnsUnchanged() {
  const text = 'plain text\nwith tabs\tand unicode é';
  assert.strictEqual(stripAnsi(text), text);
}

function testAnsiAndControlsAreStripped() {
  assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m\r\nnext\rhidden\x07'), 'red\nnexthidden');
}

function cell(chars, width = 1, opts = {}) {
  return {
    getChars: () => chars,
    getWidth: () => width,
    getCode: () => chars ? chars.codePointAt(0) : 0,
    getFgColorMode: () => 0,
    getFgColor: () => 0,
    isBold: () => !!opts.bold,
    isDim: () => false,
    isItalic: () => false,
    isUnderline: () => !!opts.underline
  };
}

function line(cells) {
  return {
    length: cells.length,
    getCell: x => cells[x] || null
  };
}

function wide(ch, opts = {}) {
  return [cell(ch, 2, opts), cell('', 0, opts)];
}

function testColoredSpansSkipWideContinuationCells() {
  installFakeDocument();
  const fragment = lineToColoredSpans(line([...wide('中'), ...wide('文'), cell(''), cell('A')]));
  assert.strictEqual(fragment.textContent, '中文 A');
}

function testColoredSpansPreserveRealBlankCells() {
  installFakeDocument();
  const fragment = lineToColoredSpans(line([cell('A'), cell(''), cell(''), cell('B')]));
  assert.strictEqual(fragment.textContent, 'A  B');
}

testPlainTextReturnsUnchanged();
testAnsiAndControlsAreStripped();
testColoredSpansSkipWideContinuationCells();
testColoredSpansPreserveRealBlankCells();

console.log('ansi tests passed');
