// Windows-only pane output coalescer. ConPTY re-emits synchronized-output
// (DEC mode 2026) frames as unwrapped drawing spread over several chunks:
// the 2026 markers pass through as empty shells and the frame's drawing
// trails behind them in chunks measured ~10-14ms apart (frames themselves
// are ~130ms apart), so writing every chunk straight into xterm.js paints
// the cursor at mid-flight positions (visible jumping during animations
// such as codex's whimsy banner). This coalescer holds pane output until
// the stream goes quiet, then delivers the whole burst at once so it
// renders with its final cursor position. Bursts containing a 2026 frame
// start (flagged by the caller via `syncFrame`) use a longer quiet window
// since their drawing chunks arrive further apart than ordinary output.
// POSIX panes never use this: their 2026 markers reach xterm.js intact,
// which already renders such frames atomically.
function createOutputCoalescer({
  deliver,
  quietMs = 8,
  maxHoldMs = 40,
  syncQuietMs = 40,
  syncMaxHoldMs = 150,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  now = () => Date.now()
} = {}) {
  if (typeof deliver !== 'function') throw new Error('createOutputCoalescer requires a deliver function');
  let queue = [];
  let timer = null;
  let firstQueuedAt = null;
  let syncMode = false;

  function cancelTimer() {
    if (timer === null) return;
    clearTimeoutImpl(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    if (!queue.length) {
      firstQueuedAt = null;
      syncMode = false;
      return;
    }
    const items = queue;
    queue = [];
    firstQueuedAt = null;
    syncMode = false;
    deliver(items);
  }

  function push(item, { syncFrame = false } = {}) {
    queue.push(item);
    if (syncFrame) syncMode = true;
    const t = now();
    if (firstQueuedAt === null) firstQueuedAt = t;
    const heldFor = t - firstQueuedAt;
    const maxHold = syncMode ? syncMaxHoldMs : maxHoldMs;
    if (heldFor >= maxHold) {
      flush();
      return;
    }
    cancelTimer();
    const quiet = syncMode ? syncQuietMs : quietMs;
    timer = setTimeoutImpl(flush, Math.min(quiet, maxHold - heldFor));
  }

  function cancel() {
    cancelTimer();
    queue = [];
    firstQueuedAt = null;
    syncMode = false;
  }

  return {
    push,
    flush,
    cancel,
    get size() { return queue.length; }
  };
}

module.exports = { createOutputCoalescer };
