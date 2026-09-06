// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
    expect(breaker.state).toBe('CLOSED');
  });

  it('executes function successfully in CLOSED state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('transitions to OPEN after failureThreshold consecutive failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
    }

    expect(breaker.state).toBe('OPEN');
  });

  it('does not trip before reaching failureThreshold', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 1000,
    });

    for (let i = 0; i < 4; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
    }

    expect(breaker.state).toBe('CLOSED');
  });

  it('rejects execution when OPEN with CircuitOpenError', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 10000,
    });

    // Trip the breaker
    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(breaker.state).toBe('OPEN');

    // Next call should be rejected
    await expect(breaker.execute(async () => 'should-not-run')).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after resetTimeoutMs', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 30,
    });

    // Trip the breaker
    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(breaker.state).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 40));

    // State should now be HALF_OPEN
    expect(breaker.state).toBe('HALF_OPEN');
  });

  it('returns to CLOSED after success in HALF_OPEN state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 30,
      successThreshold: 1,
    });

    // Trip
    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    await new Promise((r) => setTimeout(r, 40));

    // Should be HALF_OPEN now
    expect(breaker.state).toBe('HALF_OPEN');

    // Successful execution
    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.state).toBe('CLOSED');
  });

  it('returns to OPEN on failure in HALF_OPEN state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 30,
    });

    // Trip
    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    await new Promise((r) => setTimeout(r, 40));

    // HALF_OPEN — fail again
    await expect(
      breaker.execute(async () => {
        throw new Error('fail-again');
      }),
    ).rejects.toThrow('fail-again');
    expect(breaker.state).toBe('OPEN');
  });

  it('requires successThreshold successes to close from HALF_OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 20,
      successThreshold: 3,
    });

    // Trip
    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    await new Promise((r) => setTimeout(r, 30));

    // First success — still HALF_OPEN
    await breaker.execute(async () => 'ok1');
    expect(breaker.state).toBe('HALF_OPEN');

    // Second success — still HALF_OPEN
    await breaker.execute(async () => 'ok2');
    expect(breaker.state).toBe('HALF_OPEN');

    // Third success — now CLOSED
    await breaker.execute(async () => 'ok3');
    expect(breaker.state).toBe('CLOSED');
  });

  it('reset() returns to CLOSED and clears counters', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 10000,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(breaker.state).toBe('OPEN');

    breaker.reset();
    expect(breaker.state).toBe('CLOSED');

    const stats = breaker.getStats();
    expect(stats.failures).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.rejectedCount).toBe(0);
  });

  it('getStats() returns accurate statistics', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 1000,
    });

    // Two failures
    await expect(
      breaker.execute(async () => {
        throw new Error('f1');
      }),
    ).rejects.toThrow('f1');
    await expect(
      breaker.execute(async () => {
        throw new Error('f2');
      }),
    ).rejects.toThrow('f2');

    // One success
    await breaker.execute(async () => 'ok');

    const stats = breaker.getStats();
    expect(stats.failures).toBe(0); // reset by success
    expect(stats.successes).toBe(1);
    expect(stats.lastFailureAt).not.toBeNull();
    expect(stats.lastSuccessAt).not.toBeNull();
    expect(stats.stateChangedAt).toBeGreaterThan(0);
  });

  it('tracks rejectedCount when OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 10000,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    // Multiple rejected calls
    await expect(breaker.execute(async () => 'nope')).rejects.toThrow(CircuitOpenError);
    await expect(breaker.execute(async () => 'nope')).rejects.toThrow(CircuitOpenError);
    await expect(breaker.execute(async () => 'nope')).rejects.toThrow(CircuitOpenError);

    const stats = breaker.getStats();
    expect(stats.rejectedCount).toBe(3);
  });

  it('resets failure count on success in CLOSED state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    // Two failures
    await expect(
      breaker.execute(async () => {
        throw new Error('f1');
      }),
    ).rejects.toThrow('f1');
    await expect(
      breaker.execute(async () => {
        throw new Error('f2');
      }),
    ).rejects.toThrow('f2');

    // One success resets the count
    await breaker.execute(async () => 'ok');

    // Two more failures should NOT trip (count was reset)
    await expect(
      breaker.execute(async () => {
        throw new Error('f3');
      }),
    ).rejects.toThrow('f3');
    await expect(
      breaker.execute(async () => {
        throw new Error('f4');
      }),
    ).rejects.toThrow('f4');

    expect(breaker.state).toBe('CLOSED');
  });

  it('throws on invalid failureThreshold', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 1000 })).toThrow(
      'failureThreshold must be > 0',
    );
    expect(() => new CircuitBreaker({ failureThreshold: -1, resetTimeoutMs: 1000 })).toThrow(
      'failureThreshold must be > 0',
    );
  });

  it('throws on invalid resetTimeoutMs', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 })).toThrow(
      'resetTimeoutMs must be > 0',
    );
  });

  it('CircuitOpenError includes state and retryAfterMs', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 5000,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    try {
      await breaker.execute(async () => 'should-not-run');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      const ce = err as CircuitOpenError;
      expect(ce.state).toBe('OPEN');
      expect(ce.retryAfterMs).toBeGreaterThan(0);
      expect(ce.retryAfterMs).toBeLessThanOrEqual(5000);
    }
  });
});
