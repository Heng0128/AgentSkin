// SPDX-License-Identifier: MPL-2.0

/**
 * # selectorStore tests
 *
 * Covers the selector probe and validation store: probe, validate, reset.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  probeSelector: vi.fn(),
  validateSelectors: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    probeSelector: mocks.probeSelector,
    validateSelectors: mocks.validateSelectors,
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { SelectorProbeResult, SelectorValidationReport } from '@shared/types/selector-probe';
import { useSelectorStore } from './selectorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useSelectorStore.getState().reset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -----------------------------------------------------------------------
  // probe
  // -----------------------------------------------------------------------

  describe('probe', () => {
    it('populates probeResult on success', async () => {
      const fakeResult = {
        selector: '.foo',
        kind: 'hit',
        count: 3,
      } as SelectorProbeResult;
      mocks.probeSelector.mockResolvedValue(fakeResult);

      await useSelectorStore.getState().probe(9222, '.foo');

      const state = useSelectorStore.getState();
      expect(state.probeResult).toEqual(fakeResult);
      expect(state.probing).toBe(false);
      expect(state.probeError).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.probeSelector.mockRejectedValue(new Error('CDP disconnected'));

      await useSelectorStore.getState().probe(9222, '.foo');

      const state = useSelectorStore.getState();
      expect(state.probeResult).toBeNull();
      expect(state.probeError).toBe('CDP disconnected');
      expect(state.probing).toBe(false);
    });

    it('sets probing flag during fetch', async () => {
      let resolvePromise: (val: SelectorProbeResult) => void = () => {};
      mocks.probeSelector.mockImplementation(
        () =>
          new Promise((r) => {
            resolvePromise = r;
          }),
      );

      const promise = useSelectorStore.getState().probe(9222, '.foo');

      expect(useSelectorStore.getState().probing).toBe(true);

      resolvePromise({ selector: '.foo', kind: 'miss', count: 0 } as SelectorProbeResult);
      await promise;
      expect(useSelectorStore.getState().probing).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // validate
  // -----------------------------------------------------------------------

  describe('validate', () => {
    it('populates validationReport on success', async () => {
      const fakeReport = {
        agentId: 'traework',
        results: [],
        summary: { total: 5, hit: 4, miss: 0, invalid: 1, timeout: 0 },
        timestamp: Date.now(),
      } as SelectorValidationReport;
      mocks.validateSelectors.mockResolvedValue(fakeReport);

      await useSelectorStore.getState().validate(9222, 'traework', ['.foo', '.bar']);

      const state = useSelectorStore.getState();
      expect(state.validationReport).toEqual(fakeReport);
      expect(state.validating).toBe(false);
      expect(state.validationError).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.validateSelectors.mockRejectedValue(new Error('validation failed'));

      await useSelectorStore.getState().validate(9222, 'traework', ['.foo']);

      const state = useSelectorStore.getState();
      expect(state.validationReport).toBeNull();
      expect(state.validationError).toBe('validation failed');
      expect(state.validating).toBe(false);
    });

    it('sets validating flag during fetch', async () => {
      let resolvePromise: (val: SelectorValidationReport) => void = () => {};
      mocks.validateSelectors.mockImplementation(
        () =>
          new Promise((r) => {
            resolvePromise = r;
          }),
      );

      const promise = useSelectorStore.getState().validate(9222, 'traework', ['.foo']);

      expect(useSelectorStore.getState().validating).toBe(true);

      resolvePromise({
        agentId: 'traework',
        results: [],
        summary: { total: 0, hit: 0, miss: 0, invalid: 0, timeout: 0 },
        timestamp: Date.now(),
      } as SelectorValidationReport);
      await promise;
      expect(useSelectorStore.getState().validating).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  describe('reset', () => {
    it('restores initial state', async () => {
      mocks.probeSelector.mockResolvedValue({
        selector: '.foo',
        kind: 'hit',
        count: 1,
      } as SelectorProbeResult);
      await useSelectorStore.getState().probe(9222, '.foo');

      useSelectorStore.getState().reset();

      const state = useSelectorStore.getState();
      expect(state.probeResult).toBeNull();
      expect(state.validationReport).toBeNull();
      expect(state.probing).toBe(false);
      expect(state.validating).toBe(false);
      expect(state.probeError).toBeNull();
      expect(state.validationError).toBeNull();
    });
  });
});
