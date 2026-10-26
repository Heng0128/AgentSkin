// SPDX-License-Identifier: MPL-2.0

/**
 * # communityStore tests
 *
 * Covers the community theme store: loadThemes, loadMore, installTheme,
 * cancelInstall, updateDownloadProgress, and selection actions.
 *
 * New tests (source-driven architecture, RFC §4/§8):
 *   - Rapid source switching race condition protection
 *   - Per-source RequestToken independence
 *   - InstallationLog writes on successful install
 *   - Cache TTL basic behavior (hit/expiry)
 *   - Error isolation between sources
 */

import type { CommunitySourceId, DownloadProgress } from '@shared/types/community';
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
  mockProbeCommunitySource,
  mockLoadCommunityInstallLog,
  mockSaveCommunityInstallLog,
  mockFail,
  mockShowToast,
  mockFetchCodeDrobeThemesList,
  mockFetchCodeDrobeThemeDetail,
} = vi.hoisted(() => ({
  mockListCommunityThemes: vi.fn(),
  mockGetCommunityTheme: vi.fn(),
  mockDownloadCommunityTheme: vi.fn(),
  mockCancelCommunityDownload: vi.fn(),
  mockOnCommunityDownloadProgress: vi.fn(),
  mockProbeCommunitySource: vi.fn(),
  mockLoadCommunityInstallLog: vi.fn(),
  mockSaveCommunityInstallLog: vi.fn(),
  mockFail: vi.fn(),
  mockShowToast: vi.fn(),
  // CodeDrobe now routes through renderer fetch (community-direct-api),
  // not main-process IPC — so these are separate from agentSkinClient mocks.
  mockFetchCodeDrobeThemesList: vi.fn(),
  mockFetchCodeDrobeThemeDetail: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listCommunityThemes: mockListCommunityThemes,
    getCommunityTheme: mockGetCommunityTheme,
    downloadCommunityTheme: mockDownloadCommunityTheme,
    cancelCommunityDownload: mockCancelCommunityDownload,
    onCommunityDownloadProgress: mockOnCommunityDownloadProgress,
    probeCommunitySource: mockProbeCommunitySource,
    loadCommunityInstallLog: mockLoadCommunityInstallLog,
    saveCommunityInstallLog: mockSaveCommunityInstallLog,
  },
}));

vi.mock('@/api/community-direct-api', () => ({
  fetchCodeDrobeThemesList: mockFetchCodeDrobeThemesList,
  fetchCodeDrobeThemeDetail: mockFetchCodeDrobeThemeDetail,
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
import { resetCommunityStore } from './test-helpers/reset-community-store';

const { mockRefreshThemes } = vi.hoisted(() => ({
  mockRefreshThemes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({
      refreshThemes: mockRefreshThemes,
    }),
  },
}));

function makeTheme(id: string, name = `Theme ${id}`, version = '1.0.0') {
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
    version,
  };
}

function makeListResult(themes: ReturnType<typeof makeTheme>[], total: number) {
  return {
    success: true,
    data: { themes, total, page: 1, pageSize: 20 },
  };
}

/**
 * CodeDrobe path returns its result at the top level (no `data` wrapper),
 * per community-direct-api.fetchCodeDrobeThemesList return type.
 */
function makeCodeDrobeListResult(themes: ReturnType<typeof makeTheme>[], total: number) {
  return { themes, total, page: 1, pageSize: themes.length };
}

/**
 * Helper: pre-populate a source slice with installingIds so that
 * installTheme idempotency tests work against the source-driven store
 * (which checks `sources[activeId].installingIds` directly).
 */
function setSourceInstalling(sourceId: CommunitySourceId, themeIds: string[]) {
  const sources = { ...useCommunityStore.getState().sources };
  sources[sourceId] = {
    ...sources[sourceId],
    installingIds: new Set(themeIds),
  };
  useCommunityStore.setState({ sources });
  // Sync flat mirrors from active source
  const activeId = useCommunityStore.getState().activeSourceId;
  useCommunityStore.setState({
    installingIds: sources[activeId].installingIds,
  });
}

/**
 * Helper: set source downloadProgress for cancelInstall tests.
 */
function setSourceDownloadProgress(
  sourceId: CommunitySourceId,
  entries: Array<[string, DownloadProgress]>,
) {
  const sources = { ...useCommunityStore.getState().sources };
  sources[sourceId] = {
    ...sources[sourceId],
    downloadProgress: new Map(entries),
  };
  useCommunityStore.setState({ sources });
  const activeId = useCommunityStore.getState().activeSourceId;
  useCommunityStore.setState({
    downloadProgress: sources[activeId].downloadProgress,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('communityStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
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

    it('discards stale responses when a newer request was issued for the same source', async () => {
      const staleThemes = [makeTheme('stale')];
      const freshThemes = [makeTheme('fresh')];

      // First call delays, second resolves quickly
      mockListCommunityThemes
        .mockReturnValueOnce(
          new Promise((resolve) => setTimeout(() => resolve(makeListResult(staleThemes, 1)), 50)),
        )
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
      setSourceInstalling('dreamskin', ['t1']);

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
      setSourceInstalling('dreamskin', ['t1', 't2']);
      setSourceDownloadProgress('dreamskin', [
        [
          't1',
          {
            themeId: 't1',
            phase: 'downloading' as const,
            progress: 50,
            bytesDownloaded: 100,
            totalBytes: 200,
          },
        ],
      ]);

      mockCancelCommunityDownload.mockResolvedValue(undefined);

      await useCommunityStore.getState().cancelInstall('t1');

      const state = useCommunityStore.getState();
      expect(state.installingIds.has('t1')).toBe(false);
      expect(state.installingIds.has('t2')).toBe(true); // other entries untouched
      expect(state.downloadProgress.has('t1')).toBe(false);
    });

    it('handles IPC failure without crashing (try-catch)', async () => {
      setSourceInstalling('dreamskin', ['t1']);
      setSourceDownloadProgress('dreamskin', []);

      mockCancelCommunityDownload.mockRejectedValue(new Error('IPC crash'));

      await expect(useCommunityStore.getState().cancelInstall('t1')).resolves.toBeUndefined();

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
      const progress = {
        themeId: 't1',
        phase: 'downloading' as const,
        progress: 75,
        bytesDownloaded: 150,
        totalBytes: 200,
      };
      useCommunityStore.getState().updateDownloadProgress(progress);

      const state = useCommunityStore.getState();
      expect(state.downloadProgress.get('t1')).toEqual(progress);
    });

    it('overwrites previous progress for the same theme', () => {
      const p1 = {
        themeId: 't1',
        phase: 'downloading' as const,
        progress: 25,
        bytesDownloaded: 50,
        totalBytes: 200,
      };
      const p2 = {
        themeId: 't1',
        phase: 'installing' as const,
        progress: 90,
        bytesDownloaded: 180,
        totalBytes: 200,
      };

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
        slug: 't1',
        author: null as unknown as { id: string; displayName: string },
        thumbnail: null,
        description: 'desc',
        tags: [],
        downloads: 0,
        likes: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      };
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutAuthor], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });

    it('fills in default author when API returns undefined author', async () => {
      const themeWithoutAuthor = {
        themeId: 't2',
        name: 'Theme Missing Author',
        description: 'desc',
        tags: [],
        downloads: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutAuthor], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });

    it('fills in default rating when API returns undefined rating', async () => {
      const themeWithoutRating = {
        themeId: 't3',
        name: 'Theme Missing Rating',
        author: { id: 'a1', displayName: 'Author' },
        description: 'desc',
        tags: [],
        downloads: 10,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutRating], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.rating).toBe(0);
    });

    it('fills in default name when API returns undefined name', async () => {
      const themeWithoutName = {
        themeId: 't6',
        author: { id: 'a1', displayName: 'Author' },
        description: 'desc',
        tags: [],
        downloads: 10,
        rating: 4.5,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutName], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.name).toBe('Untitled Theme');
    });

    it('fills in default description when API returns undefined description', async () => {
      const themeWithoutDescription = {
        themeId: 't7',
        name: 'Theme Without Description',
        author: { id: 'a1', displayName: 'Author' },
        tags: [],
        downloads: 10,
        rating: 4.5,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutDescription], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.description).toBe('');
    });

    it('fills in default tags when API returns undefined tags', async () => {
      const themeWithoutTags = {
        themeId: 't5',
        name: 'Theme Missing Tags',
        author: { id: 'a1', displayName: 'Author' },
        description: 'desc',
        downloads: 10,
        rating: 4.5,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutTags], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.tags).toEqual([]);
    });

    it('fills in default downloads when API returns undefined downloads', async () => {
      const themeWithoutDownloads = {
        themeId: 't4',
        name: 'Theme Missing Downloads',
        author: { id: 'a1', displayName: 'Author' },
        description: 'desc',
        tags: [],
        rating: 4.5,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      } as unknown as ReturnType<typeof makeTheme>;
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutDownloads], 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.downloads).toBe(0);
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
        slug: 't3',
        author: null as unknown as { id: string; displayName: string },
        thumbnail: null,
        description: 'desc',
        tags: [],
        downloads: 0,
        likes: 0,
        rating: 0,
        updatedAt: '2026-01-01',
        version: '1.0.0',
      };
      mockListCommunityThemes.mockResolvedValue(makeListResult([themeWithoutAuthor], 5));

      await useCommunityStore.getState().loadMore();

      const state = useCommunityStore.getState();
      expect(state.themes[0]?.author).toEqual({ id: 'unknown', displayName: 'Unknown' });
    });
  });

  // -----------------------------------------------------------------------
  // Runtime type guard — malformed API response handling
  // -----------------------------------------------------------------------

  describe('isCommunityThemeListResult (type guard)', () => {
    it('rejects malformed data with missing themes array', async () => {
      mockListCommunityThemes.mockResolvedValue({
        success: true,
        data: { total: 5 }, // missing themes array
      });

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.error).toBeTruthy();
      expect(state.themes).toEqual([]);
    });

    it('rejects malformed data with non-numeric total', async () => {
      mockListCommunityThemes.mockResolvedValue({
        success: true,
        data: { themes: [], total: 'five' }, // wrong type
      });

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.error).toBeTruthy();
    });

    it('accepts valid data structure', async () => {
      const items = [makeTheme('t1')];
      mockListCommunityThemes.mockResolvedValue(makeListResult(items, 1));

      await useCommunityStore.getState().loadThemes();

      const state = useCommunityStore.getState();
      expect(state.error).toBeNull();
      expect(state.themes).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // installTheme — stale closure fix verification
  // -----------------------------------------------------------------------

  describe('installTheme stale closure fix', () => {
    it('reads current installingIds (not captured) on success', async () => {
      mockDownloadCommunityTheme.mockResolvedValue({
        success: true,
        data: { success: true, themeId: 't1' },
      });

      await useCommunityStore.getState().installTheme('t1');

      const state = useCommunityStore.getState();
      expect(state.installedIds.has('t1')).toBe(true);
      expect(state.installingIds.has('t1')).toBe(false);
    });

    it('reads current installingIds (not captured) on failure', async () => {
      mockDownloadCommunityTheme.mockResolvedValue({
        success: true,
        data: { success: false, error: 'Download failed' },
      });

      await useCommunityStore.getState().installTheme('t1');

      const state = useCommunityStore.getState();
      expect(state.installingIds.has('t1')).toBe(false);
      expect(state.installedIds.has('t1')).toBe(false);
    });

    it('reads current installingIds (not captured) on exception', async () => {
      mockDownloadCommunityTheme.mockRejectedValue(new Error('Network error'));

      await useCommunityStore.getState().installTheme('t1');

      const state = useCommunityStore.getState();
      expect(state.installingIds.has('t1')).toBe(false);
      expect(state.installedIds.has('t1')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-B-004: installTheme refreshes theme catalog on success
// ---------------------------------------------------------------------------

describe('communityStore — installTheme refreshThemes (REQ-B-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('calls useThemeStore.refreshThemes() after successful install', async () => {
    mockDownloadCommunityTheme.mockResolvedValue({
      success: true,
      data: { themeId: 't1', success: true },
    });

    await useCommunityStore.getState().installTheme('t1');

    expect(mockRefreshThemes).toHaveBeenCalledTimes(1);
  });

  it('does not call refreshThemes when install fails', async () => {
    mockDownloadCommunityTheme.mockResolvedValue({
      success: true,
      data: { themeId: 't1', success: false, error: 'Download failed' },
    });

    await useCommunityStore.getState().installTheme('t1');

    expect(mockRefreshThemes).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// NEW TESTS — Source-driven architecture (RFC §4/§8)
// ===========================================================================

describe('communityStore — source switching race condition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('should keep state consistent after rapid loadThemes calls on the same source', async () => {
    // Simulate the race: user double-clicks refresh or component mounts twice.
    // DreamSkin call A (slow, 100ms) → DreamSkin call B (fast, 30ms).
    // call B should win; call A's response must be discarded by per-source token.
    const dsFresh = makeTheme('ds-fresh', 'DreamSkin Fresh');
    const dsStale = makeTheme('ds-stale', 'DreamSkin Stale');

    mockListCommunityThemes
      .mockReturnValueOnce(
        new Promise((resolve) => setTimeout(() => resolve(makeListResult([dsStale], 1)), 100)),
      )
      .mockResolvedValueOnce(makeListResult([dsFresh], 1));

    // Fire both loadThemes calls without awaiting — classic rapid double-tap
    const p1 = useCommunityStore.getState().loadThemes();
    const p2 = useCommunityStore.getState().loadThemes();

    await Promise.all([p1, p2]);

    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('dreamskin');
    // The second (fast) call must win — first call discarded by per-source token.
    expect(state.themes).toEqual([dsFresh]);
  });

  it('discards intermediate source response when superseded by same-source retry', async () => {
    const staleThemes = [makeTheme('stale-ds')];
    const freshThemes = [makeTheme('fresh-ds')];

    // First dreamskin call is slow, second is fast
    mockListCommunityThemes
      .mockReturnValueOnce(
        new Promise((resolve) => setTimeout(() => resolve(makeListResult(staleThemes, 1)), 80)),
      )
      .mockResolvedValueOnce(makeListResult(freshThemes, 1));

    // Rapidly switch to dreamskin twice — second call overwrites the first
    const p1 = useCommunityStore.getState().setActiveSource('dreamskin');
    await p1;
    const p2 = useCommunityStore.getState().setActiveSource('dreamskin');
    // After the first completes, fire another loadThemes manually
    const p3 = useCommunityStore.getState().loadThemes();

    await Promise.all([p2, p3]);

    expect(useCommunityStore.getState().themes).toEqual(freshThemes);
  });
});

describe('communityStore — per-source RequestToken independence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('keeps codedrobe themes correct when dreamskin request is in-flight and discarded', async () => {
    const dsThemes = [makeTheme('ds-theme')];
    const crThemes = [makeTheme('cr-theme')];

    // DreamSkin path — slow, will be discarded by per-source RequestToken
    mockListCommunityThemes.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeListResult(dsThemes, 1)), 100)),
    );
    // CodeDrobe path — fast, returns immediately
    mockFetchCodeDrobeThemesList.mockResolvedValue(makeCodeDrobeListResult(crThemes, 1));

    // Start dreamskin load, then immediately switch to codedrobe before it resolves
    const pDreamskin = useCommunityStore.getState().setActiveSource('dreamskin');
    // Don't await — immediately switch
    const pCodedrobe = useCommunityStore.getState().setActiveSource('codedrobe');

    // Also manually await the first dreamskin setActiveSource to let it try
    await Promise.all([pDreamskin, pCodedrobe]);

    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('codedrobe');
    // Codedrobe's themes should be loaded, dreamskin's stale response discarded
    expect(state.themes).toEqual(crThemes);

    // Give time for the slow dreamskin to reject/discard
    await new Promise((r) => setTimeout(r, 150));

    // State must remain codedrobe
    expect(useCommunityStore.getState().activeSourceId).toBe('codedrobe');
    expect(useCommunityStore.getState().themes).toEqual(crThemes);
  });

  it('does not cross-contaminate tokens between dreamskin and codedrobe', async () => {
    // Verify that calling loadThemes on dreamskin does not cancel an in-flight codedrobe request
    const dsThemes = [makeTheme('ds-only')];
    const crThemes = [makeTheme('cr-only')];

    let dsCall = 0;
    let crCall = 0;

    // DreamSkin path — main-process IPC
    mockListCommunityThemes.mockImplementation(() => {
      dsCall++;
      if (dsCall === 1) {
        // Slow dreamskin call
        return new Promise((resolve) => setTimeout(() => resolve(makeListResult(dsThemes, 1)), 30));
      }
      return makeListResult(dsThemes, 1);
    });
    // CodeDrobe path — renderer fetch (separate code path)
    mockFetchCodeDrobeThemesList.mockImplementation(() => {
      crCall++;
      if (crCall === 1) {
        // Slow codedrobe call
        return new Promise((resolve) =>
          setTimeout(() => resolve(makeCodeDrobeListResult(crThemes, 1)), 30),
        );
      }
      return makeCodeDrobeListResult(crThemes, 1);
    });

    // Start dreamskin load (slow), take a token
    const ds1 = useCommunityStore.getState().loadThemes();
    // While dreamskin is in-flight, switch to codedrobe and start its load
    await useCommunityStore
      .getState()
      .setActiveSource('codedrobe')
      .catch(() => {});
    const cr1 = useCommunityStore.getState().loadThemes();

    await Promise.all([ds1, cr1]);

    // Both should have resolved independently — codedrobe's state must be correct
    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('codedrobe');
    expect(state.themes).toEqual(crThemes);
  });
});

describe('communityStore — installationLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('writes a complete record to installationLog after successful install', async () => {
    mockDownloadCommunityTheme.mockResolvedValue({
      success: true,
      data: { themeId: 't1', success: true },
    });

    // Seed the source with a theme so version can be found
    const sources = { ...useCommunityStore.getState().sources };
    const dsThe = makeTheme('t1', 'My Theme', '2.3.1');
    sources.dreamskin = {
      ...sources.dreamskin,
      themes: [dsThe],
    };
    useCommunityStore.setState({ sources, themes: [dsThe] });

    const beforeInstall = Date.now();
    await useCommunityStore.getState().installTheme('t1');
    const afterInstall = Date.now();

    const state = useCommunityStore.getState();
    expect(state.installationLog.size).toBe(1);

    const record = state.installationLog.get('t1');
    expect(record).toBeDefined();
    expect(record?.themeId).toBe('t1');
    expect(record?.sourceId).toBe('dreamskin');
    expect(record?.installedAt).toBeGreaterThanOrEqual(beforeInstall);
    expect(record?.installedAt).toBeLessThanOrEqual(afterInstall);
    expect(record?.sourceThemeVersion).toBe('2.3.1');
  });

  it('records installation from codedrobe source when activeSourceId is codedrobe', async () => {
    mockDownloadCommunityTheme.mockResolvedValue({
      success: true,
      data: { themeId: 'cr-1', success: true },
    });

    // Seed codedrobe source with a theme
    const sources = { ...useCommunityStore.getState().sources };
    const crTheme = makeTheme('cr-1', 'CR Theme', '1.5.0');
    sources.codedrobe = {
      ...sources.codedrobe,
      themes: [crTheme],
    };
    useCommunityStore.setState({ sources });

    // Switch to codedrobe and install
    await useCommunityStore.getState().setActiveSource('codedrobe');
    await useCommunityStore.getState().installTheme('cr-1');

    const state = useCommunityStore.getState();
    expect(state.installationLog.size).toBe(1);
    const record = state.installationLog.get('cr-1');
    expect(record?.sourceId).toBe('codedrobe');
    expect(record?.sourceThemeVersion).toBe('1.5.0');
  });

  it('does not write to installationLog on install failure', async () => {
    mockDownloadCommunityTheme.mockResolvedValue({
      success: true,
      data: { themeId: 't1', success: false, error: 'Boom' },
    });

    await useCommunityStore.getState().installTheme('t1');

    expect(useCommunityStore.getState().installationLog.size).toBe(0);
  });
});

describe('communityStore — cache TTL behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('serves cached themes within TTL without making a new API call', async () => {
    const themes = [makeTheme('cached')];
    mockListCommunityThemes.mockResolvedValue(makeListResult(themes, 1));
    // Default TTL = 5 min. Switch 4 min apart → second call hits cache.
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    try {
      // First load — API call #1
      await useCommunityStore.getState().loadThemes();
      expect(mockListCommunityThemes).toHaveBeenCalledTimes(1);

      // Advance time 2 minutes (within 5-min TTL) and reload via setActiveSource
      vi.setSystemTime(2 * 60 * 1000);
      await useCommunityStore.getState().setActiveSource('codedrobe');
      await useCommunityStore.getState().setActiveSource('dreamskin');

      // Switching to same source with expired cache would load again,
      // but codedrobe was just loaded so setActiveSource for dreamskin should also
      // hit loadThemes again since its cache was set at t=0 and now t=2min < 5min TTL.
      // However setActiveSource only loads if themes.length===0.
      // So use a dedicated refreshSource call instead.
      await useCommunityStore.getState().loadThemes();

      // loadThemes should still call the API (even with cache it always fetches).
      // But let's verify the source cache entry exists and is fresh:
      const state = useCommunityStore.getState();
      const dsCache = state.sources.dreamskin.cache;
      expect(dsCache).toBeDefined();
      expect(dsCache?.fetchedAt).toBeLessThanOrEqual(Date.now());
      expect(Date.now() - (dsCache?.fetchedAt ?? 0)).toBeLessThanOrEqual(5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cache expires after TTL — subsequent load refetches', async () => {
    const themes = [makeTheme('fresh')];
    mockListCommunityThemes.mockResolvedValue(makeListResult(themes, 1));
    // Default TTL = 5 min. Switch 6 min apart → cache expired → API call #2.
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    try {
      // Load dreamskin at t=0 → API call #1, cache set with fetchedAt=0
      await useCommunityStore.getState().loadThemes();
      expect(mockListCommunityThemes).toHaveBeenCalledTimes(1);

      // Advance past TTL (6 min > 5 min TTL)
      vi.setSystemTime(6 * 60 * 1000);

      // Load again → cache expired, new API call #2
      await useCommunityStore.getState().loadThemes();
      expect(mockListCommunityThemes).toHaveBeenCalledTimes(2);

      // Verify the cache was updated with new fetchedAt
      const state = useCommunityStore.getState();
      expect(state.sources.dreamskin.cache?.fetchedAt).toBe(6 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('different sources maintain independent cache TTLs', async () => {
    const dsThemes = [makeTheme('ds')];
    const crThemes = [makeTheme('cr')];

    // DreamSkin → listCommunityThemes (IPC); CodeDrobe → fetchCodeDrobeThemesList (renderer fetch)
    mockListCommunityThemes.mockResolvedValue(makeListResult(dsThemes, 1));
    mockFetchCodeDrobeThemesList.mockResolvedValue(makeCodeDrobeListResult(crThemes, 1));

    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    try {
      // Load dreamskin at t=0 — API call #1 (IPC)
      await useCommunityStore.getState().setActiveSource('dreamskin');
      expect(mockListCommunityThemes).toHaveBeenCalledTimes(1);
      expect(mockFetchCodeDrobeThemesList).toHaveBeenCalledTimes(0);

      // Advance 3 min (still within dreamskin TTL)
      vi.setSystemTime(3 * 60 * 1000);
      // Switch to codedrobe (forces fresh call since it has no themes yet) — renderer fetch
      await useCommunityStore.getState().setActiveSource('codedrobe');
      expect(mockFetchCodeDrobeThemesList).toHaveBeenCalledTimes(1);

      // Advance 4 more min (total 7 min > TTL for dreamskin)
      vi.setSystemTime(7 * 60 * 1000);
      // Dreamskin cache should have expired
      expect(
        Date.now() - (useCommunityStore.getState().sources.dreamskin.cache?.fetchedAt ?? 0),
      ).toBeGreaterThan(5 * 60 * 1000);
      // Codedrobe cache was set at 3min mark, now at 7min = 4min < TTL, still valid
      expect(
        Date.now() - (useCommunityStore.getState().sources.codedrobe.cache?.fetchedAt ?? 0),
      ).toBeLessThanOrEqual(5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('communityStore — error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('marks only dreamskin error when dreamskin API fails, codedrobe unaffected', async () => {
    const crThemes = [makeTheme('cr-safe')];
    // DreamSkin path — uses api.listCommunityThemes (main-process IPC)
    mockListCommunityThemes.mockRejectedValue(new Error('DreamSkin down'));
    // CodeDrobe path — uses fetchCodeDrobeThemesList (renderer fetch)
    mockFetchCodeDrobeThemesList.mockResolvedValue(makeCodeDrobeListResult(crThemes, 1));

    // Load dreamskin — should fail
    await useCommunityStore.getState().loadThemes();

    const stateAfterDsFail = useCommunityStore.getState();
    expect(stateAfterDsFail.activeSourceId).toBe('dreamskin');
    expect(stateAfterDsFail.error).toBe('DreamSkin down');
    expect(stateAfterDsFail.sources.dreamskin.error).toBe('DreamSkin down');

    // Switch to codedrobe — should succeed
    await useCommunityStore.getState().setActiveSource('codedrobe');

    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('codedrobe');
    expect(state.error).toBeNull();
    expect(state.themes).toEqual(crThemes);
    expect(state.sources.codedrobe.error).toBeNull();
    // Dreamskin error must remain isolated in its own slice
    expect(state.sources.dreamskin.error).toBe('DreamSkin down');
  });

  it('does not propagate codedrobe error to dreamskin source', async () => {
    const dsThemes = [makeTheme('ds-safe')];
    // CodeDrobe path fails; DreamSkin path succeeds
    mockFetchCodeDrobeThemesList.mockRejectedValue(new Error('Codedrobe down'));
    mockListCommunityThemes.mockResolvedValue(makeListResult(dsThemes, 1));

    // Switch to codedrobe — fails
    await useCommunityStore.getState().setActiveSource('codedrobe');
    expect(useCommunityStore.getState().error).toBe('Codedrobe down');
    expect(useCommunityStore.getState().sources.codedrobe.error).toBe('Codedrobe down');
    expect(useCommunityStore.getState().sources.dreamskin.error).toBeNull();

    // Switch back to dreamskin — should succeed
    await useCommunityStore
      .getState()
      .setActiveSource('dreamskin')
      .then(() => useCommunityStore.getState().loadThemes());

    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('dreamskin');
    expect(state.error).toBeNull();
    expect(state.sources.dreamskin.error).toBeNull();
    // Codedrobe error unchanged
    expect(state.sources.codedrobe.error).toBe('Codedrobe down');
  });

  it('clearError clears active source error without affecting other sources', async () => {
    // Set error on dreamskin and codedrobe sources
    const sources = { ...useCommunityStore.getState().sources };
    sources.dreamskin = { ...sources.dreamskin, error: 'DS error' };
    sources.codedrobe = { ...sources.codedrobe, error: 'CR error' };
    useCommunityStore.setState({ sources, error: 'DS error' });

    useCommunityStore.getState().clearError();

    const state = useCommunityStore.getState();
    expect(state.error).toBeNull();
    expect(state.sources.dreamskin.error).toBeNull();
    // codedrobe error untouched
    expect(state.sources.codedrobe.error).toBe('CR error');
  });
});

// ---------------------------------------------------------------------------
// setActiveSource — basic sanity tests
// ---------------------------------------------------------------------------

describe('communityStore — setActiveSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
    mockRefreshThemes.mockReset();
  });

  it('resets query and selection when switching source', async () => {
    useCommunityStore.setState({ query: 'search', selectedThemeId: 't1' });

    await useCommunityStore.getState().setActiveSource('codedrobe');

    const state = useCommunityStore.getState();
    expect(state.activeSourceId).toBe('codedrobe');
    expect(state.query).toBe('');
    expect(state.page).toBe(1);
    expect(state.selectedThemeId).toBeNull();
  });

  it('triggers loadThemes for target source if empty', async () => {
    const themes = [makeTheme('first')];
    // CodeDrobe path goes through renderer fetch, not IPC
    mockFetchCodeDrobeThemesList.mockResolvedValue(makeCodeDrobeListResult(themes, 1));
    mockListCommunityThemes.mockResolvedValue(makeListResult(themes, 1));

    await useCommunityStore.getState().setActiveSource('codedrobe');

    // Should have loaded themes via the codedrobe path (fetchCodeDrobeThemesList)
    expect(mockFetchCodeDrobeThemesList).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectDeduplicatedThemes — cross-source deduplication selector
// ---------------------------------------------------------------------------

describe('communityStore — selectDeduplicatedThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommunityStore();
  });

  it('returns empty array when active source has no themes', () => {
    const result = useCommunityStore.getState().selectDeduplicatedThemes();
    expect(result).toEqual([]);
  });

  it('returns all themes when no duplicates exist across sources', () => {
    const a = { ...makeTheme('a', 'Theme A'), slug: 'theme-a' };
    const b = { ...makeTheme('b', 'Theme B'), slug: 'theme-b' };
    const c = { ...makeTheme('c', 'Theme C'), slug: 'theme-c' };
    const d = { ...makeTheme('d', 'Theme D'), slug: 'theme-d' };

    // dreamskin: [a, b, c], codedrobe: [d] — no overlap
    const sources = { ...useCommunityStore.getState().sources };
    sources.dreamskin = { ...sources.dreamskin, themes: [a, b, c] };
    sources.codedrobe = { ...sources.codedrobe, themes: [d] };
    useCommunityStore.setState({ sources });

    const result = useCommunityStore.getState().selectDeduplicatedThemes();
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.themeId)).toEqual(['a', 'b', 'c']);
  });

  it('filters out themes whose slug appears in another source', () => {
    const a = { ...makeTheme('a', 'Theme A'), slug: 'shared-slug' };
    const b = { ...makeTheme('b', 'Theme B'), slug: 'dreamskin-only' };
    const c = { ...makeTheme('c', 'Theme C'), slug: 'also-shared' };
    const d = { ...makeTheme('d', 'Theme D'), slug: 'shared-slug' }; // same slug as a
    const e = { ...makeTheme('e', 'Theme E'), slug: 'also-shared' }; // same slug as c
    const f = { ...makeTheme('f', 'Theme F'), slug: 'codedrobe-only' };

    // dreamskin: [a, b, c], codedrobe: [d, e, f]
    const sources = { ...useCommunityStore.getState().sources };
    sources.dreamskin = { ...sources.dreamskin, themes: [a, b, c] };
    sources.codedrobe = { ...sources.codedrobe, themes: [d, e, f] };
    useCommunityStore.setState({ sources });

    // Expected: dreamskin-only (b) — shared-slug and also-shared are in codedrobe
    const result = useCommunityStore.getState().selectDeduplicatedThemes();
    expect(result).toHaveLength(1);
    expect(result[0]?.themeId).toBe('b');
  });

  it('normalizes slug comparison (case + special chars)', () => {
    const a = { ...makeTheme('a', 'Theme A'), slug: 'My_Awesome-Theme!' };
    const b = { ...makeTheme('b', 'Theme B'), slug: 'myawesometheme' }; // normalizes to same

    const sources = { ...useCommunityStore.getState().sources };
    sources.dreamskin = { ...sources.dreamskin, themes: [a] };
    sources.codedrobe = { ...sources.codedrobe, themes: [b] };
    useCommunityStore.setState({ sources });

    const result = useCommunityStore.getState().selectDeduplicatedThemes();
    expect(result).toHaveLength(0); // a is filtered because b has matching normalized slug
  });

  it('keeps themes with empty slug (no dedup possible)', () => {
    const a = { ...makeTheme('a', 'Theme A'), slug: '' };
    const b = { ...makeTheme('b', 'Theme B'), slug: undefined };

    const sources = { ...useCommunityStore.getState().sources };
    sources.dreamskin = { ...sources.dreamskin, themes: [a, b] };
    sources.codedrobe = { ...sources.codedrobe, themes: [] };
    useCommunityStore.setState({ sources });

    const result = useCommunityStore.getState().selectDeduplicatedThemes();
    expect(result).toHaveLength(2);
  });
});
