// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { RateLimitError, RateLimiter } from './rate-limiter';

describe('RateLimiter — reject mode', () => {
  it('allows executions within the limit', async () => {
    const limiter = new RateLimiter({ maxExecutions: 3, windowMs: 1000, overflow: 'reject' });

    const r1 = await limiter.tryExecute(async () => 'a');
    const r2 = await limiter.tryExecute(async () => 'b');
    const r3 = await limiter.tryExecute(async () => 'c');

    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(r3).toBe('c');
  });

  it('throws RateLimitError when window is full', async () => {
    const limiter = new RateLimiter({ maxExecutions: 2, windowMs: 1000, overflow: 'reject' });

    await limiter.tryExecute(async () => 'a');
    await limiter.tryExecute(async () => 'b');

    await expect(limiter.tryExecute(async () => 'c')).rejects.toThrow(RateLimitError);
  });

  it('RateLimitError includes retryAfterMs, currentCount, maxExecutions', async () => {
    const limiter = new RateLimiter({ maxExecutions: 2, windowMs: 5000, overflow: 'reject' });

    await limiter.tryExecute(async () => 'a');
    await limiter.tryExecute(async () => 'b');

    try {
      await limiter.tryExecute(async () => 'c');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const re = err as RateLimitError;
      expect(re.retryAfterMs).toBeGreaterThan(0);
      expect(re.retryAfterMs).toBeLessThanOrEqual(5000);
      expect(re.currentCount).toBe(2);
      expect(re.maxExecutions).toBe(2);
    }
  });

  it('executionCount reflects current window usage', async () => {
    const limiter = new RateLimiter({ maxExecutions: 5, windowMs: 1000, overflow: 'reject' });

    expect(limiter.executionCount).toBe(0);

    await limiter.tryExecute(async () => 'a');
    expect(limiter.executionCount).toBe(1);

    await limiter.tryExecute(async () => 'b');
    await limiter.tryExecute(async () => 'c');
    expect(limiter.executionCount).toBe(3);
  });

  it('sliding window frees capacity after expiration', async () => {
    const limiter = new RateLimiter({ maxExecutions: 2, windowMs: 50, overflow: 'reject' });

    await limiter.tryExecute(async () => 'a');
    await limiter.tryExecute(async () => 'b');

    // Window is full
    expect(limiter.executionCount).toBe(2);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should have capacity now
    expect(limiter.executionCount).toBe(0);
    await limiter.tryExecute(async () => 'c');
    expect(limiter.executionCount).toBe(1);
  });

  it('timeUntilReset() returns correct remaining time', async () => {
    const limiter = new RateLimiter({ maxExecutions: 5, windowMs: 1000, overflow: 'reject' });

    await limiter.tryExecute(async () => 'a');
    const reset = limiter.timeUntilReset();

    expect(reset).toBeGreaterThan(0);
    expect(reset).toBeLessThanOrEqual(1000);
  });

  it('timeUntilReset() returns 0 when window is empty', () => {
    const limiter = new RateLimiter({ maxExecutions: 5, windowMs: 1000, overflow: 'reject' });
    expect(limiter.timeUntilReset()).toBe(0);
  });

  it('reset() clears all state', async () => {
    const limiter = new RateLimiter({ maxExecutions: 1, windowMs: 1000, overflow: 'reject' });

    await limiter.tryExecute(async () => 'a');
    expect(limiter.executionCount).toBe(1);

    limiter.reset();
    expect(limiter.executionCount).toBe(0);

    // Can execute again
    await limiter.tryExecute(async () => 'b');
  });
});

describe('RateLimiter — queue mode', () => {
  it('queues executions when window is full and runs them later', async () => {
    const limiter = new RateLimiter({ maxExecutions: 1, windowMs: 100, overflow: 'queue' });

    const r1 = await limiter.tryExecute(async () => 'first');
    expect(r1).toBe('first');

    // Second call should be queued
    const p2 = limiter.tryExecute(async () => 'second');

    // Wait long enough for the window to expire
    const r2 = await p2;
    expect(r2).toBe('second');
  });

  it('executes queued entries in order after window resets', async () => {
    const limiter = new RateLimiter({ maxExecutions: 1, windowMs: 80, overflow: 'queue' });

    // Fill the window
    await limiter.tryExecute(async () => 'first');

    // Queue two more
    const p2 = limiter.tryExecute(async () => 'second');
    const p3 = limiter.tryExecute(async () => 'third');

    const results = await Promise.all([p2, p3]);
    // Both should eventually resolve
    expect(results).toContain('second');
    expect(results).toContain('third');
  });

  it('rejects queued entries on reset()', async () => {
    const limiter = new RateLimiter({ maxExecutions: 1, windowMs: 5000, overflow: 'queue' });

    await limiter.tryExecute(async () => 'first');
    const p2 = limiter.tryExecute(async () => 'second');

    limiter.reset();

    await expect(p2).rejects.toThrow('RateLimiter reset');
  });
});

describe('RateLimiter — validation', () => {
  it('throws on invalid maxExecutions', () => {
    expect(() => new RateLimiter({ maxExecutions: 0, windowMs: 1000, overflow: 'reject' })).toThrow(
      'maxExecutions must be > 0',
    );
  });

  it('throws on invalid windowMs', () => {
    expect(() => new RateLimiter({ maxExecutions: 1, windowMs: 0, overflow: 'reject' })).toThrow(
      'windowMs must be > 0',
    );
  });
});
