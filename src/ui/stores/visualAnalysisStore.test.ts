// SPDX-License-Identifier: MPL-2.0

/**
 * # visualAnalysisStore tests
 *
 * Covers the visual analysis store: loadTargets, loadSummaries, loadTarget,
 * detectAgent, exportTheme, setProgress, reset.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listVisualAnalysisTargets: vi.fn(),
  listVisualAnalysisSummaries: vi.fn(),
  getVisualAnalysisTarget: vi.fn(),
  detectVisualAnalysisAgent: vi.fn(),
  exportVisualAnalysisTheme: vi.fn(),
  onVisualAnalysisProgress: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listVisualAnalysisTargets: mocks.listVisualAnalysisTargets,
    listVisualAnalysisSummaries: mocks.listVisualAnalysisSummaries,
    getVisualAnalysisTarget: mocks.getVisualAnalysisTarget,
    detectVisualAnalysisAgent: mocks.detectVisualAnalysisAgent,
    exportVisualAnalysisTheme: mocks.exportVisualAnalysisTheme,
    onVisualAnalysisProgress: mocks.onVisualAnalysisProgress,
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useVisualAnalysisStore } from './visualAnalysisStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useVisualAnalysisStore.getState().reset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('visualAnalysisStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -----------------------------------------------------------------------
  // loadTargets
  // -----------------------------------------------------------------------

  describe('loadTargets', () => {
    it('populates targets on success', async () => {
      mocks.listVisualAnalysisTargets.mockResolvedValue(['traework', 'qoderwork']);

      await useVisualAnalysisStore.getState().loadTargets();

      const state = useVisualAnalysisStore.getState();
      expect(state.targets).toEqual(['traework', 'qoderwork']);
      expect(state.loading.targets).toBe(false);
      expect(state.errors.targets).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.listVisualAnalysisTargets.mockRejectedValue(new Error('IPC timeout'));

      await useVisualAnalysisStore.getState().loadTargets();

      const state = useVisualAnalysisStore.getState();
      expect(state.targets).toEqual([]);
      expect(state.errors.targets).toBe('IPC timeout');
      expect(state.loading.targets).toBe(false);
    });

    it('sets loading flag during fetch', async () => {
      let resolvePromise: (val: string[]) => void = () => {};
      mocks.listVisualAnalysisTargets.mockImplementation(
        () =>
          new Promise((r) => {
            resolvePromise = r;
          }),
      );

      const promise = useVisualAnalysisStore.getState().loadTargets();

      // Loading should be true while the IPC call is in-flight
      expect(useVisualAnalysisStore.getState().loading.targets).toBe(true);

      resolvePromise(['traework']);
      await promise;
      expect(useVisualAnalysisStore.getState().loading.targets).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // loadSummaries
  // -----------------------------------------------------------------------

  describe('loadSummaries', () => {
    it('populates summaries on success', async () => {
      const fakeSummaries: import('@shared/types').VisualAnalysisSummary[] = [
        {
          id: 'traework',
          tokensLight: 14,
          tokensDark: 14,
          categories: ['dark', 'light'],
          stats: {
            rootVars: { default: 10, dark: 8, light: 2 },
            domNodes: { default: 100, dark: 50, light: 50 },
            styleVars: { dark: 5, light: 3, neutral: 2 },
            computedSamples: { default: 1000, dark: 500, light: 500 },
          },
        },
      ];
      mocks.listVisualAnalysisSummaries.mockResolvedValue(fakeSummaries);

      await useVisualAnalysisStore.getState().loadSummaries();

      const state = useVisualAnalysisStore.getState();
      expect(state.summaries).toEqual(fakeSummaries);
      expect(state.loading.summaries).toBe(false);
      expect(state.errors.summaries).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.listVisualAnalysisSummaries.mockRejectedValue(new Error('boom'));

      await useVisualAnalysisStore.getState().loadSummaries();

      const state = useVisualAnalysisStore.getState();
      expect(state.summaries).toEqual([]);
      expect(state.errors.summaries).toBe('boom');
    });
  });

  // -----------------------------------------------------------------------
  // loadTarget
  // -----------------------------------------------------------------------

  describe('loadTarget', () => {
    it('populates currentTarget on success', async () => {
      const fakeData = { colors: { accent: '#ff0000' } };
      mocks.getVisualAnalysisTarget.mockResolvedValue(
        fakeData as unknown as Record<string, unknown>,
      );

      await useVisualAnalysisStore.getState().loadTarget('traework');

      const state = useVisualAnalysisStore.getState();
      expect(state.currentTarget).toEqual(fakeData);
      expect(state.loading.target).toBe(false);
      expect(state.errors.target).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.getVisualAnalysisTarget.mockRejectedValue(new Error('not found'));

      await useVisualAnalysisStore.getState().loadTarget('nonexistent');

      const state = useVisualAnalysisStore.getState();
      expect(state.currentTarget).toBeNull();
      expect(state.errors.target).toBe('not found');
    });
  });

  // -----------------------------------------------------------------------
  // detectAgent
  // -----------------------------------------------------------------------

  describe('detectAgent', () => {
    it('populates detection result on success', async () => {
      mocks.detectVisualAnalysisAgent.mockResolvedValue({
        running: true,
        port: 9222,
        title: 'Trae',
      });

      await useVisualAnalysisStore.getState().detectAgent('traework');

      const state = useVisualAnalysisStore.getState();
      expect(state.detection).toEqual({
        agent: 'traework',
        running: true,
        port: 9222,
        title: 'Trae',
      });
      expect(state.loading.detect).toBe(false);
    });

    it('captures error message on failure', async () => {
      mocks.detectVisualAnalysisAgent.mockRejectedValue(new Error('scan failed'));

      await useVisualAnalysisStore.getState().detectAgent('traework');

      const state = useVisualAnalysisStore.getState();
      expect(state.detection).toBeNull();
      expect(state.errors.detect).toBe('scan failed');
    });
  });

  // -----------------------------------------------------------------------
  // exportTheme
  // -----------------------------------------------------------------------

  describe('exportTheme', () => {
    it('populates exportResult on success', async () => {
      mocks.exportVisualAnalysisTheme.mockResolvedValue({
        ok: true,
        path: '/tmp/theme.agentskin-theme',
      });

      // RC7 fix: exportTheme validates that themeData contains --agentskin-* tokens
      // before sending to IPC — test data must include at least one valid token.
      await useVisualAnalysisStore.getState().exportTheme('traework', {
        '--agentskin-bg': '#ffffff',
        '--agentskin-fg': '#000000',
        '--agentskin-primary': '#0066cc',
      });

      const state = useVisualAnalysisStore.getState();
      expect(state.exportResult).toEqual({ ok: true, path: '/tmp/theme.agentskin-theme' });
      expect(state.loading.export).toBe(false);
      expect(state.errors.export).toBeNull();
    });

    it('captures error message on failure', async () => {
      mocks.exportVisualAnalysisTheme.mockRejectedValue(new Error('export failed'));

      // Must include --agentskin-* tokens to pass pre-IPC validation and reach
      // the actual IPC call that rejects.
      await useVisualAnalysisStore.getState().exportTheme('traework', {
        '--agentskin-bg': '#ffffff',
      });

      const state = useVisualAnalysisStore.getState();
      expect(state.errors.export).toBe('export failed');
      expect(state.loading.export).toBe(false);
    });

    it('rejects export when themeData has no --agentskin-* tokens', async () => {
      // RC7 fix: exportTheme fails fast when no --agentskin-* tokens are present.
      await useVisualAnalysisStore.getState().exportTheme('traework', { foo: 'bar' });

      const state = useVisualAnalysisStore.getState();
      expect(state.errors.export).toBe('Missing --agentskin-* tokens');
      expect(state.loading.export).toBe(false);
      expect(mocks.exportVisualAnalysisTheme).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // setProgress
  // -----------------------------------------------------------------------

  describe('setProgress', () => {
    it('updates progress state', () => {
      const progress = { agent: 'traework', step: 'analyzing', progress: 0.5 };

      useVisualAnalysisStore.getState().setProgress(progress);

      expect(useVisualAnalysisStore.getState().progress).toEqual(progress);
    });

    it('clears progress when passed null', () => {
      useVisualAnalysisStore.getState().setProgress(null);
      expect(useVisualAnalysisStore.getState().progress).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  describe('reset', () => {
    it('restores initial state', async () => {
      mocks.listVisualAnalysisTargets.mockResolvedValue(['traework']);
      await useVisualAnalysisStore.getState().loadTargets();
      useVisualAnalysisStore.getState().setProgress({
        agent: 'traework',
        step: 'x',
        progress: 1,
      });

      useVisualAnalysisStore.getState().reset();

      const state = useVisualAnalysisStore.getState();
      expect(state.targets).toEqual([]);
      expect(state.progress).toBeNull();
      expect(state.loading.targets).toBe(false);
      expect(state.errors.targets).toBeNull();
    });
  });
});
