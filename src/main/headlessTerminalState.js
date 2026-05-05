function ensureNodeGlobals() {
  if (typeof global.self === 'undefined') global.self = global;
}

function createHeadlessTerminalState({ cols = 80, rows = 24, scrollback = 1000 } = {}) {
  ensureNodeGlobals();
  const { Terminal } = require('@xterm/headless');
  const { SerializeAddon } = require('@xterm/addon-serialize');
  const terminal = new Terminal({
    cols,
    rows,
    scrollback,
    allowProposedApi: true
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);

  return {
    terminal,
    serializeAddon,
    write(data) {
      return new Promise(resolve => terminal.write(String(data), resolve));
    },
    resize(nextCols, nextRows) {
      terminal.resize(nextCols, nextRows);
    },
    serialize(options) {
      return serializeAddon.serialize(options);
    },
    snapshotMetrics(options) {
      const snapshot = serializeAddon.serialize(options);
      return {
        bytes: Buffer.byteLength(snapshot),
        chars: snapshot.length
      };
    },
    dispose() {
      terminal.dispose();
    }
  };
}

module.exports = { createHeadlessTerminalState };
