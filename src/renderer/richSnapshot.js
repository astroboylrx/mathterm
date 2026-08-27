const { Terminal } = require('@xterm/xterm');

function writeTerminal(terminal, data) {
  return new Promise((resolve, reject) => {
    try {
      terminal.write(data, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

async function createRichTerminalSnapshot({ liveTerm, serializeAddon, scrollback }) {
  if (!liveTerm || !serializeAddon) {
    throw new Error('Cannot snapshot an uninitialized terminal');
  }

  // Serialize synchronously so later live writes or resizes cannot change the
  // source represented by this snapshot while xterm parses the copy.
  const serialized = serializeAddon.serialize();
  const configuredScrollback = Number.isFinite(Number(scrollback))
    ? Math.max(0, Number(scrollback))
    : Math.max(0, Number(liveTerm.options?.scrollback) || 0);
  const requiredScrollback = Math.max(
    0,
    Number(liveTerm.buffer?.normal?.length || 0) - Number(liveTerm.rows || 0)
  );
  const terminal = new Terminal({
    cols: liveTerm.cols,
    rows: liveTerm.rows,
    scrollback: Math.max(configuredScrollback, requiredScrollback),
    allowProposedApi: true
  });

  try {
    const { Unicode11Addon } = require('@xterm/addon-unicode11');
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '6';
  } catch {}

  try {
    await writeTerminal(terminal, serialized);
  } catch (err) {
    terminal.dispose();
    throw err;
  }

  return {
    terminal,
    buffer: terminal.buffer.active,
    cols: terminal.cols,
    rows: terminal.rows
  };
}

function disposeRichTerminalSnapshot(snapshot) {
  try { snapshot?.terminal?.dispose(); } catch {}
}

module.exports = {
  createRichTerminalSnapshot,
  disposeRichTerminalSnapshot,
  writeTerminal
};
