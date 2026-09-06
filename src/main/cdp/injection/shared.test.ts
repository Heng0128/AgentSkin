// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { backoffDelay } from './shared';

describe('backoffDelay', () => {
  it('returns a promise that resolves', async () => {
    const p = backoffDelay(0, 10, 1000);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toBeUndefined();
  });

  it('delay grows with attempt (exponential)', async () => {
    const start0 = Date.now();
    await backoffDelay(0, 100, 10000);
    const elapsed0 = Date.now() - start0;

    const start2 = Date.now();
    await backoffDelay(2, 100, 10000);
    const elapsed2 = Date.now() - start2;

    // attempt=2 delay should be larger than attempt=0 (100*4=400 > 100)
    expect(elapsed2).toBeGreaterThan(elapsed0);
  });

  it('caps at max', async () => {
    const start = Date.now();
    // attempt=10, base=1000 -> exp = 1000*2^10 far exceeds max=5000
    await backoffDelay(10, 1000, 5000);
    const elapsed = Date.now() - start;
    // with jitter should be <= 5000 + 30% = 6500
    expect(elapsed).toBeLessThan(7000);
  });
});
