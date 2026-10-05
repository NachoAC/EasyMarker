import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runPool } from '../../extension/js/pool.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('runPool', () => {
  it('runs every task once', async () => {
    const seen = [];
    await runPool([1, 2, 3, 4, 5], async (n) => {
      await tick();
      seen.push(n);
    });
    assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
  });

  it('resolves immediately for no items', async () => {
    await runPool([], async () => assert.fail('should not run'));
  });

  it('respects the global and per-group limits', async () => {
    const items = [];
    for (let i = 0; i < 30; i += 1) items.push({ id: i, host: `h${i % 3}` });

    let running = 0;
    let maxRunning = 0;
    const perHost = new Map();
    let maxPerHost = 0;

    await runPool(
      items,
      async ({ host }) => {
        running += 1;
        perHost.set(host, (perHost.get(host) ?? 0) + 1);
        maxRunning = Math.max(maxRunning, running);
        maxPerHost = Math.max(maxPerHost, perHost.get(host));
        await tick();
        running -= 1;
        perHost.set(host, perHost.get(host) - 1);
      },
      { concurrency: 5, perGroup: 2, groupOf: (item) => item.host },
    );

    assert.equal(maxRunning, 5);
    assert.equal(maxPerHost, 2);
  });

  it('still makes progress when a single group dominates', async () => {
    let done = 0;
    await runPool(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        await tick();
        done += 1;
      },
      { concurrency: 8, perGroup: 1, groupOf: () => 'same-host' },
    );
    assert.equal(done, 10);
  });

  it('stops scheduling when aborted and resolves once running tasks settle', async () => {
    const controller = new AbortController();
    let started = 0;
    await runPool(
      Array.from({ length: 50 }, (_, i) => i),
      async () => {
        started += 1;
        if (started === 3) controller.abort();
        await tick();
        if (controller.signal.aborted) throw controller.signal.reason;
      },
      { concurrency: 3, signal: controller.signal },
    );
    assert.equal(started, 3);
  });

  it('rejects with the first task error and starts nothing new', async () => {
    let started = 0;
    await assert.rejects(
      runPool(
        Array.from({ length: 20 }, (_, i) => i),
        async (n) => {
          started += 1;
          await tick();
          if (n === 0) throw new Error('boom');
        },
        { concurrency: 2 },
      ),
      /boom/,
    );
    assert.ok(started < 20);
  });

  it('rejects invalid limits', async () => {
    await assert.rejects(runPool([1], async () => {}, { concurrency: 0 }), RangeError);
  });
});
