const assert = require('assert');
const {
  promptMarkerSemanticText,
  capturePromptMarkerSnapshot,
  promptMarkerSnapshotMatches,
  PROMPT_SNAPSHOT_MAX_CHARS
} = require('../src/renderer/promptTrack');

function line(text, wrapped = false) {
  const cells = [...text].map(ch => ({
    getChars: () => ch,
    getWidth: () => 1
  }));
  cells.push({ getChars: () => '', getWidth: () => 1 });
  return {
    isWrapped: wrapped,
    length: cells.length,
    getCell: x => cells[x] || null,
    translateToString: () => text
  };
}

function buffer(rows) {
  return {
    getLine(y) {
      return rows[y] || null;
    }
  };
}

function marker(lineNumber) {
  return { line: lineNumber, isDisposed: false };
}

function entry(start, end) {
  return { start: marker(start), end: marker(end) };
}

function testSnapshotSurvivesSoftReflow() {
  const original = buffer([
    line('user@host:~$ echo a very '),
    line('long command', true)
  ]);
  // OSC 133;B is emitted before input, so its marker remains on the first
  // physical row even when the completed command later wraps.
  const prompt = entry(0, 0);
  assert.strictEqual(capturePromptMarkerSnapshot(original, prompt), true);
  assert.strictEqual(prompt.snapshotText, 'user@host:~$ echo a very long command');

  const reflowed = buffer([
    line('user@host:~$ '),
    line('echo a very ', true),
    line('long command', true)
  ]);
  prompt.start.line = 0;
  prompt.end.line = 0;
  assert.strictEqual(promptMarkerSnapshotMatches(reflowed, prompt), true);
}

function testSnapshotPreservesMultilinePromptBoundaries() {
  const original = buffer([
    line('user@host ~/project'),
    line('$ printf hello')
  ]);
  const prompt = entry(0, 1);
  assert.strictEqual(
    promptMarkerSemanticText(original, prompt),
    'user@host ~/project\n$ printf hello'
  );
  assert.strictEqual(capturePromptMarkerSnapshot(original, prompt), true);

  const reflowed = buffer([
    line('user@host '),
    line('~/project', true),
    line('$ printf '),
    line('hello', true)
  ]);
  prompt.start.line = 0;
  prompt.end.line = 3;
  assert.strictEqual(promptMarkerSnapshotMatches(reflowed, prompt), true);
}

function testTuiRewriteInvalidatesPromptSnapshot() {
  const original = buffer([line('$ claude')]);
  const prompt = entry(0, 0);
  assert.strictEqual(capturePromptMarkerSnapshot(original, prompt), true);

  const rewritten = buffer([
    line('Claude Code v2.1.246'),
    line('Please derive the escape velocity formula.'),
    line('Thought for 25s')
  ]);
  prompt.end.line = 2;
  assert.strictEqual(promptMarkerSnapshotMatches(rewritten, prompt), false);
}

function testWhitespacePlacementAcrossReflowIsIgnored() {
  const original = buffer([
    line('$ command with '),
    line('arguments', true)
  ]);
  const prompt = entry(0, 1);
  assert.strictEqual(capturePromptMarkerSnapshot(original, prompt), true);

  const reflowed = buffer([
    line('$ command '),
    line('with arguments', true)
  ]);
  prompt.end.line = 1;
  assert.strictEqual(promptMarkerSnapshotMatches(reflowed, prompt), true);
}

function testMissingSnapshotRemainsValid() {
  const prompt = entry(0, 0);
  assert.strictEqual(promptMarkerSnapshotMatches(buffer([line('anything')]), prompt), true);
}

function testOversizedRewriteInvalidatesSmallSnapshot() {
  const original = buffer([line('$ claude')]);
  const prompt = entry(0, 0);
  assert.strictEqual(capturePromptMarkerSnapshot(original, prompt), true);

  const rewritten = buffer([line('x'.repeat(PROMPT_SNAPSHOT_MAX_CHARS + 1))]);
  assert.strictEqual(promptMarkerSnapshotMatches(rewritten, prompt), false);
}

testSnapshotSurvivesSoftReflow();
testSnapshotPreservesMultilinePromptBoundaries();
testTuiRewriteInvalidatesPromptSnapshot();
testWhitespacePlacementAcrossReflowIsIgnored();
testMissingSnapshotRemainsValid();
testOversizedRewriteInvalidatesSmallSnapshot();

console.log('promptTrack tests passed');
