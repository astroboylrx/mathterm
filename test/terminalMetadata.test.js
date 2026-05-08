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
  assert.deepStrictEqual(updates, [{
    type: 'cwd',
    displayHost: 'host',
    promptPrefix: 'u@host',
    cwd: '/home/u/proj'
  }]);
  assert.strictEqual(tracker.snapshot().cwd, '/home/u/proj');
  assert.strictEqual(tracker.snapshot().displayHost, 'host');
  assert.strictEqual(tracker.snapshot().promptPrefix, 'u@host');

  const titleUpdates = tracker.feed('\x1b]0;u@host:~/src\x1b\\');
  assert.strictEqual(titleUpdates.length, 1);
  assert.strictEqual(titleUpdates[0].title, 'u@host:~/src');
  assert.strictEqual(titleUpdates[0].cwd, '/home/u/src');
  assert.strictEqual(tracker.snapshot().title, 'u@host:~/src');
}

function testHostChangesWithoutCwdChanges() {
  const tracker = createTerminalMetadataTracker({ cwd: '/home/u', home: '/home/u', user: 'u' });
  let updates = tracker.feed('\x1b]7;file://local.example.com/home/u\x07');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].displayHost, 'local');
  assert.strictEqual(tracker.snapshot().displayHost, 'local');

  updates = tracker.feed('\x1b]7;file://remote.example.com/home/u\x07');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].displayHost, 'remote');
  assert.strictEqual(updates[0].promptPrefix, 'u@remote.example.com');
  assert.strictEqual(updates[0].cwd, undefined);
  assert.strictEqual(tracker.snapshot().cwd, '/home/u');
  assert.strictEqual(tracker.snapshot().displayHost, 'remote');
}

function testTitleUpdatesPromptPrefixAndHost() {
  const tracker = createTerminalMetadataTracker({ cwd: '/home/u', home: '/home/u', user: 'localuser' });
  tracker.feed('\x1b]7;file://remote.example.com/home/u\x07');
  assert.strictEqual(tracker.snapshot().promptPrefix, 'localuser@remote.example.com');

  const updates = tracker.feed('\x1b]0;deploy@remote.example.com:~/app\x07');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].promptPrefix, 'deploy@remote.example.com');
  assert.strictEqual(updates[0].cwd, '/home/u/app');
  assert.strictEqual(tracker.snapshot().displayHost, 'remote');
  assert.strictEqual(tracker.snapshot().promptPrefix, 'deploy@remote.example.com');
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

function testPlainTextFastPathAndSplitEscape() {
  const tracker = createTerminalMetadataTracker({ cwd: '/home/u', home: '/home/u', user: 'u' });
  assert.deepStrictEqual(tracker.feed('plain output without escapes'), []);
  assert.deepStrictEqual(tracker.feed('\x1b'), []);
  const updates = tracker.feed(']0;u@host:~/later\x07');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].title, 'u@host:~/later');
  assert.strictEqual(updates[0].cwd, '/home/u/later');
}

testCwdHelpers();
testChunkedOsc7AndTitle();
testHostChangesWithoutCwdChanges();
testTitleUpdatesPromptPrefixAndHost();
testOsc133CommandState();
testPlainTextFastPathAndSplitEscape();

console.log('terminalMetadata tests passed');
