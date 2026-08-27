const assert = require('assert');

if (typeof global.self === 'undefined') global.self = global;

const { Terminal } = require('@xterm/xterm');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { collectLogicalBufferLines } = require('../src/renderer/bufferText');
const {
  createRichTerminalSnapshot,
  disposeRichTerminalSnapshot,
  writeTerminal
} = require('../src/renderer/richSnapshot');

function createLiveTerminal(options = {}) {
  const terminal = new Terminal({
    cols: options.cols || 20,
    rows: options.rows || 5,
    scrollback: options.scrollback || 100,
    allowProposedApi: true
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);
  return { terminal, serializeAddon };
}

function logicalText(terminal) {
  const buf = terminal.buffer.active;
  return collectLogicalBufferLines(buf, 0, buf.baseY + buf.cursorY).map(line => line.text);
}

async function testSnapshotPreservesContentAndCellAttributes() {
  const live = createLiveTerminal({ cols: 18, rows: 5 });
  await writeTerminal(
    live.terminal,
    'plain \x1b[1;31mred\x1b[0m\r\n中文 $v_{\\rm K}$\r\nlast'
  );

  const snapshot = await createRichTerminalSnapshot({
    liveTerm: live.terminal,
    serializeAddon: live.serializeAddon,
    scrollback: 100
  });

  assert.deepStrictEqual(logicalText(snapshot.terminal), logicalText(live.terminal));
  const liveRed = live.terminal.buffer.active.getLine(0).getCell(6);
  const snapshotRed = snapshot.buffer.getLine(0).getCell(6);
  assert.strictEqual(snapshotRed.getChars(), 'r');
  assert.strictEqual(snapshotRed.isBold(), liveRed.isBold());
  assert.strictEqual(snapshotRed.getFgColorMode(), liveRed.getFgColorMode());
  assert.strictEqual(snapshotRed.getFgColor(), liveRed.getFgColor());

  disposeRichTerminalSnapshot(snapshot);
  live.terminal.dispose();
}

async function testSnapshotIsIndependentOfLiveResizeAndWrites() {
  const live = createLiveTerminal({ cols: 12, rows: 4 });
  await writeTerminal(live.terminal, 'alpha beta gamma\r\n$x^2$\r\nlast');
  const snapshot = await createRichTerminalSnapshot({
    liveTerm: live.terminal,
    serializeAddon: live.serializeAddon,
    scrollback: 100
  });
  const before = logicalText(snapshot.terminal);

  live.terminal.resize(6, 6);
  await writeTerminal(live.terminal, '\r\nnew live output');

  assert.strictEqual(snapshot.terminal.cols, 12);
  assert.strictEqual(snapshot.terminal.rows, 4);
  assert.deepStrictEqual(logicalText(snapshot.terminal), before);
  assert.notDeepStrictEqual(logicalText(live.terminal), before);

  disposeRichTerminalSnapshot(snapshot);
  live.terminal.dispose();
}

async function testSnapshotPreservesSoftWrapStructureAndSemanticSpaces() {
  const live = createLiveTerminal({ cols: 14, rows: 4 });
  const latex = '$2\\Omega \\eta v_{\\rm K}$';
  await writeTerminal(live.terminal, latex);
  const snapshot = await createRichTerminalSnapshot({
    liveTerm: live.terminal,
    serializeAddon: live.serializeAddon,
    scrollback: 100
  });

  assert.strictEqual(live.terminal.buffer.active.getLine(1).isWrapped, true);
  assert.strictEqual(snapshot.buffer.getLine(1).isWrapped, true);
  assert.deepStrictEqual(logicalText(snapshot.terminal), [latex]);
  assert.deepStrictEqual(logicalText(snapshot.terminal), logicalText(live.terminal));

  disposeRichTerminalSnapshot(snapshot);
  live.terminal.dispose();
}

async function testSnapshotKeepsFullScrollbackSource() {
  const live = createLiveTerminal({ cols: 24, rows: 4, scrollback: 200 });
  for (let i = 0; i < 80; i++) {
    await writeTerminal(live.terminal, `line-${String(i).padStart(3, '0')}\r\n`);
  }
  const snapshot = await createRichTerminalSnapshot({
    liveTerm: live.terminal,
    serializeAddon: live.serializeAddon,
    scrollback: 200
  });
  const lines = logicalText(snapshot.terminal);

  assert.ok(lines.some(line => line.includes('line-000')));
  assert.ok(lines.some(line => line.includes('line-079')));
  assert.ok(snapshot.buffer.length > snapshot.rows);

  disposeRichTerminalSnapshot(snapshot);
  live.terminal.dispose();
}

async function run() {
  await testSnapshotPreservesContentAndCellAttributes();
  await testSnapshotIsIndependentOfLiveResizeAndWrites();
  await testSnapshotPreservesSoftWrapStructureAndSemanticSpaces();
  await testSnapshotKeepsFullScrollbackSource();
  console.log('richSnapshot tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
