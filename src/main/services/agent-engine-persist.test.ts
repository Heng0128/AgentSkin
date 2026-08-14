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

    // Start a pending write that we control resolution of.
    // The callback runs in a microtask (when the chain reaches it), so
    // resolveWrite is not assigned until we yield once.
    let resolveWrite: (() => void) | undefined;
    const writePromise = chain.safe(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    // safe() incremented pending synchronously: depth is already 1
    expect(chain.depth).toBe(1);

    // Let the write callback execute so resolveWrite is assigned
    await Promise.resolve();

    // Complete the write
    resolveWrite!();
    await writePromise;

    // The decrement happens in .finally on this.chain (a separate branch
    // from the returned result), so we poll until it settles.
    await vi.waitFor(() => expect(chain.depth).toBe(0));
  });

  it('depth tracks multiple queued writes', async () => {
    const chain = new PersistChain();
    expect(chain.depth).toBe(0);

    // Pre-create promises so all resolvers are available synchronously.
    // (If resolvers were captured inside the write callback, they would
    // only be populated as each write reaches the front of the chain.)
    const resolvers: (() => void)[] = [];
    const innerPromises = [1, 2, 3].map(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    // Queue the writes using the pre-created promises
    const promises = innerPromises.map((p) => chain.safe(() => p));

    // All 3 writes are queued synchronously: depth = 3
    expect(chain.depth).toBe(3);

    // Resolve first write — after it settles, .finally decrements and
    // the second write starts executing.
    resolvers[0]();
    await promises[0];
    await vi.waitFor(() => expect(chain.depth).toBe(2));

    // Resolve second write
    resolvers[1]();
    await promises[1];
    await vi.waitFor(() => expect(chain.depth).toBe(1));

    // Resolve third write
    resolvers[2]();
    await promises[2];
    await vi.waitFor(() => expect(chain.depth).toBe(0));
  });

  it('depth decrements on write failure and continues chain', async () => {
    const chain = new PersistChain();
    expect(chain.depth).toBe(0);

    // First write rejects — safe() returns the rejected promise, but the
    // chain itself swallows the error and decrements depth.
    const failingPromise = chain.safe(() => Promise.reject(new Error('boom')));
    await failingPromise.catch(() => {});

    // Poll until the chain's .finally has decremented depth
    await vi.waitFor(() => expect(chain.depth).toBe(0));

    // Subsequent writes still execute normally
    let successRan = false;
    await chain.safe(() => {
      successRan = true;
    });
    expect(successRan).toBe(true);

    // Poll until the success write's .finally has decremented depth
    await vi.waitFor(() => expect(chain.depth).toBe(0));
  });
});
