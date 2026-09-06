// SPDX-License-Identifier: MPL-2.0

/**
 * Guardian — high-level protection combining debounce, circuit breaker, and rate limiter.
 *
 * This is the primary entry point for watcher-style operations that need:
 * 1. **Debounce**: Coalesce rapid events into a single trailing-edge execution.
 * 2. **Circuit Breaker**: Stop cascading failures after repeated errors.
 * 3. **Rate Limiter**: Enforce a maximum execution frequency.
 *
 * ## Execution Flow
 *
 * ```
 * protect(fn)
 *    │
 *    ▼
 * Debouncer.call ──(fires after debounceMs quiet)──▶
 *    │                                                 │
 *    ▼                                                 ▼
 * CircuitBreaker.execute ──(if CLOSED/HALF_OPEN)──▶
 *    │                                                 │
 *    ▼                                                 ▼
 * RateLimiter.tryExecute ──(if within limit)──▶ fn()
 * ```
 *
 * @example
 * const guardian = new Guardian({
 *   debounceMs: 300,
 *   circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
 *   rateLimiter: { maxExecutions: 3, windowMs: 1000, overflow: 'reject' },
 * });
 *
 * // Only one execution per 300ms quiet period, with circuit-breaking + rate-limiting
 * await guardian.protect(() => checkHealth(), 'health-check');
 */

import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker';
import { createDebounce } from './debounce';
import { RateLimiter, type RateLimiterOptions } from './rate-limiter';

/**
 * Configuration for {@link Guardian}.
 */
export interface GuardianOptions {
  /** Debounce delay in milliseconds. */
  debounceMs: number;
  /** Circuit breaker configuration. */
  circuitBreaker: CircuitBreakerOptions;
  /** Rate limiter configuration. */
  rateLimiter: RateLimiterOptions;
}

/**
 * Combined statistics from all three protection layers.
 */
export interface GuardianStats {
  /** Current circuit breaker state. */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  /** Current rate limiter execution count in window. */
  rateLimitCount: number;
  /** Milliseconds until rate limiter window resets. */
  rateLimitResetMs: number;
  /** Whether a debounced execution is pending. */
  debouncePending: boolean;
  /** Circuit breaker statistics. */
  circuitBreaker: {
    failures: number;
    successes: number;
    lastFailureAt: number | null;
    lastSuccessAt: number | null;
    stateChangedAt: number;
    rejectedCount: number;
  };
}

class Guardian {
  private readonly debouncer: ReturnType<typeof createDebounce<unknown>>;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly rateLimiter: RateLimiter;

  constructor(options: GuardianOptions) {
    this.debouncer = createDebounce<unknown>(options.debounceMs);
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    this.rateLimiter = new RateLimiter(options.rateLimiter);
  }

  /**
   * Execute `fn` under full protection:
   *
   * 1. Debounce — coalesce rapid calls into one trailing-edge execution.
   * 2. Circuit breaker — reject if the circuit is OPEN.
   * 3. Rate limiter — reject or queue if the window is full.
   * 4. Execute `fn` and propagate the result.
   *
   * @param fn       The protected function.
   * @param context  Optional context label for error messages.
   * @returns Promise resolving with `fn`'s result.
   */
  async protect<T>(fn: () => Promise<T>, _context?: string): Promise<T> {
    // Step 1: Debounce — wait for quiet period
    // The debouncer coalesces multiple calls; all resolve with the same result.
    // The inner function returns T, so the cast from unknown to T is safe.
    return this.debouncer.call(async () => {
      // Step 2: Circuit breaker — check if we should proceed
      // Step 3: Rate limiter — check if within execution budget
      // Step 4: Execute
      return this.circuitBreaker.execute(async () => {
        return this.rateLimiter.tryExecute(fn);
      });
    }) as Promise<T>;
  }

  /**
   * Get combined statistics from all protection layers.
   */
  getStats(): GuardianStats {
    const cbStats = this.circuitBreaker.getStats();
    return {
      circuitState: this.circuitBreaker.state,
      rateLimitCount: this.rateLimiter.executionCount,
      rateLimitResetMs: this.rateLimiter.timeUntilReset(),
      debouncePending: this.debouncer.isPending(),
      circuitBreaker: {
        failures: cbStats.failures,
        successes: cbStats.successes,
        lastFailureAt: cbStats.lastFailureAt,
        lastSuccessAt: cbStats.lastSuccessAt,
        stateChangedAt: cbStats.stateChangedAt,
        rejectedCount: cbStats.rejectedCount,
      },
    };
  }

  /**
   * Reset all protection layers to their initial state.
   */
  reset(): void {
    this.debouncer.cancel();
    this.circuitBreaker.reset();
    this.rateLimiter.reset();
  }
}

export { Guardian };
