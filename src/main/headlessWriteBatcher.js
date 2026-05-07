function defaultByteLength(data) {
  return Buffer.byteLength(String(data));
}

class HeadlessWriteBatcher {
  constructor({
    terminalState,
    maxBatchBytes = 128 * 1024,
    byteLength = defaultByteLength,
    schedule = setImmediate
  } = {}) {
    if (!terminalState) throw new Error('HeadlessWriteBatcher requires terminalState');
    this.terminalState = terminalState;
    this.maxBatchBytes = maxBatchBytes;
    this.byteLength = byteLength;
    this.schedule = schedule;
    this.pending = '';
    this.pendingBytes = 0;
    this.scheduled = false;
    this.disposed = false;
    this.chain = Promise.resolve();
    this.writeCount = 0;
  }

  push(data) {
    if (this.disposed) return;
    const text = String(data || '');
    if (!text) return;
    this.pending += text;
    this.pendingBytes += this.byteLength(text);
    if (this.pendingBytes >= this.maxBatchBytes) {
      this.flush();
      return;
    }
    this._scheduleFlush();
  }

  resize(cols, rows) {
    if (this.disposed) return this.chain;
    this.flush();
    this.chain = this.chain.then(() => {
      if (!this.disposed) this.terminalState.resize(cols, rows);
    });
    return this.chain;
  }

  flush() {
    if (this.disposed || !this.pending) return this.chain;
    const data = this.pending;
    this.pending = '';
    this.pendingBytes = 0;
    this.scheduled = false;
    this.chain = this.chain.then(() => {
      if (this.disposed) return undefined;
      this.writeCount += 1;
      return this.terminalState.write(data);
    });
    return this.chain;
  }

  wait() {
    this.flush();
    return this.chain;
  }

  dispose() {
    this.disposed = true;
    this.pending = '';
    this.pendingBytes = 0;
    this.scheduled = false;
  }

  _scheduleFlush() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    this.schedule(() => {
      if (!this.scheduled) return;
      this.flush();
    });
  }
}

module.exports = { HeadlessWriteBatcher };
