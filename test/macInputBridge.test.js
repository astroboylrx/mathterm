const assert = require('assert');
const { Terminal } = require('@xterm/xterm');
const settingsPath = require.resolve('../src/renderer/settings');
require.cache[settingsPath] = {
  exports: {
    isMac: true
  }
};
const { controlKeyBinding } = require('../src/renderer/macInputBridge');

assert.strictEqual(controlKeyBinding({
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  code: 'Slash',
  key: '/'
}), '\x1f');

assert.strictEqual(controlKeyBinding({
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
  code: 'Slash',
  key: '?'
}), null);

assert.strictEqual(controlKeyBinding({
  control: true,
  shift: false,
  alt: false,
  meta: false,
  code: 'Slash',
  key: '/'
}), '\x1f');

const term = new Terminal({ macOptionIsMeta: true });
assert.strictEqual(term.options.macOptionIsMeta, true);
term.options.macOptionIsMeta = false;
assert.strictEqual(term.options.macOptionIsMeta, false);
term.dispose();

console.log('mac input bridge tests passed');
