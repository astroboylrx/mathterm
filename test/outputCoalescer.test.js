const assert = require('assert');
const { createOutputCoalescer } = require('../src/renderer/outputCoalescer');

// Deterministic clock/timer rig: advance() moves time forward and fires any
// timers that come due, in due order.
function createFakeTimers() {
  let t = 0;
  const timers = [];
  const rig = {
    now: () => t,
    advance(ms) {
      const target = t + ms;
      for (;;) {
        timers.sort((a, b) => a.due - b.due);
        const next = timers[0];
        if (!next || next.due > target) break;
        timers.shift();
        t = next.due;
        if (!next.cleared) next.fn();
      }
      t = target;
    },
    setTimeoutImpl(fn, ms) {
      const timer = { fn, due: t + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      if (timer) timer.cleared = true;
    }
  };
  return rig;
}

function createHarness(opts = {}) {
  const rig = createFakeTimers();
  const deliveries = [];
  const coalescer = createOutputCoalescer({
    deliver: (items) => deliveries.push(items),
    setTimeoutImpl: rig.setTimeoutImpl,
    clearTimeoutImpl: rig.clearTimeoutImpl,
    now: rig.now,
    ...opts
  });
  return { rig, deliveries, coalescer };
}

function testBurstCoalescesIntoOneDelivery() {
  const { rig, deliveries, coalescer } = createHarness();
  coalescer.push('a');
  rig.advance(2);
  coalescer.push('b');
  rig.advance(2);
  coalescer.push('c');
  rig.advance(4);
  assert.strictEqual(deliveries.length, 0, 'nothing delivered while the burst keeps arriving');
  rig.advance(8); // 8ms of quiet after 'c'
  assert.strictEqual(deliveries.length, 1, 'burst delivered once');
  assert.deepStrictEqual(deliveries[0], ['a', 'b', 'c']);
}

function testQuietGapSplitsDeliveries() {
  const { rig, deliveries, coalescer } = createHarness();
  coalescer.push('a');
  rig.advance(8);
  assert.strictEqual(deliveries.length, 1);
  coalescer.push('b');
  rig.advance(8);
  assert.strictEqual(deliveries.length, 2);
  assert.deepStrictEqual(deliveries[0], ['a']);
  assert.deepStrictEqual(deliveries[1], ['b']);
}

function testMaxHoldForcesFlushDuringFlood() {
  const { rig, deliveries, coalescer } = createHarness({ quietMs: 8, maxHoldMs: 20 });
  for (let i = 0; i < 20; i++) {
    coalescer.push(`c${i}`);
    rig.advance(5); // never quiet for 8ms, but maxHold caps the hold at 20ms
  }
  assert.ok(deliveries.length >= 2, `expected periodic flushes during a flood, got ${deliveries.length}`);
  const merged = deliveries.flat();
  assert.deepStrictEqual(merged, Array.from({ length: 20 }, (_, i) => `c${i}`), 'order preserved, nothing dropped');
  const firstDelivery = deliveries[0];
  assert.ok(firstDelivery.length <= 5, `first flush happens at the 20ms cap, got ${firstDelivery.length} chunks`);
}

function testCancelDropsPending() {
  const { rig, deliveries, coalescer } = createHarness();
  coalescer.push('a');
  rig.advance(2);
  coalescer.cancel();
  rig.advance(50);
  assert.strictEqual(deliveries.length, 0);
  assert.strictEqual(coalescer.size, 0);
}

function testFlushWithoutQueueIsNoop() {
  const { deliveries, coalescer } = createHarness();
  coalescer.flush();
  assert.strictEqual(deliveries.length, 0);
}

function testMaxHoldCheckedOnPush() {
  // Safety net for event-loop stalls: if now() jumps past maxHold without any
  // timer having fired (timers are not pumped in this rig), the next push
  // flushes synchronously instead of holding even longer.
  let t = 0;
  const timers = [];
  const deliveries = [];
  const coalescer = createOutputCoalescer({
    deliver: (items) => deliveries.push(items),
    quietMs: 8,
    maxHoldMs: 10,
    now: () => t,
    setTimeoutImpl: (fn, ms) => {
      const timer = { fn, due: t + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; }
  });
  coalescer.push('a');
  t = 15; // clock jumped while the event loop was busy; quiet timer never fired
  coalescer.push('b');
  assert.strictEqual(deliveries.length, 1);
  assert.deepStrictEqual(deliveries[0], ['a', 'b']);
  assert.ok(timers.every(timer => timer.cleared), 'stale timer cleared after the synchronous flush');
}

function run() {
  testBurstCoalescesIntoOneDelivery();
  testQuietGapSplitsDeliveries();
  testMaxHoldForcesFlushDuringFlood();
  testCancelDropsPending();
  testFlushWithoutQueueIsNoop();
  testMaxHoldCheckedOnPush();
  console.log('outputCoalescer tests passed');
}

run();
