// SPDX-License-Identifier: MPL-2.0

/**
 * # communityStore tests
 *
 * Covers the community theme store: loadThemes, loadMore, installTheme,
 * cancelInstall, updateDownloadProgress, and selection actions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const {
  mockListCommunityThemes,
  mockGetCommunityTheme,
  mockDownloadCommunityTheme,
  mockCancelCommunityDownload,
  mockOnCommunityDownloadProgress,
  mockFail,
  mockShowToast,
} = vi.hoisted(() => ({
  mockListCommunityThemes: vi.fn(),
  mockGetCommunityTheme: vi.fn(),
  mockDownloadCommunityTheme: vi.fn(),
  mockCancelCommunityDownload: vi.fn(),
  mockOnCommunityDownloadProgress: vi.fn(),
  mockFail: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listCommunityThemes: mockListCommunityThemes,
    getCommunityTheme: mockGetCommunityTheme,
    downloadCommunityTheme: mockDownloadCommunityTheme,
    cancelCommunityDownload: mockCancelCommunityDownload,
    onCommunityDownloadProgress: mockOnCommunityDownloadProgress,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      fail: mockFail,
      showToast: mockShowToast,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useCommunityStore } from './communityStore';

// ---------------------------------------------------------------------------
// Local reset helper (avoids importing test-helpers/index.ts which pulls in
// agentStore → statusStore → api.onCoordinatorStatus at module level)
// ---------------------------------------------------------------------------

function resetCommunityStore() {
  useCommunityStore.setState({
    themes: [],
    total: 0,
    page: 1,
    pageSize: 20,
    sortBy: 'popular',
    query: '',
    loading: false,
    loadingMore: false,
    error: null,
    selectedThemeId: null,
    selectedThemeDetail: null,
    detailLoading: false,
    downloadProgress: new Map(),
    installingIds: new Set(),
    installedIds: new Set(),
  });
}

function makeTheme(id: string, name = `Theme ${id}`) {
  return {
    themeId: id,
    name,
    slug: id,
    author: { id: 'a1', displayName: 'Author' },
    thumbnail: null,
    downloads: 100,
    likes: 10,
    tags: [],
    updatedAt: '2026-01-01',
    description: `Description for ${id}`,
    rating: 4.5,
    version: '1.0.0',
  };
}

function makeListResult(themes: ReturnType<typeof makeTheme>[], total: number) {
  return {
    success: true,
    data: { themes, total, page: 1, pageSize: 20 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('communityStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    // Reset module-level loadToken by reloading the module is not feasible;
    // instead we ensure tests don't interfere by keeping them independent.
  });

  // -----------------------------------------------------------------------
  // loadThemes
  // -----------------------------------------------------------------------

  describe('loadThemes', () => {
    it('loads themes and updates state on success', async () => {
      const items = [makeTheme('t1'), makeTheme('t2')];
      mockListCommunityThemes.mockResolvedValue(makeListResult(items, 2));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes).toEqual(items);
      expect(state.total).toBe(2);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('handles API error gracefully', async () => {
      mockListCommunityThemes.mockRejectedValue(new Error('Network error'));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.loading).toBe(false);
    });

    it('discards stale responses when a newer request was issued', async () => {
      const staleThemes = [makeTheme('stale')];
      const freshThemes = [makeTheme('fresh')];

      // First call delays, second resolves quickly
      mockListCommunityThemes
        .mockReturnValueOnce(new Promise((resolve) => setTimeout(() => resolve(makeListResult(staleThemes, 1)), 50)))
        .mockResolvedValueOnce(makeListResult(freshThemes, 1));

      const p1 = useCommunityStore.getState().loadThemes();
      const p2 = useCommunityStore.getState().loadThemes();

      await Promise.all([p1, p2]);

      expect(useCommunityStore.getState().themes).toEqual(freshThemes);
    });
  });

  // -----------------------------------------------------------------------
  // loadMore
  // -----------------------------------------------------------------------

  describe('loadMore', () => {
    it('appends themes and increments page on success', async () => {
      // Initial state
      useCommunityStore.setState({
        themes: [makeTheme('t1')],
        total: 4,
        page: 1,
      });

      const moreItems = [makeTheme('t2'), makeTheme('t3')];
      mockListCommunityThemes.mockResolvedValue(makeListResult(moreItems, 4));

      await useCommunityStore.getState().loadMore();

      const state = useCommunityStore.getState();
      expect(state.themes).toHaveLength(3);
      expect(state.page).toBe(2);
      expect(state.loadingMore).toBe(false);
    });

    it('does not load more when themes.length >= total', async () => {
      useCommunityStore.setState({
        themes: [makeTheme('t1')],
        total: 1,
      });

      await useCommunityStore.getState().loadMore();

      expect(mockListCommunityThemes).not.toHaveBeenCalled();
    });

    it('handles loadMore error gracefully', async () => {
      useCommunityStore.setState({
        themes: [],
        total: 5,
      });

      mockListCommunityThemes.mockRejectedValue(new Error('Load more failed'));

      await useCommunityStore.getState().loadMore();

      const state = useCommunityStore.getState();
      expect(state.loadingMore).toBe(false);
      expect(state.error).toBe('Load more failed');
    });
  });

  // -----------------------------------------------------------------------
  // installTheme
  // -----------------------------------------------------------------------

  describe('installTheme', () => {
    it('returns early if theme is already being installed (idempotency)', async () => {
      useCommunityStore.setState({
        installingIds: new Set(['t1']),
      });

      const result = await useCommunityStore.getState().installTheme('t1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Theme is already being installed');
      expect(mockDownloadCommunityTheme).not.toHaveBeenCalled();
    });

    it('installs theme successfully and updates all state', async () => {
      mockDownloadCommunityTheme.mockResolvedValue({
        success: true,
        data: { themeId: 't1', success: true },
      });

      const result = await useCommunityStore.getState().installTheme('t1');

      expect(result.success).toBe(true);
      expect(useCommunityStore.getState().installedIds.has('t1')).toBe(true);
      expect(useCommunityStore.getState().installingIds.has('t1')).toBe(false);
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
    });

    it('handles installation failure and cleans up state', async () => {
      mockDownloadCommunityTheme.mockResolvedValue({
        success: true,
        data: { themeId: 't1', success: false, error: 'Download failed' },
      });

      const result = await useCommunityStore.getState().installTheme('t1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download failed');
      expect(useCommunityStore.getState().installingIds.has('t1')).toBe(false);
      expect(useCommunityStore.getState().installedIds.has('t1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // cancelInstall
  // -----------------------------------------------------------------------

  describe('cancelInstall', () => {
    it('clears installing and progress state regardless of IPC result', async () => {
      useCommunityStore.setState({
        installingIds: new Set(['t1', 't2']),
        downloadProgress: new Map([['t1', { themeId: 't1', phase: 'downloading' as const, progress: 50, bytesDownloaded: 100, totalBytes: 200 }]]),
      });

      mockCancelCommunityDownload.mockResolvedValue(undefined);

      await useCommunityStore.getState().cancelInstall('t1');

      const state = useCommunityStore.getState();
      expect(state.installingIds.has('t1')).toBe(false);
      expect(state.installingIds.has('t2')).toBe(true); // other entries untouched
      expect(state.downloadProgress.has('t1')).toBe(false);
    });

    it('handles IPC failure without crashing (try-catch)', async () => {
      useCommunityStore.setState({
        installingIds: new Set(['t1']),
        downloadProgress: new Map(),
      });

      mockCancelCommunityDownload.mockRejectedValue(new Error('IPC crash'));

      await expect(
        useCommunityStore.getState().cancelInstall('t1'),
      ).resolves.toBeUndefined();

      // State is still updated even though IPC failed
      expect(useCommunityStore.getState().installingIds.has('t1')).toBe(false);
      expect(mockFail).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // updateDownloadProgress
  // -----------------------------------------------------------------------

  describe('updateDownloadProgress', () => {
    it('updates progress immutably', () => {
      const progress = { themeId: 't1', phase: 'downloading' as const, progress: 75, bytesDownloaded: 150, totalBytes: 200 };
      useCommunityStore.getState().updateDownloadProgress(progress);

      const state = useCommunityStore.getState();
      expect(state.downloadProgress.get('t1')).toEqual(progress);
    });

    it('overwrites previous progress for the same theme', () => {
      const p1 = { themeId: 't1', phase: 'downloading' as const, progress: 25, bytesDownloaded: 50, totalBytes: 200 };
      const p2 = { themeId: 't1', phase: 'installing' as const, progress: 90, bytesDownloaded: 180, totalBytes: 200 };

      useCommunityStore.getState().updateDownloadProgress(p1);
      useCommunityStore.getState().updateDownloadProgress(p2);

      expect(useCommunityStore.getState().downloadProgress.get('t1')).toEqual(p2);
    });
  });

  // -----------------------------------------------------------------------
  // selectTheme
  // -----------------------------------------------------------------------

  describe('selectTheme', () => {
    it('sets selectedThemeId and clears detail', () => {
      useCommunityStore.setState({
        selectedThemeDetail: { id: 'old' } as never,
      });

      useCommunityStore.getState().selectTheme('new-id');

      const state = useCommunityStore.getState();
      expect(state.selectedThemeId).toBe('new-id');
      expect(state.selectedThemeDetail).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // setQuery
  // -----------------------------------------------------------------------

  describe('setQuery', () => {
    it('updates query and resets page to 1', () => {
      useCommunityStore.setState({ page: 3 });

      useCommunityStore.getState().setQuery('search term');

      const state = useCommunityStore.getState();
      expect(state.query).toBe('search term');
      expect(state.page).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // clearError
  // -----------------------------------------------------------------------

  describe('clearError', () => {
    it('resets error to null', () => {
      useCommunityStore.setState({ error: 'Some error' });

      useCommunityStore.getState().clearError();

      expect(useCommunityStore.getState().error).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // sanitizeTheme — defensive data normalization
  // -----------------------------------------------------------------------

  describe('sanitizeTheme (via loadThemes)', () => {
    it('preserves author when present', async () => {
      const items = [makeTheme('t1')];
      mockListCommunityThemes.mockResolvedValue(makeListResult(items, 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'a1', displayName: 'Author' });
    });

    it('fills in default author when API returns null author', async () => {
      const themeWithoutAuthor = {
        themeId: 't1',
        name: 'Theme Without Author',
        author: null as unknown as { id: string; displayName: string },
        description: 'desc',
        tags: [],
        downloads: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      };
      mockListCommunityThemes.mockResolvedValue(
        makeListResult([themeWithoutAuthor], 1),
      );

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });

    it('fills in default author when API returns undefined author', async () => {
      const themeWithoutAuthor = {
        themeId: 't2',
        name: 'Theme Missing Author',
        // author field omitted entirely
        description: 'desc',
        tags: [],
        downloads: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(
        makeListResult([themeWithoutAuthor], 1),
      );

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });

    it('sanitizes theme detail in loadThemeDetail', async () => {
      const detailWithoutAuthor = {
        themeId: 't4',
        name: 'Detail Missing Author',
        author: null as unknown as { id: string; displayName: string },
        description: 'desc',
        tags: [],
        downloads: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
        screenshots: [],
        targetAgents: ['traework'],
      };
      mockGetCommunityTheme.mockResolvedValue({
        success: true,
        data: detailWithoutAuthor,
      });

      await useCommunityStore.getState().loadThemeDetail('t4');

      const state = useCommunityStore.getState();
      expect(state.selectedThemeDetail?.author).toEqual({
        id: 'unknown',
        displayName: 'Unknown',
      });
    });

    it('sanitizes themes in loadMore as well', async () => {
      useCommunityStore.setState({
        themes: [],
        total: 5,
        page: 1,
      });

      const themeWithoutAuthor = {
        themeId: 't3',
        name: 'LoadMore Missing Author',
        author: null as unknown as { id: string; displayName: string },
        description: 'desc',
        tags: [],
        downloads: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      };
      mockListCommunityThemes.mockResolvedValue(
        makeListResult([themeWithoutAuthor], 5),
      );

      await useCommunityStore.getState().loadMore();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });
  });
});
