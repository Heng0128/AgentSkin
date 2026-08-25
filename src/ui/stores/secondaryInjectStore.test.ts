// SPDX-License-Identifier: MPL-2.0

/**
 * # secondaryInjectStore tests
 *
 * Covers the secondary injection store: init, _handleProgress, _handleSummary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOnSecondaryInjectProgress = vi.fn();
const mockOnSecondaryInjectSummary = vi.fn();

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    onSecondaryInjectProgress: mockOnSecondaryInjectProgress,
    onSecondaryInjectSummary: mockOnSecondaryInjectSummary,
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useSecondaryInjectStore } from './secondaryInjectStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useSecondaryInjectStore.setState({
    byAgent: {},
    _initialized: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('secondaryInjectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -----------------------------------------------------------------------
  // init
  // -----------------------------------------------------------------------

  describe('init', () => {
    it('registers IPC subscriptions when called', () => {
      useSecondaryInjectStore.getState().init();

      expect(mockOnSecondaryInjectProgress).toHaveBeenCalledWith(expect.any(Function));
      expect(mockOnSecondaryInjectSummary).toHaveBeenCalledWith(expect.any(Function));
    });

    it('is idempotent — calling twice does not re-subscribe', () => {
      useSecondaryInjectStore.getState().init();
      useSecondaryInjectStore.getState().init();

      expect(mockOnSecondaryInjectProgress).toHaveBeenCalledTimes(1);
      expect(mockOnSecondaryInjectSummary).toHaveBeenCalledTimes(1);
    });

    it('sets _initialized flag after first call', () => {
      expect(useSecondaryInjectStore.getState()._initialized).toBe(false);

      useSecondaryInjectStore.getState().init();

      expect(useSecondaryInjectStore.getState()._initialized).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // _handleProgress
  // -----------------------------------------------------------------------

  describe('_handleProgress', () => {
    it('adds a new step to the agent progress track', () => {
      const agent = 'traework';
      const event = {
        agent,
        targetId: 'target-1',
        targetType: 'webview',
        title: 'Test Target',
        success: true,
        elapsed: 42,
      };

      useSecondaryInjectStore.getState()._handleProgress(event);

      const state = useSecondaryInjectStore.getState();
      expect(state.byAgent[agent]).toBeDefined();
      expect(state.byAgent[agent].steps).toHaveLength(1);
      expect(state.byAgent[agent].steps[0]).toMatchObject({
        targetId: 'target-1',
        targetType: 'webview',
        title: 'Test Target',
        success: true,
        elapsed: 42,
        timestamp: expect.any(Number),
      });
    });

    it('appends multiple steps for the same agent', () => {
      const agent = 'qoderwork';
      const event1 = {
        agent,
        targetId: 't1',
        targetType: 'webview',
        success: true,
        elapsed: 10,
      };
      const event2 = {
        agent,
        targetId: 't2',
        targetType: 'iframe',
        success: false,
        error: 'timeout',
        elapsed: 5000,
      };

      useSecondaryInjectStore.getState()._handleProgress(event1);
      useSecondaryInjectStore.getState()._handleProgress(event2);

      const steps = useSecondaryInjectStore.getState().byAgent[agent].steps;
      expect(steps).toHaveLength(2);
      expect(steps[1].error).toBe('timeout');
    });

    it('creates a new agent entry with correct startedAt', () => {
      const agent = 'workbuddy';
      const before = Date.now();

      useSecondaryInjectStore.getState()._handleProgress({
        agent,
        targetId: 't1',
        targetType: 'webview',
        success: true,
        elapsed: 5,
      });

      const state = useSecondaryInjectStore.getState();
      expect(state.byAgent[agent].startedAt).toBeGreaterThanOrEqual(before);
      expect(state.byAgent[agent].summary).toBeNull();
    });

    it('does not mutate other agents when adding progress', () => {
      useSecondaryInjectStore.getState()._handleProgress({
        agent: 'agent-a',
        targetId: 't1',
        targetType: 'webview',
        success: true,
        elapsed: 10,
      });

      useSecondaryInjectStore.getState()._handleProgress({
        agent: 'agent-b',
        targetId: 't2',
        targetType: 'iframe',
        success: true,
        elapsed: 20,
      });

      const state = useSecondaryInjectStore.getState();
      expect(Object.keys(state.byAgent)).toHaveLength(2);
      expect(state.byAgent['agent-a'].steps).toHaveLength(1);
      expect(state.byAgent['agent-b'].steps).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // _handleSummary
  // -----------------------------------------------------------------------

  describe('_handleSummary', () => {
    it('updates summary for an existing agent', () => {
      const agent = 'traework';

      // First add a progress step
      useSecondaryInjectStore.getState()._handleProgress({
        agent,
        targetId: 't1',
        targetType: 'webview',
        success: true,
        elapsed: 10,
      });

      // Then handle the summary
      useSecondaryInjectStore.getState()._handleSummary({
        agent,
        injected: 3,
        failed: 1,
        total: 4,
        duration: 150,
      });

      const state = useSecondaryInjectStore.getState();
      expect(state.byAgent[agent].summary).toEqual({
        injected: 3,
        failed: 1,
        total: 4,
        duration: 150,
      });
      // Steps are preserved alongside the summary
      expect(state.byAgent[agent].steps).toHaveLength(1);
    });

    it('creates a new agent entry on first summary event', () => {
      const agent = 'doubao';

      useSecondaryInjectStore.getState()._handleSummary({
        agent,
        injected: 5,
        failed: 0,
        total: 5,
        duration: 200,
      });

      expect(useSecondaryInjectStore.getState().byAgent[agent].summary).toEqual({
        injected: 5,
        failed: 0,
        total: 5,
        duration: 200,
      });
    });

    it('each summary is immutable — does not mutate previous agent state', () => {
      const agent = 'codex';

      useSecondaryInjectStore.getState()._handleSummary({
        agent,
        injected: 2,
        failed: 0,
        total: 2,
        duration: 100,
      });

      const firstSummary = useSecondaryInjectStore.getState().byAgent[agent].summary;

      useSecondaryInjectStore.getState()._handleSummary({
        agent,
        injected: 5,
        failed: 1,
        total: 6,
        duration: 300,
      });

      const secondSummary = useSecondaryInjectStore.getState().byAgent[agent].summary;
      expect(firstSummary).not.toEqual(secondSummary);
      expect(secondSummary?.injected).toBe(5);
    });
  });
});
