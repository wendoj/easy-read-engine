/**
 * A small in-process semaphore for PDF exports (design "Deployment": Chromium
 * uses a few hundred MB per export, so run up to 2 at once and queue the rest).
 *
 * - `run(task)` starts the task at once when fewer than `maxConcurrent` run;
 *   otherwise it waits in a first-in, first-out queue.
 * - The queue holds at most `maxQueued` waiting tasks. One more is rejected at
 *   once with `QueueFullError` (the route returns 503).
 * - A task that waits longer than `waitTimeoutMs` is removed and rejected with
 *   `QueueTimeoutError` (also 503). It never starts.
 *
 * A finished task hands its slot straight to the next waiting one, so the
 * number running never goes above `maxConcurrent`.
 */
export class QueueFullError extends Error {
  constructor() {
    super("export queue is full");
    this.name = "QueueFullError";
  }
}

export class QueueTimeoutError extends Error {
  constructor() {
    super("export waited too long in the queue");
    this.name = "QueueTimeoutError";
  }
}

export interface ExportQueueOptions {
  maxConcurrent?: number;
  maxQueued?: number;
  waitTimeoutMs?: number;
}

export interface ExportQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  stats(): { active: number; queued: number };
}

export const EXPORT_MAX_CONCURRENT = 2;
export const EXPORT_MAX_QUEUED = 8;
/** About 4 rounds of 2 exports at a few seconds each, with room to spare. */
export const EXPORT_WAIT_TIMEOUT_MS = 60_000;

interface Waiter {
  start: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createExportQueue(options: ExportQueueOptions = {}): ExportQueue {
  const maxConcurrent = options.maxConcurrent ?? EXPORT_MAX_CONCURRENT;
  const maxQueued = options.maxQueued ?? EXPORT_MAX_QUEUED;
  const waitTimeoutMs = options.waitTimeoutMs ?? EXPORT_WAIT_TIMEOUT_MS;
  if (!(maxConcurrent >= 1) || !(maxQueued >= 0) || !(waitTimeoutMs > 0)) {
    throw new Error("export queue needs maxConcurrent >= 1, maxQueued >= 0 and waitTimeoutMs > 0");
  }

  let active = 0;
  const waiting: Waiter[] = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueued) return Promise.reject(new QueueFullError());
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: resolve,
        timer: setTimeout(() => {
          const at = waiting.indexOf(waiter);
          if (at >= 0) waiting.splice(at, 1);
          reject(new QueueTimeoutError());
        }, waitTimeoutMs),
      };
      waiting.push(waiter);
    });
  }

  function release(): void {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
      return;
    }
    // The slot passes to the next task, so `active` stays the same.
    clearTimeout(next.timer);
    next.start();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    stats: () => ({ active, queued: waiting.length }),
  };
}
