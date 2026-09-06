// SPDX-License-Identifier: MPL-2.0

/**
 * # store-test-harness
 *
 * Generic test harness for Zustand stores that depend on `api` (IPC client).
 *
 * ## Why
 *
 * Every store test needs to:
 *   1. Mock `@/api/agentSkinClient` so no real IPC calls fire.
 *   2. Reset the store to a known initial state in `beforeEach`.
 *   3. Provide typed mock functions for the API methods the store calls.
 *
 * This helper centralizes steps 1-2 and returns typed mocks so each test
 * file only declares what it needs.
 *
 * ## Usage
 *
 * ```ts
 * const mocks = createStoreHarness({
 *   listTargets: vi.fn(),
 *   // ...only the methods your store uses
 * });
 *
 * // In tests:
 * mocks.listTargets.mockResolvedValue(['agent1']);
 * await useMyStore.getState().loadTargets();
 * expect(useMyStore.getState().targets).toEqual(['agent1']);
 * ```
 */

import { beforeEach, vi } from 'vitest';

/** A mock record — maps API method names to vitest mock functions. */
export type MockFns = Record<string, ReturnType<typeof vi.fn>>;

/**
 * Create a store test harness.
 *
 * @param fns  Map of API method name → pre-created `vi.fn()` mock.
 *             These are registered as the mock implementation of
 *             `@/api/agentSkinClient` and reset before each test.
 * @returns   The same `fns` object, ready for use in tests.
 */
export function createStoreHarness<T extends MockFns>(fns: T): T {
  vi.mock('@/api/agentSkinClient', () => ({
    api: fns,
  }));

  beforeEach(() => {
    for (const key of Object.keys(fns)) {
      fns[key].mockReset();
    }
  });

  return fns;
}
