const assert = require('assert');
const settingsPath = require.resolve('../src/renderer/settings');
require.cache[settingsPath] = {
  exports: {
    isMac: true,
    settings: { macOptionAsMeta: true }
  }
};
const {
  controlKeyBinding,
  macOptionMetaBinding
} = require('../src/renderer/macInputBridge');
const { settings } = require('../src/renderer/settings');

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

assert.deepStrictEqual(macOptionMetaBinding({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code: 'KeyV',
  key: '\u221a'
}), { sequence: '\x1bv', text: '\u221a' });

assert.deepStrictEqual(macOptionMetaBinding({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: true,
  code: 'KeyV',
  key: '\u221a'
}), { sequence: '\x1bV', text: '\u221a' });

settings.macOptionAsMeta = false;
assert.strictEqual(macOptionMetaBinding({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code: 'KeyV',
  key: '\u221a'
}), null);

console.log('mac input bridge tests passed');
