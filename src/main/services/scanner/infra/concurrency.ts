// SPDX-License-Identifier: MPL-2.0

/**
 * Global concurrency cap for PowerShell subprocess spawns. L1/L2 can fan out
 * dozens of `readExeInfo` / registry calls in parallel; without a cap that
 * means dozens of `powershell.exe` processes at once (memory + startup
 * contention, and on some systems the process table churns). A bounded FIFO
 * pool keeps the scan fast while bounding resource usage.
 */
const PS_CONCURRENCY_LIMIT = 8;

let psActive = 0;
const psQueue: Array<() => void> = [];

/** Run `fn` under the global PowerShell concurrency pool (FIFO, cap 8). */
export async function withPsConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (psActive >= PS_CONCURRENCY_LIMIT) {
    await new Promise<void>((resolve) => psQueue.push(resolve));
  }
  psActive++;
  try {
    return await fn();
  } finally {
    psActive--;
    const next = psQueue.shift();
    if (next) next();
  }
}

/**
 * Concurrency cap for the L3 filesystem walk (v2 path). The serial walk visits
 * one root at a time; the parallel walk fans out across install roots but is
 * bounded here so a large drive tree does not trigger unbounded `readdir`/`stat`
 * I/O contention.
 */
export const DIR_CONCURRENCY_LIMIT = 8;

/**
 * Map `items` through `fn` with a bounded worker pool, preserving input order
 * in the returned array. Each `fn` call may short-circuit (e.g. on timeout) —
 * a worker simply moves on to the next item. Reusable for any bounded fan-out,
 * independent of the PowerShell pool above.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (next >= items.length) return;
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
