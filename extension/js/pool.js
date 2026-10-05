// Small task pool with a global concurrency cap and a per-group cap.
// Used to check links in parallel without hammering any single host.
// Pure module: unit-tested in Node.

/**
 * Runs `task(item)` for every item.
 *
 * - At most `concurrency` tasks run at once, and at most `perGroup` per `groupOf(item)`.
 * - When `signal` aborts, no new task starts; the promise resolves once running tasks
 *   settle (their own errors are ignored, since they are expected to abort too).
 * - When a task fails, no new task starts and the promise rejects with that error once
 *   running tasks settle.
 *
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => Promise<void>} task
 * @param {{ concurrency?: number, perGroup?: number, groupOf?: (item: T) => string, signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
export function runPool(items, task, { concurrency = 8, perGroup = 2, groupOf = () => '', signal } = {}) {
  if (!(concurrency >= 1 && perGroup >= 1)) {
    return Promise.reject(new RangeError('concurrency and perGroup must be at least 1'));
  }

  /** @type {Map<string, T[]>} */
  const queues = new Map();
  for (const item of items) {
    const group = groupOf(item);
    const queue = queues.get(group);
    if (queue) queue.push(item);
    else queues.set(group, [item]);
  }

  /** @type {Map<string, number>} */
  const activePerGroup = new Map();
  let running = 0;
  /** @type {{ error: unknown } | null} */
  let failure = null;

  return new Promise((resolve, reject) => {
    const stopped = () => failure !== null || Boolean(signal?.aborted);

    const launch = (group, item) => {
      running += 1;
      activePerGroup.set(group, (activePerGroup.get(group) ?? 0) + 1);
      Promise.resolve()
        .then(() => task(item))
        .catch((error) => {
          if (!signal?.aborted && failure === null) failure = { error };
        })
        .finally(() => {
          running -= 1;
          activePerGroup.set(group, activePerGroup.get(group) - 1);
          pump();
        });
    };

    const pump = () => {
      let launched = true;
      while (launched && !stopped() && running < concurrency) {
        launched = false;
        for (const [group, queue] of queues) {
          if (running >= concurrency) break;
          if ((activePerGroup.get(group) ?? 0) >= perGroup) continue;
          const item = queue.shift();
          if (queue.length === 0) queues.delete(group);
          launch(group, item);
          launched = true;
        }
      }

      if (running > 0) return;
      if (failure) reject(failure.error);
      else if (stopped() || queues.size === 0) resolve();
    };

    pump();
  });
}
