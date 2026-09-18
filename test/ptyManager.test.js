const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PtyManager } = require('../src/main/ptyManager');
const { FakePtyAdapter } = require('./helpers/fakePtyAdapter');

function createManager() {
  const adapter = new FakePtyAdapter();
  const manager = new PtyManager({
    ptyAdapter: adapter,
    fs,
    path,
    os,
    env: {
      HOME: os.homedir(),
      SHELL: '/bin/bash',
      PATH: process.env.PATH
    }
  });
  return { adapter, manager };
}

async function testCreateWriteResizeSnapshotAndClose() {
  const { adapter, manager } = createManager();
  const pane = manager.createPane({ paneBackendId: 'pane-test', cwd: os.tmpdir(), cols: 40, rows: 10 });
  assert.strictEqual(pane.state, 'orphaned');
  assert.strictEqual(adapter.processes.length, 1);
  assert.strictEqual(pane.pty.cols, 40);
  assert.strictEqual(pane.pty.rows, 10);
  assert.ok(fs.existsSync(pane.shimDir));

  manager.writePane('pane-test', 'input');
  assert.deepStrictEqual(pane.pty.writes, ['input']);

  manager.resizePane('pane-test', 100, 30);
  assert.strictEqual(pane.pty.cols, 100);
  assert.strictEqual(pane.pty.rows, 30);
  await manager.waitForTerminalWrites('pane-test');
  assert.strictEqual(pane.terminalState.terminal.cols, 100);
  assert.strictEqual(pane.terminalState.terminal.rows, 30);

  pane.pty.emitData('hello\r\nworld');
  pane.pty.emitData('\x1b]7;file://host/tmp\x07');
  await manager.waitForTerminalWrites('pane-test');
  const snapshot = await manager.snapshotPane('pane-test');
  assert.strictEqual(snapshot.snapshotSeq, 2);
  assert.ok(snapshot.snapshot.includes('hello'));
  assert.ok(snapshot.snapshotBytes > 0);
  assert.strictEqual(snapshot.metadata.cwd, '/tmp');

  manager.attachView('pane-test', 'view-a');
  assert.strictEqual(pane.state, 'attached');
  assert.ok(pane.outputTransport.viewState('view-a'));
  manager.detachView('pane-test', 'view-a');
  assert.strictEqual(pane.state, 'orphaned');

  manager.attachView('pane-test', 'view-a');
  manager.closePane('pane-test');
  assert.strictEqual(manager.getPane('pane-test'), null);
  assert.strictEqual(pane.state, 'closed');
  assert.strictEqual(pane.outputTransport.viewState('view-a'), null);
  assert.strictEqual(fs.existsSync(pane.shimDir || ''), false);
}

async function testReplayAndAck() {
  const { manager } = createManager();
  const pane = manager.createPane({ paneBackendId: 'pane-replay' });
  pane.pty.emitData('one');
  await manager.waitForTerminalWrites('pane-replay');
  const snapshot = await manager.snapshotPane('pane-replay');
  pane.pty.emitData('two');
  pane.pty.emitData('three');

  manager.attachView('pane-replay', 'view-b');
  assert.strictEqual(manager.enqueueReplay('pane-replay', 'view-b', snapshot.snapshotSeq), 2);
  const batch = manager.flushOutput('pane-replay', 'view-b');
  assert.strictEqual(batch.data, 'twothree');
  assert.strictEqual(manager.ackOutput('pane-replay', 'view-b', batch.batchId), true);
  manager.closeAll();
}

async function testOutputAndExitEvents() {
  const { manager } = createManager();
  const pane = manager.createPane({ paneBackendId: 'pane-events' });
  const outputReady = [];
  const exits = [];
  const metadata = [];
  const outputDisposable = manager.onOutputReady(id => outputReady.push(id));
  const exitDisposable = manager.onExit((id, exitState) => exits.push({ id, exitState }));
  const metadataDisposable = manager.onMetadata((id, snapshot, updates) => metadata.push({ id, snapshot, updates }));

  pane.pty.emitData('evented output');
  await manager.waitForTerminalWrites('pane-events');
  assert.deepStrictEqual(outputReady, ['pane-events']);
  pane.pty.emitData('\x1b]133;C\x07');
  assert.strictEqual(metadata.length, 1);
  assert.strictEqual(metadata[0].id, 'pane-events');
  assert.strictEqual(metadata[0].snapshot.command.running, true);
  assert.strictEqual(metadata[0].updates[0].type, 'command-started');
  manager.attachView('pane-events', 'view-meta');
  pane.pty.emitData('\x1b]133;D;0\x07');
  assert.strictEqual(metadata.length, 2);
  assert.strictEqual(metadata[1].snapshot.command.endedWithAttachedView, true);
  manager.detachView('pane-events', 'view-meta');

  pane.pty.kill(3, 0);
  assert.deepStrictEqual(exits, [{ id: 'pane-events', exitState: { exitCode: 3, signal: 0 } }]);

  outputDisposable.dispose();
  exitDisposable.dispose();
  metadataDisposable.dispose();
  manager.closePane('pane-events');
}

async function testExitCleansShimButKeepsSnapshot() {
  const { manager } = createManager();
  const pane = manager.createPane({ paneBackendId: 'pane-exit' });
  const shimDir = pane.shimDir;
  pane.pty.emitData('before exit');
  pane.pty.kill(7, 0);
  await manager.waitForTerminalWrites('pane-exit');
  assert.strictEqual(pane.state, 'closed');
  assert.deepStrictEqual(pane.exitState, { exitCode: 7, signal: 0 });
  assert.strictEqual(pane.shimDir, null);
  assert.strictEqual(fs.existsSync(shimDir), false);
  const snapshot = await manager.snapshotPane('pane-exit');
  assert.ok(snapshot.snapshot.includes('before exit'));
  assert.deepStrictEqual(snapshot.exitState, { exitCode: 7, signal: 0 });
  manager.closePane('pane-exit');
}

async function testUseShimFalseSkipsShim() {
  const { adapter, manager } = createManager();
  const pane = manager.createPane({
    paneBackendId: 'pane-noshim',
    shellCmd: 'powershell.exe',
    shellArgs: ['-NoLogo', '-NoProfile'],
    useShim: false,
    cwd: os.tmpdir(),
    cols: 50,
    rows: 12
  });
  assert.strictEqual(pane.shimDir, null);
  assert.strictEqual(adapter.processes.length, 1);
  // Args reach spawn untouched instead of the shim's --rcfile injection.
  assert.strictEqual(pane.pty.file, 'powershell.exe');
  assert.deepStrictEqual(pane.pty.args, ['-NoLogo', '-NoProfile']);
  assert.strictEqual(pane.pty.env.TERM_PROGRAM, 'MathTerm');
  pane.pty.emitData('plain shell');
  await manager.waitForTerminalWrites('pane-noshim');
  const snapshot = await manager.snapshotPane('pane-noshim');
  assert.ok(snapshot.snapshot.includes('plain shell'));
  manager.closePane('pane-noshim');
}

async function testDefaultShellOnWin32() {
  const adapter = new FakePtyAdapter();
  const manager = new PtyManager({
    ptyAdapter: adapter,
    fs,
    path,
    os: { platform: () => 'win32', homedir: () => os.homedir(), tmpdir: () => os.tmpdir() },
    env: { USERNAME: 'winuser' }
  });
  const pane = manager.createPane({ paneBackendId: 'pane-windefault', useShim: false });
  assert.strictEqual(pane.pty.file, 'powershell.exe');
  assert.deepStrictEqual(pane.pty.args, []);
  manager.closePane('pane-windefault');
}

async function testDebugLogWritesRawOutput() {
  const adapter = new FakePtyAdapter();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathterm-pty-debug-'));
  const manager = new PtyManager({
    ptyAdapter: adapter,
    fs,
    path,
    os,
    env: {
      HOME: os.homedir(),
      SHELL: '/bin/bash',
      PATH: process.env.PATH,
      MATHTERM_PTY_DEBUG_DIR: dir
    }
  });
  const pane = manager.createPane({ paneBackendId: 'pane-debug', cwd: os.tmpdir(), cols: 40, rows: 10 });
  pane.pty.emitData('hello');
  pane.pty.emitData('\x1b[8msecret');
  const log = fs.readFileSync(path.join(dir, 'pty-pane-debug.log'), 'utf8');
  assert.ok(log.startsWith(`# ${JSON.stringify({ shell: '/bin/bash', cols: 40, rows: 10 })}\n`));
  assert.ok(log.endsWith('hello\x1b[8msecret'));
  const timing = fs.readFileSync(path.join(dir, 'pty-pane-debug.log.timing'), 'utf8').trim().split('\n');
  assert.strictEqual(timing.length, 2);
  assert.ok(/^\d+ 5$/.test(timing[0]), `first chunk was 5 bytes: ${timing[0]}`);
  assert.ok(/^\d+ 10$/.test(timing[1]), `second chunk was 10 bytes: ${timing[1]}`);
  manager.closeAll();
}

async function run() {
  await testCreateWriteResizeSnapshotAndClose();
  await testReplayAndAck();
  await testOutputAndExitEvents();
  await testExitCleansShimButKeepsSnapshot();
  await testUseShimFalseSkipsShim();
  await testDefaultShellOnWin32();
  await testDebugLogWritesRawOutput();
  console.log('ptyManager tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
