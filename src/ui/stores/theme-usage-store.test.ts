// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the api client before importing the store.
const mockThemeUsageGet = vi.fn();

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    themeUsageGet: mockThemeUsageGet,
  },
}));

// Import after mocks are declared.
const { useThemeUsageStore, selectSortedThemes, selectUsageMap, selectUsageLoading } = await import(
  './theme-usage-store'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('themeUsageStore', () => {
  beforeEach(() => {
    useThemeUsageStore.getState().reset();
    mockThemeUsageGet.mockReset();
  });

  it('initializes with empty state', () => {
    const state = useThemeUsageStore.getState();
    expect(state.usage).toEqual({});
    expect(state.sortedByAgent).toEqual({});
    expect(state.loading).toBe(false);
  });

  describe('getSortedThemes', () => {
    it('returns empty array when no cached data', () => {
      const result = useThemeUsageStore.getState().getSortedThemes('traework');
      expect(result).toEqual([]);
    });

    it('returns cached sorted themes for an agent', () => {
      useThemeUsageStore.setState({
        sortedByAgent: { traework: ['neon', 'ocean'] },
      });
      const result = useThemeUsageStore.getState().getSortedThemes('traework');
      expect(result).toEqual(['neon', 'ocean']);
    });

    it('returns empty array for agent with no cached data', () => {
      useThemeUsageStore.setState({
        sortedByAgent: { traework: ['neon'] },
      });
      const result = useThemeUsageStore.getState().getSortedThemes('workbuddy');
      expect(result).toEqual([]);
    });
  });

  describe('loadSortedThemes', () => {
    it('calls api.themeUsageGet and updates sortedByAgent', async () => {
      mockThemeUsageGet.mockResolvedValue(['neon', 'ocean', 'forest']);

      await useThemeUsageStore.getState().loadSortedThemes('traework', ['neon', 'ocean', 'forest']);

      expect(mockThemeUsageGet).toHaveBeenCalledWith(
        'traework',
        ['neon', 'ocean', 'forest'],
        undefined,
      );
      const state = useThemeUsageStore.getState();
      expect(state.sortedByAgent.traework).toEqual(['neon', 'ocean', 'forest']);
      expect(state.loading).toBe(false);
    });

    it('passes limit to api call when provided', async () => {
      mockThemeUsageGet.mockResolvedValue(['neon', 'ocean']);

      await useThemeUsageStore
        .getState()
        .loadSortedThemes('traework', ['neon', 'ocean', 'forest'], 2);

      expect(mockThemeUsageGet).toHaveBeenCalledWith('traework', ['neon', 'ocean', 'forest'], 2);
      const state = useThemeUsageStore.getState();
      expect(state.sortedByAgent.traework).toEqual(['neon', 'ocean']);
      expect(state.loading).toBe(false);
    });

    it('sets loading to true while in flight', () => {
      let resolvePromise: (value: string[]) => void;
      mockThemeUsageGet.mockImplementation(
        () =>
          new Promise<string[]>((resolve) => {
            resolvePromise = resolve;
          }),
      );

      const promise = useThemeUsageStore.getState().loadSortedThemes('traework', ['neon']);

      // After the synchronous part of the action, loading should be true.
      expect(useThemeUsageStore.getState().loading).toBe(true);

      resolvePromise!(['neon']);
      return promise;
    });

    it('resolves loading to false after completion', async () => {
      mockThemeUsageGet.mockResolvedValue(['neon']);

      await useThemeUsageStore.getState().loadSortedThemes('traework', ['neon']);
      expect(useThemeUsageStore.getState().loading).toBe(false);
    });

    it('catches IPC errors and does not throw', async () => {
      mockThemeUsageGet.mockRejectedValue(new Error('IPC failed'));

      await expect(
        useThemeUsageStore.getState().loadSortedThemes('traework', ['neon']),
      ).resolves.toBeUndefined();

      const state = useThemeUsageStore.getState();
      expect(state.loading).toBe(false);
      // Existing cache should remain intact (empty in this case).
      expect(state.sortedByAgent.traework).toBeUndefined();
    });

    it('overwrites previous sorted data for same agent', async () => {
      useThemeUsageStore.setState({
        sortedByAgent: { traework: ['old-theme'] },
      });

      mockThemeUsageGet.mockResolvedValue(['new-theme']);
      await useThemeUsageStore.getState().loadSortedThemes('traework', ['new-theme']);

      expect(useThemeUsageStore.getState().sortedByAgent.traework).toEqual(['new-theme']);
    });

    it('preserves sorted data for other agents', async () => {
      useThemeUsageStore.setState({
        sortedByAgent: { workbuddy: ['forest'] },
      });

      mockThemeUsageGet.mockResolvedValue(['neon']);
      await useThemeUsageStore.getState().loadSortedThemes('traework', ['neon']);

      const state = useThemeUsageStore.getState();
      expect(state.sortedByAgent.workbuddy).toEqual(['forest']);
      expect(state.sortedByAgent.traework).toEqual(['neon']);
    });
  });

  describe('setUsage', () => {
    it('replaces the usage map', () => {
      const newUsage = { traework: { neon: { count: 5, lastUsed: 1_700_000_000_000 } } };
      useThemeUsageStore.getState().setUsage(newUsage);
      expect(useThemeUsageStore.getState().usage).toEqual(newUsage);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      useThemeUsageStore.setState({
        usage: { traework: { neon: { count: 1, lastUsed: 0 } } },
        sortedByAgent: { traework: ['neon'] },
        loading: true,
      });

      useThemeUsageStore.getState().reset();

      const state = useThemeUsageStore.getState();
      expect(state.usage).toEqual({});
      expect(state.sortedByAgent).toEqual({});
      expect(state.loading).toBe(false);
    });
  });

  describe('selectors', () => {
    it('selectSortedThemes returns cached themes for agent', () => {
      useThemeUsageStore.setState({
        sortedByAgent: { traework: ['neon', 'ocean'] },
      });
      const state = useThemeUsageStore.getState();
      expect(selectSortedThemes('traework')(state)).toEqual(['neon', 'ocean']);
    });

    it('selectSortedThemes returns empty for unknown agent', () => {
      const state = useThemeUsageStore.getState();
      expect(selectSortedThemes('traework')(state)).toEqual([]);
    });

    it('selectUsageMap returns the usage map', () => {
      const usage = { traework: { neon: { count: 1, lastUsed: 0 } } };
      useThemeUsageStore.setState({ usage });
      expect(selectUsageMap(useThemeUsageStore.getState())).toEqual(usage);
    });

    it('selectUsageLoading returns loading state', () => {
      useThemeUsageStore.setState({ loading: true });
      expect(selectUsageLoading(useThemeUsageStore.getState())).toBe(true);
    });
  });
});
