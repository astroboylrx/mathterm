function byteLength(data) {
  return Buffer.byteLength(String(data));
}

function splitByMaxBytes(data, maxBytes) {
  const text = String(data);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || byteLength(text) <= maxBytes) return [text];
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  for (const char of text) {
    const charBytes = byteLength(char);
    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

class PaneOutputTransport {
  constructor({
    maxQueueBytes = 1024 * 1024,
    maxBatchBytes = 64 * 1024,
    highWatermarkBytes = 512 * 1024,
    lowWatermarkBytes = 256 * 1024,
    maxPendingBytes = Math.max(maxQueueBytes, highWatermarkBytes),
    ptyFlowControl = null
  } = {}) {
    this.maxQueueBytes = maxQueueBytes;
    this.maxBatchBytes = maxBatchBytes;
    this.maxPendingBytes = maxPendingBytes;
    this.highWatermarkBytes = highWatermarkBytes;
    this.lowWatermarkBytes = lowWatermarkBytes;
    this.ptyFlowControl = ptyFlowControl;
    this.outputSeq = 0;
    this.queue = [];
    this.queueBytes = 0;
    this.views = new Map();
    this.paused = false;
  }

  attachView(viewId) {
    const key = String(viewId);
    if (!this.views.has(key)) {
      this.views.set(key, {
        viewId: key,
        pending: [],
        pendingBytes: 0,
        droppedPendingChunks: 0,
        pendingOverflowWarned: false,
        unacked: new Map(),
        unackedBytes: 0,
        nextBatchId: 1
      });
    }
    return this.views.get(key);
  }

  detachView(viewId) {
    this.views.delete(String(viewId));
    this._updateBackpressure();
  }

  push(data) {
    let lastSeq = this.outputSeq;
    for (const part of splitByMaxBytes(data, this.maxBatchBytes)) {
      const chunk = {
        seq: ++this.outputSeq,
        data: part,
        bytes: byteLength(part)
      };
      lastSeq = chunk.seq;
      this.queue.push(chunk);
      this.queueBytes += chunk.bytes;
      this._trimQueue();
      for (const view of this.views.values()) this._appendPending(view, [chunk]);
    }
    this._updateBackpressure();
    return lastSeq;
  }

  beginSnapshot() {
    return { snapshotSeq: this.outputSeq };
  }

  bufferedAfter(seq) {
    return this.queue.filter(chunk => chunk.seq > seq);
  }

  enqueueReplay(viewId, afterSeq) {
    const view = this.attachView(viewId);
    this._appendPending(view, this.bufferedAfter(afterSeq));
    return view.pending.length;
  }

  flush(viewId) {
    const view = this.views.get(String(viewId));
    if (!view || view.pending.length === 0) return null;

    const chunks = [];
    let bytes = 0;
    while (view.pending.length) {
      const next = view.pending[0];
      if (chunks.length && bytes + next.bytes > this.maxBatchBytes) break;
      chunks.push(view.pending.shift());
      bytes += next.bytes;
      view.pendingBytes -= next.bytes;
      if (bytes >= this.maxBatchBytes) break;
    }
    if (!chunks.length) return null;

    const batch = {
      batchId: view.nextBatchId++,
      fromSeq: chunks[0].seq,
      toSeq: chunks[chunks.length - 1].seq,
      bytes,
      data: chunks.map(chunk => chunk.data).join('')
    };
    view.unacked.set(batch.batchId, batch);
    view.unackedBytes += bytes;
    this._updateBackpressure();
    return batch;
  }

  ack(viewId, batchId) {
    const view = this.views.get(String(viewId));
    if (!view) return false;
    const batch = view.unacked.get(batchId);
    if (!batch) return false;
    view.unacked.delete(batchId);
    view.unackedBytes -= batch.bytes;
    this._updateBackpressure();
    return true;
  }

  viewState(viewId) {
    const view = this.views.get(String(viewId));
    if (!view) return null;
    return {
      pendingChunks: view.pending.length,
      unackedBatches: view.unacked.size,
      unackedBytes: view.unackedBytes,
      pendingBytes: view.pendingBytes,
      droppedPendingChunks: view.droppedPendingChunks
    };
  }

  destroy() {
    for (const view of this.views.values()) {
      view.pending.length = 0;
      view.pendingBytes = 0;
      view.unacked.clear();
      view.unackedBytes = 0;
    }
    this.views.clear();
    this._updateBackpressure();
  }

  _appendPending(view, chunks) {
    for (const chunk of chunks) {
      view.pending.push(chunk);
      view.pendingBytes += chunk.bytes;
    }
    while (view.pendingBytes > this.maxPendingBytes && view.pending.length) {
      const removed = view.pending.shift();
      view.pendingBytes -= removed.bytes;
      view.droppedPendingChunks += 1;
    }
    if (view.droppedPendingChunks && !view.pendingOverflowWarned) {
      view.pendingOverflowWarned = true;
      console.warn(`MathTerm dropped pending PTY output for stalled view ${view.viewId}`);
    }
  }

  _trimQueue() {
    while (this.queueBytes > this.maxQueueBytes && this.queue.length > 1) {
      const removed = this.queue.shift();
      this.queueBytes -= removed.bytes;
    }
  }

  _updateBackpressure() {
    const maxUnacked = Math.max(0, ...Array.from(this.views.values(), view => view.unackedBytes));
    if (!this.paused && maxUnacked > this.highWatermarkBytes) {
      this.paused = true;
      if (this.ptyFlowControl?.pause) this.ptyFlowControl.pause();
    } else if (this.paused && maxUnacked <= this.lowWatermarkBytes) {
      this.paused = false;
      if (this.ptyFlowControl?.resume) this.ptyFlowControl.resume();
    }
  }
}

module.exports = { PaneOutputTransport, byteLength, splitByMaxBytes };
