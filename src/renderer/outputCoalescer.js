// Windows-only pane output coalescer. ConPTY re-emits synchronized-output
// (DEC mode 2026) frames as unwrapped drawing spread over many chunks and
// tens of milliseconds, so writing every chunk straight into xterm.js paints
// the cursor at mid-flight positions (visible jumping during animations such
// as codex's whimsy banner). This coalescer holds pane output until the
// stream goes quiet for `quietMs` (or `maxHoldMs` elapses since the first
// held chunk, so floods still render periodically) and then delivers the
// whole burst at once, so it renders with its final cursor position. POSIX
// panes never use this: their 2026 markers reach xterm.js intact, which
// already renders such frames atomically.
function createOutputCoalescer({
  deliver,
  quietMs = 8,
  maxHoldMs = 40,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  now = () => Date.now()
} = {}) {
  if (typeof deliver !== 'function') throw new Error('createOutputCoalescer requires a deliver function');
  let queue = [];
  let timer = null;
  let firstQueuedAt = null;

  function cancelTimer() {
    if (timer === null) return;
    clearTimeoutImpl(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    if (!queue.length) {
      firstQueuedAt = null;
      return;
    }
    const items = queue;
    queue = [];
    firstQueuedAt = null;
    deliver(items);
  }

  function push(item) {
    queue.push(item);
    const t = now();
    if (firstQueuedAt === null) firstQueuedAt = t;
    const heldFor = t - firstQueuedAt;
    if (heldFor >= maxHoldMs) {
      flush();
      return;
    }
    cancelTimer();
    timer = setTimeoutImpl(flush, Math.min(quietMs, maxHoldMs - heldFor));
  }

  function cancel() {
    cancelTimer();
    queue = [];
    firstQueuedAt = null;
  }

  return {
    push,
    flush,
    cancel,
    get size() { return queue.length; }
  };
}

module.exports = { createOutputCoalescer };
