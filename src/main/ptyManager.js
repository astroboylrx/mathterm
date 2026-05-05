const { PaneOutputTransport } = require('./outputTransport');
const { createHeadlessTerminalState } = require('./headlessTerminalState');
const { createShellShim, removeShellShim } = require('./shellShim');
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
    this.panes = new Map();
  }

  createPane({
    paneBackendId = this.idFactory.nextPaneBackendId(),
    shellCmd = this.env.SHELL || '/bin/bash',
    cwd = this.env.HOME || this.os.homedir(),
    cols = 80,
    rows = 24,
    scrollback = 1000
  } = {}) {
    if (this.panes.has(paneBackendId)) throw new Error(`pane backend already exists: ${paneBackendId}`);
    const shim = createShellShim({
      fs: this.fs,
      path: this.path,
      os: this.os,
      shellCmd,
      env: this.env
    });
    const terminalState = createHeadlessTerminalState({ cols, rows, scrollback });
    const pty = this.ptyAdapter.spawn(shellCmd, shim.shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...shim.shellEnv,
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
      rows,
      cols,
      terminalState,
      outputTransport,
      exitState: null,
      terminalWriteChain: Promise.resolve()
    };

    pty.onData(data => {
      outputTransport.push(data);
      backend.terminalWriteChain = backend.terminalWriteChain.then(() => terminalState.write(data));
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
    pane.terminalState.resize(cols, rows);
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
    await pane.terminalWriteChain;
    const { snapshotSeq } = pane.outputTransport.beginSnapshot();
    const snapshot = pane.terminalState.serialize();
    return {
      snapshotSeq,
      snapshot,
      snapshotBytes: Buffer.byteLength(snapshot),
      cols: pane.cols,
      rows: pane.rows,
      exitState: pane.exitState
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
    await pane.terminalWriteChain;
  }

  closePane(paneBackendId) {
    const pane = this.getPane(paneBackendId);
    if (!pane) return;
    pane.state = 'closing';
    pane.outputTransport.destroy();
    pane.attachedViews.clear();
    try { pane.pty.kill(); } catch {}
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
}

module.exports = { PtyManager };
