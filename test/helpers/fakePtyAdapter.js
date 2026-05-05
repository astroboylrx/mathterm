class FakeDisposable {
  constructor(remove) {
    this._remove = remove;
  }

  dispose() {
    if (this._remove) this._remove();
    this._remove = null;
  }
}

class FakePtyProcess {
  constructor({ pid = 1000, cols = 80, rows = 24, cwd = process.cwd() } = {}) {
    this.pid = pid;
    this.cols = cols;
    this.rows = rows;
    this.cwd = cwd;
    this.killed = false;
    this.paused = false;
    this.writes = [];
    this.pauseCount = 0;
    this.resumeCount = 0;
    this._dataHandlers = new Set();
    this._exitHandlers = new Set();
    this._pausedData = [];
  }

  onData(callback) {
    this._dataHandlers.add(callback);
    return new FakeDisposable(() => this._dataHandlers.delete(callback));
  }

  onExit(callback) {
    this._exitHandlers.add(callback);
    return new FakeDisposable(() => this._exitHandlers.delete(callback));
  }

  write(data) {
    this.writes.push(String(data));
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
  }

  kill(exitCode = 0, signal = 0) {
    if (this.killed) return;
    this.killed = true;
    for (const handler of this._exitHandlers) handler({ exitCode, signal });
  }

  pause() {
    this.paused = true;
    this.pauseCount += 1;
  }

  resume() {
    this.paused = false;
    this.resumeCount += 1;
    const queued = this._pausedData.splice(0);
    for (const data of queued) this.emitData(data);
  }

  emitData(data) {
    if (this.paused) {
      this._pausedData.push(String(data));
      return;
    }
    for (const handler of this._dataHandlers) handler(String(data));
  }
}

class FakePtyAdapter {
  constructor() {
    this.nextPid = 1000;
    this.processes = [];
  }

  spawn(file, args = [], opts = {}) {
    const pty = new FakePtyProcess({
      pid: this.nextPid++,
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd: opts.cwd || process.cwd()
    });
    pty.file = file;
    pty.args = args;
    pty.env = opts.env || {};
    this.processes.push(pty);
    return pty;
  }
}

module.exports = { FakePtyAdapter, FakePtyProcess };
