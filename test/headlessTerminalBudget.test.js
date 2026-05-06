const assert = require('assert');
const { createHeadlessTerminalState } = require('../src/main/headlessTerminalState');

async function writeMany(termState, lines) {
  for (let i = 0; i < lines; i += 1) {
    const color = 31 + (i % 7);
    await termState.write(`line ${String(i).padStart(4, '0')} \x1b[${color}mcolored output\x1b[0m ${'x'.repeat(48)}\r\n`);
  }
}

async function testSnapshotBudgetForRealisticScrollback() {
  const termState = createHeadlessTerminalState({ cols: 100, rows: 30, scrollback: 1000 });
  await writeMany(termState, 1200);
  const metrics = termState.snapshotMetrics();

  assert.ok(metrics.bytes > 0);
  assert.ok(metrics.chars > 0);
  assert.ok(metrics.bytes < 2 * 1024 * 1024, `snapshot unexpectedly large: ${metrics.bytes} bytes`);

  if (process.env.MATHTERM_BUDGET_VERBOSE) {
    console.log(`headless snapshot budget: ${metrics.bytes} bytes, ${metrics.chars} chars`);
  }
  termState.dispose();
}

async function testAlternateScreenSnapshotBudget() {
  const termState = createHeadlessTerminalState({ cols: 100, rows: 30, scrollback: 1000 });
  await termState.write('main-buffer-before-alt\r\n');
  await termState.write('\x1b[?1049h');
  await writeMany(termState, 80);
  const metrics = termState.snapshotMetrics();
  const excludeAltMetrics = termState.snapshotMetrics({ excludeAltBuffer: true });

  assert.ok(metrics.bytes > 0);
  assert.ok(metrics.bytes < 512 * 1024, `alternate-screen snapshot unexpectedly large: ${metrics.bytes} bytes`);
  assert.ok(excludeAltMetrics.bytes > 0);
  assert.ok(excludeAltMetrics.bytes < metrics.bytes, 'excludeAltBuffer should omit active alternate-screen content');

  await termState.write('\x1b[?1049l');
  termState.dispose();
}

async function run() {
  await testSnapshotBudgetForRealisticScrollback();
  await testAlternateScreenSnapshotBudget();
  console.log('headlessTerminalBudget tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
