const assert = require('assert');
const { Terminal: BrowserTerminal } = require('@xterm/xterm');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { createHeadlessTerminalState } = require('../src/main/headlessTerminalState');

async function writeTerminal(term, data) {
  await new Promise(resolve => term.write(data, resolve));
}

async function testHeadlessSerializeAndResize() {
  const headless = createHeadlessTerminalState({ cols: 12, rows: 4, scrollback: 100 });
  await headless.write('hello\r\n\x1b[31mred\x1b[0m\r\nworld');
  const snapshot = headless.serialize();
  assert.ok(snapshot.includes('hello'));
  assert.ok(snapshot.includes('red'));
  const before = headless.snapshotMetrics();
  assert.ok(before.bytes > 0);

  headless.resize(20, 6);
  assert.strictEqual(headless.terminal.cols, 20);
  assert.strictEqual(headless.terminal.rows, 6);
  headless.dispose();
}

async function testHeadlessAndBrowserSerializationParity() {
  const data = 'alpha\r\n\x1b[32mbeta\x1b[0m\r\ngamma';
  const headless = createHeadlessTerminalState({ cols: 16, rows: 5, scrollback: 100 });
  await headless.write(data);
  const headlessSnapshot = headless.serialize();

  const browserTerm = new BrowserTerminal({
    cols: 16,
    rows: 5,
    scrollback: 100,
    allowProposedApi: true
  });
  const browserSerialize = new SerializeAddon();
  browserTerm.loadAddon(browserSerialize);
  await writeTerminal(browserTerm, data);
  const browserSnapshot = browserSerialize.serialize();

  assert.strictEqual(headlessSnapshot, browserSnapshot);
  assert.ok(headlessSnapshot.includes('alpha'));
  assert.ok(headlessSnapshot.includes('beta'));

  browserTerm.dispose();
  headless.dispose();
}

async function run() {
  await testHeadlessSerializeAndResize();
  await testHeadlessAndBrowserSerializationParity();
  console.log('headlessTerminalState tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
