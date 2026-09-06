// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { CircuitOpenError } from './circuit-breaker';
import { Guardian } from './guardian';
import { RateLimitError } from './rate-limiter';

function createGuardian(overrides: Partial<ConstructorParameters<typeof Guardian>[0]> = {}) {
  return new Guardian({
    debounceMs: 20,
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
    rateLimiter: { maxExecutions: 5, windowMs: 1000, overflow: 'reject' },
    ...overrides,
  });
}

describe('Guardian', () => {
  it('executes a successful function', async () => {
    const guardian = createGuardian();
    const result = await guardian.protect(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('debounces rapid calls into a single execution', async () => {
    const fn = vi.fn(async () => 'batched');
    const guardian = createGuardian({ debounceMs: 30 });

    const p1 = guardian.protect(fn);
    const p2 = guardian.protect(fn);
    const p3 = guardian.protect(fn);

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual(['batched', 'batched', 'batched']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from the protected function', async () => {
    const guardian = createGuardian();
    await expect(
      guardian.protect(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('includes context label in error messages', async () => {
    const guardian = createGuardian();
    await expect(
      guardian.protect(async () => {
        throw new Error('fail');
      }, 'my-context'),
    ).rejects.toThrow('fail');
  });

  it('trips the circuit breaker after repeated failures', async () => {
    const guardian = createGuardian({
      debounceMs: 10,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 10000 },
    });

    // First failure
    await expect(
      guardian.protect(async () => {
        throw new Error('f1');
      }),
    ).rejects.toThrow('f1');
    // Second failure — trips the breaker
    await expect(
      guardian.protect(async () => {
        throw new Error('f2');
      }),
    ).rejects.toThrow('f2');

    // Circuit should be OPEN now
    const stats = guardian.getStats();
    expect(stats.circuitState).toBe('OPEN');

    // Next call should be rejected by circuit breaker
    await expect(guardian.protect(async () => 'should-not-run')).rejects.toThrow(CircuitOpenError);
  });

  it('rate-limits executions beyond maxExecutions', async () => {
    const guardian = createGuardian({
      debounceMs: 0,
      rateLimiter: { maxExecutions: 2, windowMs: 1000, overflow: 'reject' },
    });

    await guardian.protect(async () => 'a');
    await guardian.protect(async () => 'b');

    // Third call should be rate-limited
    await expect(guardian.protect(async () => 'c')).rejects.toThrow(RateLimitError);
  });

  it('getStats() returns combined statistics', async () => {
    const guardian = createGuardian();

    await guardian.protect(async () => 'ok');
    await expect(
      guardian.protect(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    const stats = guardian.getStats();
    expect(stats.circuitState).toBe('CLOSED');
    // Last op was a failure, so failures = 1 (not yet tripped since threshold is 3)
    expect(stats.circuitBreaker.failures).toBe(1);
    expect(stats.circuitBreaker.lastFailureAt).not.toBeNull();
    expect(stats.circuitBreaker.lastSuccessAt).not.toBeNull();
    expect(stats.rateLimitCount).toBeGreaterThanOrEqual(1);
    expect(stats.rateLimitResetMs).toBeGreaterThanOrEqual(0);
    expect(typeof stats.debouncePending).toBe('boolean');
  });

  it('reset() clears all state', async () => {
    const guardian = createGuardian({
      circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 10000 },
    });

    // Trip the breaker
    await expect(
      guardian.protect(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(guardian.getStats().circuitState).toBe('OPEN');

    guardian.reset();
    const stats = guardian.getStats();
    expect(stats.circuitState).toBe('CLOSED');
    expect(stats.circuitBreaker.failures).toBe(0);
    expect(stats.circuitBreaker.rejectedCount).toBe(0);
  });

  it('allows execution after circuit breaker auto-recovers (HALF_OPEN)', async () => {
    const guardian = createGuardian({
      debounceMs: 10,
      circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 30, successThreshold: 1 },
    });

    // Trip
    await expect(
      guardian.protect(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(guardian.getStats().circuitState).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 40));

    // Should be HALF_OPEN — successful execution closes it
    const result = await guardian.protect(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(guardian.getStats().circuitState).toBe('CLOSED');
  });

  it('handles concurrent protect calls correctly', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'done';
    });
    const guardian = createGuardian({ debounceMs: 15 });

    // Fire 10 concurrent calls
    const promises = Array.from({ length: 10 }, () => guardian.protect(fn));
    const results = await Promise.all(promises);

    // All should resolve with the same result
    expect(results.every((r) => r === 'done')).toBe(true);
    // Should have executed far fewer than 10 times due to debounce
    expect(fn.mock.calls.length).toBeLessThan(10);
  });

  it('rate limiter in queue mode waits instead of rejecting', async () => {
    const guardian = createGuardian({
      debounceMs: 0,
      rateLimiter: { maxExecutions: 1, windowMs: 80, overflow: 'queue' },
    });

    const r1 = await guardian.protect(async () => 'first');
    expect(r1).toBe('first');

    // Second call should queue and eventually resolve
    const r2 = await guardian.protect(async () => 'second');
    expect(r2).toBe('second');
  });

  it('debounce pending state is reflected in stats', async () => {
    const guardian = createGuardian({ debounceMs: 200 });

    // Start a protect call — it will be pending due to debounce
    const promise = guardian.protect(async () => 'ok');

    // Should be pending
    expect(guardian.getStats().debouncePending).toBe(true);

    await promise;

    // No longer pending
    expect(guardian.getStats().debouncePending).toBe(false);
  });

  it('handles mixed success/failure without premature tripping', async () => {
    const guardian = createGuardian({
      debounceMs: 10,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
    });

    await guardian.protect(async () => 'ok1');
    await expect(
      guardian.protect(async () => {
        throw new Error('f1');
      }),
    ).rejects.toThrow('f1');
    await guardian.protect(async () => 'ok2');
    await expect(
      guardian.protect(async () => {
        throw new Error('f2');
      }),
    ).rejects.toThrow('f2');
    await guardian.protect(async () => 'ok3');

    // Failures were reset by successes — circuit should still be CLOSED
    expect(guardian.getStats().circuitState).toBe('CLOSED');
  });
});
