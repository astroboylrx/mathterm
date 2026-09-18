const { PaneOutputTransport } = require('./outputTransport');
const { createHeadlessTerminalState } = require('./headlessTerminalState');
const { HeadlessWriteBatcher } = require('./headlessWriteBatcher');
const { createShellShim, removeShellShim } = require('./shellShim');
const { createTerminalMetadataTracker } = require('./terminalMetadata');
const { createRuntimeIdFactory } = require('../shared/runtimeIds');

class PtyManager {
  constructor({ ptyAdapter, fs, path, os, env = process.env, idFactory = createRuntimeIdFactory() } = {}) {
    if (!ptyAdapter) throw new Error('PtyManager requires a pty adapter');
    if (!fs || !path || !os) throw new Error('PtyManager requires fs, path, and os');
    this.ptyAdapter = ptyAdapter;
    this.fs = fs;
    this.path = path;
    this.os = os;
    this.env = env;
    this.idFactory = idFactory;
    // MATHTERM_PTY_DEBUG_DIR: when set, every pane's raw pty output is
    // appended to <dir>/pty-<id>.log (diagnostics only; input is never logged).
    this.debugDir = env.MATHTERM_PTY_DEBUG_DIR || null;
    this.panes = new Map();
    this.outputReadyHandlers = new Set();
    this.exitHandlers = new Set();
    this.metadataHandlers = new Set();
  }

  onOutputReady(callback) {
    this.outputReadyHandlers.add(callback);
    return { dispose: () => this.outputReadyHandlers.delete(callback) };
  }

  onExit(callback) {
    this.exitHandlers.add(callback);
    return { dispose: () => this.exitHandlers.delete(callback) };
  }

  onMetadata(callback) {
    this.metadataHandlers.add(callback);
    return { dispose: () => this.metadataHandlers.delete(callback) };
  }

  createPane({
    paneBackendId = this.idFactory.nextPaneBackendId(),
    shellCmd = this.os.platform() === 'win32'
      ? (this.env.SHELL || 'powershell.exe')
      : (this.env.SHELL || '/bin/bash'),
    shellArgs = [],
    useShim = true,
    cwd = this.env.HOME || this.os.homedir(),
    cols = 80,
    rows = 24,
    scrollback = 1000,
    envExtras = {}
  } = {}) {
    if (this.panes.has(paneBackendId)) throw new Error(`pane backend already exists: ${paneBackendId}`);
    // The bash/zsh shim (OSC 133 marks, imgcat) only makes sense for POSIX
    // shells; PowerShell/cmd/wsl.exe panes spawn with useShim: false.
    const shim = useShim === false
      ? { shimDir: null, shellArgs: Array.isArray(shellArgs) ? shellArgs : [], shellEnv: this.env }
      : createShellShim({
        fs: this.fs,
        path: this.path,
        os: this.os,
        shellCmd,
        env: this.env
      });
    const terminalState = createHeadlessTerminalState({ cols, rows, scrollback });
    const headlessWrites = new HeadlessWriteBatcher({ terminalState });
    const metadata = createTerminalMetadataTracker({
      cwd,
      home: this.env.HOME || this.os.homedir(),
      user: this.env.USER || this.env.USERNAME || ''
    });
    const pty = this.ptyAdapter.spawn(shellCmd, shim.shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...shim.shellEnv,
        ...envExtras,
        TERM_PROGRAM: 'MathTerm',
        TERM_PROGRAM_VERSION: '0.6',
        COLORTERM: 'truecolor'
      }
    });
    const outputTransport = new PaneOutputTransport({ ptyFlowControl: pty });
    const backend = {
      id: paneBackendId,
      state: 'orphaned',
      attachedViews: new Set(),
      pty,
      shell: shellCmd,
      shimDir: shim.shimDir,
      cwd,
      title: null,
      metadata,
      rows,
      cols,
      terminalState,
      headlessWrites,
      outputTransport,
      exitState: null,
      terminalWriteChain: headlessWrites.chain
    };

    pty.onData(data => {
      if (this.debugDir) this._debugLogOutput(backend, data);
      outputTransport.push(data);
      const metadataUpdates = metadata.feed(data);
      if (metadataUpdates.length) {
        for (const update of metadataUpdates) {
          if (update.type === 'command-ended') {
            metadata.command.endedWithAttachedView = backend.attachedViews.size > 0;
            update.command = { ...metadata.command };
          }
        }
        const snapshot = metadata.snapshot();
        backend.cwd = snapshot.cwd || backend.cwd;
        backend.title = snapshot.title || backend.title;
        this._emitMetadata(backend.id, snapshot, metadataUpdates);
      }
      headlessWrites.push(data);
      backend.terminalWriteChain = headlessWrites.chain;
      this._emitOutputReady(backend.id);
    });
    pty.onExit(event => {
      backend.state = 'closed';
      backend.exitState = {
        exitCode: event?.exitCode ?? null,
        signal: event?.signal ?? null
      };
      backend.outputTransport.destroy();
      backend.attachedViews.clear();
      removeShellShim({ fs: this.fs, shimDir: backend.shimDir });
      backend.shimDir = null;
      this._emitExit(backend.id, backend.exitState);
    });

    this.panes.set(paneBackendId, backend);
    return backend;
  }

  getPane(paneBackendId) {
    return this.panes.get(paneBackendId) || null;
  }

  writePane(paneBackendId, data) {
    const pane = this._requirePane(paneBackendId);
    pane.pty.write(String(data));
  }

  resizePane(paneBackendId, cols, rows) {
    const pane = this._requirePane(paneBackendId);
    pane.cols = cols;
    pane.rows = rows;
    pane.pty.resize(cols, rows);
    pane.headlessWrites.resize(cols, rows);
    pane.terminalWriteChain = pane.headlessWrites.chain;
  }

  attachView(paneBackendId, viewId) {
    const pane = this._requirePane(paneBackendId);
    if (pane.state === 'closed' || pane.state === 'closing') {
      throw new Error(`cannot attach closed pane backend: ${paneBackendId}`);
    }
    pane.attachedViews.add(String(viewId));
    pane.state = 'attached';
    pane.outputTransport.attachView(viewId);
  }

  detachView(paneBackendId, viewId) {
    const pane = this._requirePane(paneBackendId);
    pane.attachedViews.delete(String(viewId));
    pane.outputTransport.detachView(viewId);
    if (pane.state === 'attached' && pane.attachedViews.size === 0) pane.state = 'orphaned';
  }

  async snapshotPane(paneBackendId) {
    const pane = this._requirePane(paneBackendId);
    await pane.headlessWrites.wait();
    pane.terminalWriteChain = pane.headlessWrites.chain;
    const { snapshotSeq } = pane.outputTransport.beginSnapshot();
    const snapshot = pane.terminalState.serialize();
    return {
      snapshotSeq,
      snapshot,
      snapshotBytes: Buffer.byteLength(snapshot),
      cols: pane.cols,
      rows: pane.rows,
      exitState: pane.exitState,
      metadata: pane.metadata.snapshot()
    };
  }

  enqueueReplay(paneBackendId, viewId, afterSeq) {
    const pane = this._requirePane(paneBackendId);
    return pane.outputTransport.enqueueReplay(viewId, afterSeq);
  }

  flushOutput(paneBackendId, viewId) {
    const pane = this._requirePane(paneBackendId);
    return pane.outputTransport.flush(viewId);
  }

  ackOutput(paneBackendId, viewId, batchId) {
    const pane = this._requirePane(paneBackendId);
    return pane.outputTransport.ack(viewId, batchId);
  }

  async waitForTerminalWrites(paneBackendId) {
    const pane = this._requirePane(paneBackendId);
    await pane.headlessWrites.wait();
    pane.terminalWriteChain = pane.headlessWrites.chain;
  }

  closePane(paneBackendId) {
    const pane = this.getPane(paneBackendId);
    if (!pane) return;
    pane.state = 'closing';
    pane.outputTransport.destroy();
    pane.attachedViews.clear();
    try { pane.pty.kill(); } catch {}
    try { pane.headlessWrites.dispose(); } catch {}
    try { pane.terminalState.dispose(); } catch {}
    removeShellShim({ fs: this.fs, shimDir: pane.shimDir });
    pane.state = 'closed';
    this.panes.delete(paneBackendId);
  }

  closeAll() {
    for (const id of [...this.panes.keys()]) this.closePane(id);
  }

  _requirePane(paneBackendId) {
    const pane = this.getPane(paneBackendId);
    if (!pane) throw new Error(`unknown pane backend: ${paneBackendId}`);
    return pane;
  }

  _debugLogOutput(backend, data) {
    try {
      const file = this.path.join(this.debugDir, `pty-${backend.id}.log`);
      if (!backend.debugLogStarted) {
        backend.debugLogStarted = true;
        this.fs.mkdirSync(this.debugDir, { recursive: true });
        const header = { shell: backend.shell, cols: backend.cols, rows: backend.rows };
        this.fs.writeFileSync(file, `# ${JSON.stringify(header)}\n`);
      }
      this.fs.appendFileSync(file, data);
      // Sidecar chunk-timing log ("<epochMs> <bytes>" per pty read) so the
      // pacing of the byte-exact raw stream above can be reconstructed when
      // diagnosing render-timing issues (e.g. ConPTY output fragmentation).
      this.fs.appendFileSync(`${file}.timing`, `${Date.now()} ${Buffer.byteLength(String(data))}\n`);
    } catch {}
  }

  _emitOutputReady(paneBackendId) {
    for (const handler of this.outputReadyHandlers) handler(paneBackendId);
  }

  _emitExit(paneBackendId, exitState) {
    for (const handler of this.exitHandlers) handler(paneBackendId, exitState);
  }

  _emitMetadata(paneBackendId, metadata, updates) {
    for (const handler of this.metadataHandlers) handler(paneBackendId, metadata, updates);
  }
}

module.exports = { PtyManager };
