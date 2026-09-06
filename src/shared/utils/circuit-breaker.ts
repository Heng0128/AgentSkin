// SPDX-License-Identifier: MPL-2.0

/**
 * Circuit breaker pattern for preventing "kill-loop" in watcher scenarios.
 *
 * When a monitored operation fails repeatedly, the circuit opens to stop
 * cascading failures. After a reset timeout, it enters half-open state to
 * test whether the underlying issue has resolved.
 *
 * ## State Machine
 *
 * ```
 * CLOSED ──(failures >= threshold)──▶ OPEN
 *   ▲                                  │
 *   │                           (resetTimeoutMs elapsed)
 *   │                                  │
 *   │                                  ▼
 *   └────(successes >= successThreshold)── HALF_OPEN
 *                                      │
 *                                (any failure)
 *                                      │
 *                                      ▼
 *                                     OPEN
 * ```
 *
 * @example
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30_000,
 *   successThreshold: 2,
 * });
 *
 * const result = await breaker.execute(() => riskyOperation());
 */

/**
 * Circuit breaker states.
 * - **CLOSED**: Normal operation; failures are counted.
 * - **OPEN**: Circuit is tripped; all executions rejected immediately.
 * - **HALF_OPEN**: Reset timeout elapsed; one trial allowed.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Configuration options for {@link CircuitBreaker}.
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before the circuit trips to OPEN.
   * @default 5
   */
  failureThreshold: number;

  /**
   * Duration (ms) the circuit stays OPEN before transitioning to HALF_OPEN.
   * @default 30000
   */
  resetTimeoutMs: number;

  /**
   * Number of consecutive successes in HALF_OPEN state required to
   * return to CLOSED. In HALF_OPEN, the first success increments the counter,
   * and if it reaches this threshold, the circuit closes.
   * @default 1
   */
  successThreshold?: number;
}

/**
 * Error thrown when the circuit is OPEN and rejects execution.
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly state: CircuitState,
    public readonly retryAfterMs: number,
  ) {
    super(`Circuit breaker is ${state}; retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Statistics for observability and diagnostics.
 */
export interface CircuitBreakerStats {
  /** Total consecutive failures in current window. */
  failures: number;
  /** Total consecutive successes in current window. */
  successes: number;
  /** Timestamp (Date.now()) of the last failure, or null if none. */
  lastFailureAt: number | null;
  /** Timestamp (Date.now()) of the last success, or null if none. */
  lastSuccessAt: number | null;
  /** Timestamp (Date.now()) when state last changed. */
  stateChangedAt: number;
  /** Total number of rejected executions while OPEN. */
  rejectedCount: number;
}

class CircuitBreaker {
  private _state: CircuitState = 'CLOSED';
  private _failures = 0;
  private _successes = 0;
  private _lastFailureAt: number | null = null;
  private _lastSuccessAt: number | null = null;
  private _stateChangedAt: number = Date.now();
  private _rejectedCount = 0;
  private _openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;

  constructor(options: CircuitBreakerOptions) {
    if (options.failureThreshold <= 0) {
      throw new Error('failureThreshold must be > 0');
    }
    if (options.resetTimeoutMs <= 0) {
      throw new Error('resetTimeoutMs must be > 0');
    }
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
    this.successThreshold = options.successThreshold ?? 1;
    if (this.successThreshold <= 0) {
      throw new Error('successThreshold must be > 0');
    }
  }

  /**
   * Current state of the circuit.
   */
  get state(): CircuitState {
    // Auto-transition from OPEN to HALF_OPEN if resetTimeoutMs elapsed
    if (this._state === 'OPEN' && this._openedAt !== null) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this._transitionTo('HALF_OPEN');
      }
    }
    return this._state;
  }

  /**
   * Execute `fn` if the circuit allows it.
   *
   * - In CLOSED: executes and tracks result.
   * - In OPEN: rejects with {@link CircuitOpenError} (unless resetTimeout elapsed).
   * - In HALF_OPEN: executes; success moves toward CLOSED, failure returns to OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers auto-transition

    if (currentState === 'OPEN') {
      this._rejectedCount++;
      const retryAfter = this._openedAt
        ? Math.max(0, this.resetTimeoutMs - (Date.now() - this._openedAt))
        : this.resetTimeoutMs;
      throw new CircuitOpenError(currentState, retryAfter);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  /**
   * Manually reset the circuit to CLOSED with zero counters.
   */
  reset(): void {
    this._failures = 0;
    this._successes = 0;
    this._lastFailureAt = null;
    this._lastSuccessAt = null;
    this._openedAt = null;
    this._rejectedCount = 0;
    this._transitionTo('CLOSED');
  }

  /**
   * Get a snapshot of current statistics.
   */
  getStats(): CircuitBreakerStats {
    return {
      failures: this._failures,
      successes: this._successes,
      lastFailureAt: this._lastFailureAt,
      lastSuccessAt: this._lastSuccessAt,
      stateChangedAt: this._stateChangedAt,
      rejectedCount: this._rejectedCount,
    };
  }

  private _onSuccess(): void {
    const now = Date.now();
    this._lastSuccessAt = now;

    if (this._state === 'HALF_OPEN') {
      this._successes++;
      if (this._successes >= this.successThreshold) {
        this._transitionTo('CLOSED');
        this._failures = 0;
        this._successes = 0;
      }
    } else {
      // CLOSED state — reset failure count on success
      this._failures = 0;
      this._successes++;
    }
  }

  private _onFailure(): void {
    const now = Date.now();
    this._lastFailureAt = now;

    if (this._state === 'HALF_OPEN') {
      // Any failure in half-open goes back to OPEN
      this._transitionTo('OPEN');
      this._openedAt = now;
      this._failures++;
      this._successes = 0;
    } else {
      // CLOSED state
      this._failures++;
      this._successes = 0;
      if (this._failures >= this.failureThreshold) {
        this._transitionTo('OPEN');
        this._openedAt = now;
      }
    }
  }

  private _transitionTo(newState: CircuitState): void {
    if (this._state === newState) return;
    this._state = newState;
    this._stateChangedAt = Date.now();
  }
}

export { CircuitBreaker };
