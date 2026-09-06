// SPDX-License-Identifier: MPL-2.0

/**
 * Sliding-window rate limiter for preventing excessive execution frequency.
 *
 * Two overflow strategies:
 * - **reject**: Throws {@link RateLimitError} immediately when the window is full.
 * - **queue**: Enqueues the request and executes it when the next window opens.
 *
 * @example
 * // Reject mode — fail fast
 * const limiter = new RateLimiter({ maxExecutions: 5, windowMs: 1000, overflow: 'reject' });
 * await limiter.tryExecute(() => doWork()); // ok
 *
 * @example
 * // Queue mode — wait for next window
 * const limiter = new RateLimiter({ maxExecutions: 5, windowMs: 1000, overflow: 'queue' });
 * await limiter.tryExecute(() => doWork()); // waits if window full
 */

/**
 * Configuration options for {@link RateLimiter}.
 */
export interface RateLimiterOptions {
  /**
   * Maximum number of executions allowed within the time window.
   * @default 10
   */
  maxExecutions: number;

  /**
   * Time window duration in milliseconds.
   * @default 1000
   */
  windowMs: number;

  /**
   * Behavior when the current window is full:
   * - `'reject'`: Throw {@link RateLimitError} immediately.
   * - `'queue'`: Wait until the next window opens.
   * @default 'reject'
   */
  overflow: 'reject' | 'queue';
}

/**
 * Error thrown by {@link RateLimiter} in `'reject'` mode when the window is full.
 */
export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly currentCount: number,
    public readonly maxExecutions: number,
  ) {
    super(
      `Rate limit exceeded: ${currentCount}/${maxExecutions} in window; retry after ${retryAfterMs}ms`,
    );
    this.name = 'RateLimitError';
  }
}

interface QueueEntry<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

class RateLimiter {
  private readonly maxExecutions: number;
  private readonly windowMs: number;
  private readonly overflow: 'reject' | 'queue';

  /** Timestamps of executions in the current window. */
  private timestamps: number[] = [];
  /** Queue for 'queue' mode. */
  private queue: QueueEntry<unknown>[] = [];
  /** Whether the queue processor is currently running. */
  private processing = false;

  constructor(options: RateLimiterOptions) {
    if (options.maxExecutions <= 0) {
      throw new Error('maxExecutions must be > 0');
    }
    if (options.windowMs <= 0) {
      throw new Error('windowMs must be > 0');
    }
    this.maxExecutions = options.maxExecutions;
    this.windowMs = options.windowMs;
    this.overflow = options.overflow;
  }

  /**
   * Number of executions in the current sliding window.
   */
  get executionCount(): number {
    this._prune();
    return this.timestamps.length;
  }

  /**
   * Attempt to execute `fn` under rate limiting rules.
   *
   * - If the window has capacity, executes immediately.
   * - If the window is full and `overflow` is `'reject'`, throws {@link RateLimitError}.
   * - If the window is full and `overflow` is `'queue'`, waits for the next window.
   */
  async tryExecute<T>(fn: () => Promise<T>): Promise<T> {
    this._prune();

    if (this.timestamps.length < this.maxExecutions) {
      // Capacity available — execute immediately
      this.timestamps.push(Date.now());
      return fn();
    }

    // Window is full
    if (this.overflow === 'reject') {
      const retryAfter = this.timeUntilReset();
      throw new RateLimitError(retryAfter, this.timestamps.length, this.maxExecutions);
    }

    // Queue mode — wait for next window
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this._processQueue();
    });
  }

  /**
   * Milliseconds until the oldest execution expires from the window.
   */
  timeUntilReset(): number {
    this._prune();
    if (this.timestamps.length === 0) return 0;
    const oldest = this.timestamps[0];
    const elapsed = Date.now() - oldest;
    return Math.max(0, this.windowMs - elapsed);
  }

  /**
   * Reset all state — clear timestamps and reject queued entries.
   */
  reset(): void {
    this.timestamps.length = 0;
    const err = new Error('RateLimiter reset');
    for (const entry of this.queue) {
      entry.reject(err);
    }
    this.queue.length = 0;
    this.processing = false;
  }

  /**
   * Remove timestamps that have fallen outside the window.
   */
  private _prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * Process queued entries when window capacity becomes available.
   */
  private async _processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this._prune();

      if (this.timestamps.length >= this.maxExecutions) {
        // Wait until the oldest entry expires
        const waitMs = this.timeUntilReset();
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs + 1));
        }
        this._prune();
      }

      // Process as many queued entries as capacity allows
      while (this.queue.length > 0 && this.timestamps.length < this.maxExecutions) {
        const entry = this.queue.shift()!;
        this.timestamps.push(Date.now());
        try {
          const result = await entry.fn();
          entry.resolve(result);
        } catch (error) {
          entry.reject(error);
        }
      }
    }

    this.processing = false;
  }
}

export { RateLimiter };
