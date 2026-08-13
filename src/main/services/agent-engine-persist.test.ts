// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { isPersistedState, PersistChain, type PersistedState } from './agent-engine-persist';

// Regression coverage for the persistence state-contract guard (R6-24) and
// the FIFO serialisation chain used by AgentEngineService. Both are pure /
// dependency-free, so the tests are deterministic.

describe('isPersistedState', () => {
  const valid: PersistedState = {
    version: 2,
    apps: {
      traework: { activeThemeId: 'neon', port: 9222 },
    },
  };

  it('accepts a well-formed persisted state', () => {
    expect(isPersistedState(valid)).toBe(true);
  });

  it('accepts null entries (un-detected agents)', () => {
    expect(isPersistedState({ version: 2, apps: { workbuddy: null } })).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(isPersistedState(null)).toBe(false);
    expect(isPersistedState(undefined)).toBe(false);
    expect(isPersistedState(42)).toBe(false);
    expect(isPersistedState('{}')).toBe(false);
  });

  it('rejects wrong version', () => {
    expect(isPersistedState({ version: 1, apps: {} })).toBe(false);
    expect(isPersistedState({ apps: {} })).toBe(false);
  });

  it('rejects apps that is not a plain object', () => {
    expect(isPersistedState({ version: 2, apps: [] })).toBe(false);
    expect(isPersistedState({ version: 2, apps: null })).toBe(false);
  });

  // R6-24 — corrupted field-level types must not pass the guard.
  it('rejects unknown app ids', () => {
    expect(isPersistedState({ version: 2, apps: { notAnAgent: { activeThemeId: 'x' } } })).toBe(
      false,
    );
  });

  it('rejects corrupted port (string instead of number)', () => {
    expect(isPersistedState({ version: 2, apps: { traework: { port: '9222' } } })).toBe(false);
  });

  it('rejects corrupted activeThemeId (number instead of string)', () => {
    expect(isPersistedState({ version: 2, apps: { traework: { activeThemeId: 7 } } })).toBe(false);
  });

  it('rejects corrupted schemeSnapshot shape', () => {
    expect(
      isPersistedState({ version: 2, apps: { traework: { schemeSnapshot: { mode: 3 } } } }),
    ).toBe(false);
    expect(isPersistedState({ version: 2, apps: { traework: { schemeSnapshot: 'bad' } } })).toBe(
      false,
    );
  });
});

describe('PersistChain', () => {
  it('runs queued writes in FIFO order', async () => {
    const chain = new PersistChain();
    const order: number[] = [];
    await Promise.all([
      chain.safe(async () => {
        await Promise.resolve();
        order.push(1);
      }),
      chain.safe(async () => {
        await Promise.resolve();
        order.push(2);
      }),
      chain.safe(async () => {
        await Promise.resolve();
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('reports a non-negative depth and isolates a rejected write', async () => {
    const chain = new PersistChain();
    const spy = vi.fn();
    // A rejected write must not poison the chain for subsequent writes.
    // Attach a catch to the returned promise so the rejection is observed
    // (PersistChain swallows it internally, but `safe()` still returns the
    // rejected promise for callers that want to know).
    const rejected = chain
      .safe(() => Promise.reject(new Error('boom')))
      .catch((err) => {
        spy(err);
      });
    // Ensure the rejected promise is fully settled before asserting, so no
    // unhandled-rejection is reported outside this test.
    await rejected;
    expect(spy).toHaveBeenCalledOnce();
    let ran = false;
    await chain.safe(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(chain.depth).toBeGreaterThanOrEqual(0);
  });
});
