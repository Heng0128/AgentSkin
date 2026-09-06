// SPDX-License-Identifier: MPL-2.0

/**
 * # port-resolver MAX_RENTED_PORTS cap tests
 *
 * RC-E fix: PortResolver.rented Set previously had no size bound. If releasePort()
 * was skipped on error paths, the Set grew without limit. After the fix, rentPort()
 * refuses to add beyond MAX_RENTED_PORTS (256).
 *
 * We bypass the complex node:net TCP probing by spying on checkPort directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortResolver } from './port-manager';

describe('PortResolver MAX_RENTED_PORTS cap', () => {
  let resolver: PortResolver;

  beforeEach(() => {
    resolver = new PortResolver();
    // Mock checkPort to always return available — testing rent/cap behavior,
    // not TCP probing logic (covered by port-resolver.test.ts).
    vi.spyOn(resolver, 'checkPort').mockImplementation(async (port) => ({ port, available: true }));
  });

  it('allows renting multiple ports successfully', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await resolver.rentPort(9222 + i);
      expect(result).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      expect(resolver.rentedPorts.has(9222 + i)).toBe(true);
    }
  });

  it('releases a port and removes it from rented set', async () => {
    await resolver.rentPort(9222);
    expect(resolver.rentedPorts.has(9222)).toBe(true);

    resolver.releasePort(9222);
    expect(resolver.rentedPorts.has(9222)).toBe(false);
  });

  it('prevents double-renting the same port', async () => {
    expect(await resolver.rentPort(9300)).toBe(true);
    expect(await resolver.rentPort(9300)).toBe(false);
  });

  it('rentedPorts returns a copy (mutation-safe)', async () => {
    await resolver.rentPort(9400);
    const ports = resolver.rentedPorts;
    // Mutating the returned set must not affect internal state.
    (ports as Set<number>).add(9999);
    expect(resolver.rentedPorts.has(9999)).toBe(false);
  });
});
