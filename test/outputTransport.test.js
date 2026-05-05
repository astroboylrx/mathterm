const assert = require('assert');
const { PaneOutputTransport, splitByMaxBytes } = require('../src/main/outputTransport');
const { FakePtyAdapter } = require('./helpers/fakePtyAdapter');

function testSequenceWatermarkAndReplay() {
  const transport = new PaneOutputTransport({ maxBatchBytes: 1024 });
  transport.attachView('view-a');
  assert.strictEqual(transport.push('one'), 1);
  assert.strictEqual(transport.push('two'), 2);
  const snapshot = transport.beginSnapshot();
  assert.deepStrictEqual(snapshot, { snapshotSeq: 2 });
  assert.strictEqual(transport.push('three'), 3);
  assert.strictEqual(transport.push('four'), 4);

  transport.attachView('view-b');
  const replayCount = transport.enqueueReplay('view-b', snapshot.snapshotSeq);
  assert.strictEqual(replayCount, 2);
  const batch = transport.flush('view-b');
  assert.strictEqual(batch.fromSeq, 3);
  assert.strictEqual(batch.toSeq, 4);
  assert.strictEqual(batch.data, 'threefour');
  assert.strictEqual(transport.ack('view-b', batch.batchId), true);
  assert.deepStrictEqual(transport.viewState('view-b'), {
    pendingChunks: 0,
    unackedBatches: 0,
    unackedBytes: 0,
    pendingBytes: 0,
    droppedPendingChunks: 0
  });
}

function testBatchingAndBackpressure() {
  const events = [];
  const transport = new PaneOutputTransport({
    maxBatchBytes: 5,
    highWatermarkBytes: 8,
    lowWatermarkBytes: 4,
    ptyFlowControl: {
      pause: () => events.push('pause'),
      resume: () => events.push('resume')
    }
  });
  transport.attachView('view-a');
  transport.push('abc');
  transport.push('def');
  transport.push('ghi');

  const first = transport.flush('view-a');
  assert.strictEqual(first.data, 'abc');
  assert.deepStrictEqual(events, []);
  const second = transport.flush('view-a');
  assert.strictEqual(second.data, 'def');
  const third = transport.flush('view-a');
  assert.strictEqual(third.data, 'ghi');
  assert.deepStrictEqual(events, ['pause']);
  assert.strictEqual(transport.paused, true);

  assert.strictEqual(transport.ack('view-a', first.batchId), true);
  assert.strictEqual(transport.paused, true);
  assert.strictEqual(transport.ack('view-a', second.batchId), true);
  assert.deepStrictEqual(events, ['pause', 'resume']);
  assert.strictEqual(transport.paused, false);
  assert.strictEqual(transport.ack('view-a', third.batchId), true);
}

function testQueueBoundAndDetach() {
  const transport = new PaneOutputTransport({ maxQueueBytes: 6 });
  transport.attachView('view-a');
  transport.push('111');
  transport.push('222');
  transport.push('333');
  assert.ok(transport.queueBytes <= 6);
  assert.deepStrictEqual(transport.queue.map(chunk => chunk.data), ['222', '333']);

  transport.detachView('view-a');
  assert.strictEqual(transport.viewState('view-a'), null);
}

function testPendingCapForStalledView() {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = msg => warnings.push(msg);
  try {
    const transport = new PaneOutputTransport({ maxPendingBytes: 6 });
    transport.attachView('hung-view');
    transport.push('111');
    transport.push('222');
    transport.push('333');
    const state = transport.viewState('hung-view');
    assert.strictEqual(state.pendingBytes, 6);
    assert.strictEqual(state.pendingChunks, 2);
    assert.strictEqual(state.droppedPendingChunks, 1);
    assert.strictEqual(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
}

function testOversizedOutputIsSplitBeforeBatching() {
  assert.deepStrictEqual(splitByMaxBytes('abcdef', 4), ['abcd', 'ef']);
  const transport = new PaneOutputTransport({ maxBatchBytes: 4 });
  transport.attachView('view-a');
  assert.strictEqual(transport.push('abcdef'), 2);
  const first = transport.flush('view-a');
  const second = transport.flush('view-a');
  assert.strictEqual(first.data, 'abcd');
  assert.strictEqual(first.bytes, 4);
  assert.strictEqual(second.data, 'ef');
  assert.strictEqual(second.bytes, 2);
}

function testFakePtyFlowControlIntegration() {
  const adapter = new FakePtyAdapter();
  const pty = adapter.spawn('/bin/bash', ['-i'], { cols: 80, rows: 24 });
  const transport = new PaneOutputTransport({
    maxBatchBytes: 4,
    highWatermarkBytes: 6,
    lowWatermarkBytes: 3,
    ptyFlowControl: pty
  });
  pty.onData(data => transport.push(data));
  transport.attachView('view-a');

  pty.emitData('abcd');
  pty.emitData('efgh');
  const first = transport.flush('view-a');
  const second = transport.flush('view-a');
  assert.strictEqual(first.data, 'abcd');
  assert.strictEqual(second.data, 'efgh');
  assert.strictEqual(pty.paused, true);
  assert.strictEqual(pty.pauseCount, 1);

  pty.emitData('queued');
  assert.strictEqual(transport.outputSeq, 2);
  assert.strictEqual(transport.ack('view-a', first.batchId), true);
  assert.strictEqual(pty.paused, true);
  assert.strictEqual(transport.ack('view-a', second.batchId), true);
  assert.strictEqual(pty.paused, false);
  assert.strictEqual(pty.resumeCount, 1);
  assert.strictEqual(transport.outputSeq, 4);

  const queuedFirst = transport.flush('view-a');
  const queuedSecond = transport.flush('view-a');
  assert.strictEqual(queuedFirst.data, 'queu');
  assert.strictEqual(queuedSecond.data, 'ed');
}

testSequenceWatermarkAndReplay();
testBatchingAndBackpressure();
testQueueBoundAndDetach();
testPendingCapForStalledView();
testOversizedOutputIsSplitBeforeBatching();
testFakePtyFlowControlIntegration();

console.log('outputTransport tests passed');
