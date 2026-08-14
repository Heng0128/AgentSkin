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

  it('depth increments during pending write', async () => {
    const chain = new PersistChain();
    expect(chain.depth).toBe(0);

    // Start a pending write that we control resolution of
    let resolveWrite: () => void;
    const writePromise = chain.safe(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    // While the write is in-flight, depth should be 1
    expect(chain.depth).toBe(1);

    // Complete the write
    resolveWrite!();
    await writePromise;
    await Promise.resolve(); // drain the chain's .finally microtask

    // After settle, depth returns to 0
    expect(chain.depth).toBe(0);
  });

  it('depth tracks multiple queued writes', async () => {
    const chain = new PersistChain();
    expect(chain.depth).toBe(0);

    const resolvers: (() => void)[] = [];

    // Queue 3 writes; each waits on an external resolver so they don't
    // auto-settle before we can observe intermediate depth values.
    const promises = [1, 2, 3].map(() =>
      chain.safe(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );

    // All 3 writes are queued synchronously: depth = 3
    expect(chain.depth).toBe(3);

    // Resolve first write — after it settles, .finally decrements and the
    // second write starts executing.
    resolvers[0]();
    await promises[0];
    await Promise.resolve(); // drain chain .finally
    await Promise.resolve(); // drain next .then on chain
    expect(chain.depth).toBe(2);

    // Resolve second write
    resolvers[1]();
    await promises[1];
    await Promise.resolve();
    await Promise.resolve();
    expect(chain.depth).toBe(1);

    // Resolve third write
    resolvers[2]();
    await promises[2];
    await Promise.resolve();
    await Promise.resolve();
    expect(chain.depth).toBe(0);
  });

  it('depth decrements on write failure and continues chain', async () => {
    const chain = new PersistChain();
    expect(chain.depth).toBe(0);

    // First write rejects — safe() returns the rejected promise, but the
    // chain itself swallows the error and decrements depth.
    const failingPromise = chain.safe(() => Promise.reject(new Error('boom')));
    await failingPromise.catch(() => {});
    await Promise.resolve(); // drain chain .finally
    await Promise.resolve(); // drain next microtask

    // depth should be back to 0 (failure handled, counter decremented)
    expect(chain.depth).toBe(0);

    // Subsequent writes still execute normally
    let successRan = false;
    await chain.safe(() => {
      successRan = true;
    });
    expect(successRan).toBe(true);
    expect(chain.depth).toBe(0);
  });
});
