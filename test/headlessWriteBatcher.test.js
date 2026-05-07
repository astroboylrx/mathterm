const assert = require('assert');
const { HeadlessWriteBatcher } = require('../src/main/headlessWriteBatcher');

function createTerminalState() {
  return {
    writes: [],
    resizes: [],
    write(data) {
      this.writes.push(String(data));
      return Promise.resolve();
    },
    resize(cols, rows) {
      this.resizes.push({ cols, rows, afterWrites: this.writes.slice() });
    }
  };
}

async function testBatchesSmallWrites() {
  const terminalState = createTerminalState();
  const scheduled = [];
  const batcher = new HeadlessWriteBatcher({
    terminalState,
    schedule: callback => scheduled.push(callback)
  });
  batcher.push('a');
  batcher.push('b');
  batcher.push('c');
  assert.strictEqual(scheduled.length, 1);
  scheduled.shift()();
  await batcher.wait();
  assert.deepStrictEqual(terminalState.writes, ['abc']);
  assert.strictEqual(batcher.writeCount, 1);
}

async function testFlushesWhenBatchCapIsReached() {
  const terminalState = createTerminalState();
  const batcher = new HeadlessWriteBatcher({
    terminalState,
    maxBatchBytes: 4,
    schedule: () => {}
  });
  batcher.push('ab');
  batcher.push('cd');
  await batcher.wait();
  assert.deepStrictEqual(terminalState.writes, ['abcd']);
}

async function testResizeIsOrderedAfterPendingWrites() {
  const terminalState = createTerminalState();
  const batcher = new HeadlessWriteBatcher({
    terminalState,
    schedule: () => {}
  });
  batcher.push('before');
  batcher.resize(100, 30);
  await batcher.wait();
  assert.deepStrictEqual(terminalState.writes, ['before']);
  assert.deepStrictEqual(terminalState.resizes, [
    { cols: 100, rows: 30, afterWrites: ['before'] }
  ]);
}

async function testDisposeDropsPendingWrites() {
  const terminalState = createTerminalState();
  const scheduled = [];
  const batcher = new HeadlessWriteBatcher({
    terminalState,
    schedule: callback => scheduled.push(callback)
  });
  batcher.push('drop');
  batcher.dispose();
  assert.strictEqual(scheduled.length, 1);
  scheduled.shift()();
  await batcher.wait();
  assert.deepStrictEqual(terminalState.writes, []);
}

async function run() {
  await testBatchesSmallWrites();
  await testFlushesWhenBatchCapIsReached();
  await testResizeIsOrderedAfterPendingWrites();
  await testDisposeDropsPendingWrites();
  console.log('headlessWriteBatcher tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
