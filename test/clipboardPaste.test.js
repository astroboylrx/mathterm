const assert = require('assert');
const { Terminal } = require('@xterm/xterm');

global.window = { mathterm: { clipboard: {} } };
for (const mod of ['./state', './settings', './keybindings']) {
  require.cache[require.resolve('../src/renderer/' + mod.slice(2))] = {
    exports: { getActivePane: () => null, settings: {}, isMac: true, parseShortcut: () => null, formatShortcut: () => '' }
  };
}

const { preparePasteData } = require('../src/renderer/clipboard');

// An app that enabled DECSET 2004 still gets the markers.
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: true } } }, 'ls -l'),
  '\x1b[200~ls -l\x1b[201~'
);

// An app that never enabled it must not see the markers, or it reports them as
// an unknown key sequence (old nano/vim over ssh).
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: false } } }, 'ls -l'),
  'ls -l'
);

// Unbracketed newlines arrive as CR, the way the Enter key sends them.
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: false } } }, 'a\r\nb\nc'),
  'a\rb\rc'
);

// Bracketed payloads keep their newlines untouched.
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: true } } }, 'a\nb'),
  '\x1b[200~a\nb\x1b[201~'
);

// CRLF collapses to a single newline so it is one Enter, not two.
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: true } } }, 'a\r\nb'),
  '\x1b[200~a\nb\x1b[201~'
);

// Clipboard content cannot close the bracket early.
assert.strictEqual(
  preparePasteData({ term: { modes: { bracketedPasteMode: true } } }, 'a\x1b[201~rm -rf /'),
  '\x1b[200~arm -rf /\x1b[201~'
);

// Missing terminal falls back to the safe, unbracketed form.
assert.strictEqual(preparePasteData({}, 'x\ny'), 'x\ry');

// A real xterm.js terminal tracks the mode off the wire.
const term = new Terminal({ allowProposedApi: true });
assert.strictEqual(term.modes.bracketedPasteMode, false);
term.write('\x1b[?2004h', () => {
  assert.strictEqual(term.modes.bracketedPasteMode, true);
  term.write('\x1b[?2004l', () => {
    assert.strictEqual(term.modes.bracketedPasteMode, false);
    term.dispose();
    console.log('clipboard paste tests passed');
  });
});
