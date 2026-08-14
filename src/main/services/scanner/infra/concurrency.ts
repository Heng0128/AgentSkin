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
