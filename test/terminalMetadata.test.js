const assert = require('assert');
const {
  createTerminalMetadataTracker,
  cwdFromFileUri,
  resolveTildePath
} = require('../src/main/terminalMetadata');

function testCwdHelpers() {
  assert.strictEqual(resolveTildePath('~', '/home/u'), '/home/u');
  assert.strictEqual(resolveTildePath('~/work', '/home/u'), '/home/u/work');
  assert.strictEqual(resolveTildePath('/tmp', '/home/u'), '/tmp');
  assert.strictEqual(cwdFromFileUri('/home/u/a%20b'), '/home/u/a b');
}

function testChunkedOsc7AndTitle() {
  const tracker = createTerminalMetadataTracker({ cwd: '/home/u', home: '/home/u', user: 'u' });
  assert.deepStrictEqual(tracker.feed('\x1b]7;file://host/home/u/pro'), []);
  const updates = tracker.feed('j\x07');
  assert.deepStrictEqual(updates, [{ type: 'cwd', cwd: '/home/u/proj' }]);
  assert.strictEqual(tracker.snapshot().cwd, '/home/u/proj');
  assert.strictEqual(tracker.snapshot().promptPrefix, 'u@host');

  const titleUpdates = tracker.feed('\x1b]0;u@host:~/src\x1b\\');
  assert.strictEqual(titleUpdates.length, 1);
  assert.strictEqual(titleUpdates[0].title, 'u@host:~/src');
  assert.strictEqual(titleUpdates[0].cwd, '/home/u/src');
  assert.strictEqual(tracker.snapshot().title, 'u@host:~/src');
}

function testOsc133CommandState() {
  let now = 1000;
  const tracker = createTerminalMetadataTracker({ now: () => now });
  const start = tracker.feed('\x1b]133;C\x07');
  assert.strictEqual(start[0].type, 'command-started');
  assert.strictEqual(start[0].command.running, true);
  assert.strictEqual(start[0].command.startedAt, 1000);
  now = 2500;
  const end = tracker.feed('\x1b]133;D;7\x07');
  assert.strictEqual(end[0].type, 'command-ended');
  assert.strictEqual(end[0].command.running, false);
  assert.strictEqual(end[0].command.lastExitCode, '7');
  assert.strictEqual(end[0].command.endedWithAttachedView, false);
  assert.strictEqual(tracker.snapshot().command.endedAt, 2500);
}

testCwdHelpers();
testChunkedOsc7AndTitle();
testOsc133CommandState();

console.log('terminalMetadata tests passed');
