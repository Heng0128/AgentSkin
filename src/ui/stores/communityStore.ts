// SPDX-License-Identifier: MPL-2.0

/**
 * # communityStore
 *
 * Source-driven community theme store — browse tabs, download progress,
 * install lifecycle, and cancellation across multiple community providers.
 *
 * Each community source (dreamskin, codedrobe, …) owns an isolated state slice
 * in `sources[sourceId]`. The `activeSourceId` field selects which slice the
 * flat-field mirroring targets, preserving full backward compatibility with
 * existing selectors while enabling independent per-source state (themes,
 * loading, installingIds, RequestToken) and cross-source isolation.
 *
 * ## Source abstraction
 *
 * 1. `sources: Record<CommunitySourceId, CommunitySourceState>` holds the
 *    authorized-of-truth slice per source — themes, pagination, install
 *    tracking, retry counts, and per-source cache entries live here.
 * 2. `activeSourceId` defaults to `'dreamskin'`; all unscoped actions
 *    (loadThemes, loadMore, installTheme, …) operate on the active source.
 * 3. Flat fields at the CommunityState root (`themes`, `total`, `loading`,
 *    …) mirror the active source so existing components / selectors continue
 *    working unchanged.
 *
 * ## Cross-store cache consistency (RFC §7.4)
 *
 * On successful install, we:
 *   a. Mark the theme installed in the active source slice.
 *   b. Append an `InstallationRecord` to `installationLog`.
 *   c. Stale the active source's list cache so the next render refreshes it.
 *   d. Ask `themeStore.refreshThemes()` to resync the installed catalog.
 *
 * ## IPC events wired at module init
 *
 * The store subscribes to `onCommunityDownloadProgress` once at module load so
 * download progress events are captured perma — not per-component-mount.
 */

import { api } from '@/api/agentSkinClient';
import { fetchCodeDrobeThemeDetail, fetchCodeDrobeThemesList } from '@/api/community-direct-api';
import { useNotificationStore } from '@/stores/notificationStore';
import { useThemeStore } from '@/stores/themeStore';

import type {
  CommunitySourceId,
  CommunitySourceState,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  CommunityThemeSummary,
  DownloadProgress,
  InstallationRecord,
  InstallResult,
  SourceStatus,
} from '@shared/types/community';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// RequestToken — per-source race-condition guard
// ---------------------------------------------------------------------------

/**
 * ## RequestToken
 *
 * Owns the monotonic request token used by `loadThemes` and `loadMore` to
 * discard stale responses. Each source gets its own instance so that an
 * in-flight request from dreamskin does not invalidate codedrobe calls
 * (and vice-versa) — see RFC §8 R6.
 */
class RequestToken {
  private token = 0;

  /** Get the next token value (increments the counter). */
  next(): number {
    return ++this.token;
  }

  /** Current token value (without incrementing). */
  get current(): number {
    return this.token;
  }

  /** Reset the token counter — for test isolation. */
  reset(): void {
    this.token = 0;
  }
}

/**
 * Registry of per-source RequestToken instances.
 * Lazily allocates a new token the first time a source is referenced.
 */
const requestTokens = new Map<CommunitySourceId, RequestToken>();

/** Retrieve (or lazily create) the RequestToken for a given source. */
function getRequestToken(sourceId: CommunitySourceId): RequestToken {
  let token = requestTokens.get(sourceId);
  if (!token) {
    token = new RequestToken();
    requestTokens.set(sourceId, token);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * RC-7: Maximum number of entries in the retryCount Map.
 * Without a bound, the Map grows by one entry for every failed install attempt
 * across the app's lifetime — a slow memory leak. When capacity is exceeded,
 * the oldest entry (Map preserves insertion order) is evicted.
 */
const MAX_RETRY_COUNT_ENTRIES = 50;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * RC-7: Set a retry count entry with LRU eviction.
 * If the map is at capacity and the key is new, the oldest entry is removed
 * before the new one is inserted.
 */
function setRetryCountWithCapacity(
  current: Map<string, number>,
  themeId: string,
  count: number,
): Map<string, number> {
  const next = new Map(current);
  // If key already exists, just update — no capacity change.
  if (next.has(themeId)) {
    next.set(themeId, count);
    return next;
  }
  // At capacity — evict the oldest entry (first inserted).
  if (next.size >= MAX_RETRY_COUNT_ENTRIES) {
    const oldestKey = next.keys().next().value;
    if (oldestKey !== undefined) next.delete(oldestKey);
  }
  next.set(themeId, count);
  return next;
}

// ---------------------------------------------------------------------------
// Source status state machine (RFC §9.3 / health-probe)
// ---------------------------------------------------------------------------

/**
 * Rolling history limit for probe results per source.
 * Matches health-probe.inferSourceStatus tolerance: 2 consecutive failures → degraded,
 * 5 consecutive failures → offline.
 */
const STATUS_HISTORY_LIMIT = 5;

/**
 * Apply a probe result to a source's rolling health history and compute the new
 * SourceStatus using the same state-transition rules as health-probe.inferSourceStatus.
 *
 * Transition rules:
 * - Any successful probe → online
 * - 2+ consecutive failures → degraded
 * - 5+ consecutive failures → offline
 *
 * Returns a partial CommunityState with updated `sources` and `statusHistory`.
 * Pure function — no side effects, no store mutation.
 */
function _updateSourceStatusImpl(
  state: CommunityState,
  sourceId: CommunitySourceId,
  healthy: boolean,
): Partial<CommunityState> {
  const history = new Map(state.statusHistory);
  const sourceHistory = [...(history.get(sourceId) ?? []), healthy].slice(-STATUS_HISTORY_LIMIT);
  history.set(sourceId, sourceHistory);

  // State transition: any success → online; 2+ consecutive failures → degraded; 5+ → offline.
  let newStatus: SourceStatus = 'online';
  if (!healthy) {
    let consecutiveFailures = 0;
    for (let i = sourceHistory.length - 1; i >= 0; i--) {
      if (!sourceHistory[i]) consecutiveFailures++;
      else break;
    }
    if (consecutiveFailures >= 5) newStatus = 'offline';
    else if (consecutiveFailures >= 2) newStatus = 'degraded';
  }

  const sources = { ...state.sources };
  sources[sourceId] = { ...sources[sourceId], status: newStatus };

  return { sources, statusHistory: history };
}

// ---------------------------------------------------------------------------
// Cache TTL defaults (RFC §7.3)
// ---------------------------------------------------------------------------

/** Theme list cache: 5 minutes. */
const CACHE_TTL_LIST = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Runtime type guards — validate external data before use
// ---------------------------------------------------------------------------

/**
 * Runtime validation for CommunityThemeListResult.
 * Prevents malformed API responses from corrupting store state.
 */
function isCommunityThemeListResult(value: unknown): value is CommunityThemeListResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.themes) && typeof v.total === 'number';
}

// ---------------------------------------------------------------------------
// Data sanitization — defend against incomplete API responses
// ---------------------------------------------------------------------------

/**
 * Ensure a theme summary always has a valid `author` object.
 * API may return themes with missing/null author (deleted accounts, edge data).
 *
 * Defensive rules:
 * - `author`: null-replace with 'unknown' placeholder (numeric/rating checks must
 *   preserve valid 0/NaN values, so we use `!== null && !== undefined` only).
 * - `rating`/`downloads`: only fall back to 0 when the value is nullish — 0 is a
 *   valid score/count and must not be overwritten.
 * - `name`/`description`: empty string is invalid → replaced with fallback (uses
 *   `||` not `??` so empty strings are caught).
 * - `tags`: nullish → empty array (empty array itself is valid).
 */
function sanitizeTheme<T extends CommunityThemeSummary>(theme: T): T {
  const needsAuthor = theme.author == null;
  const needsRating = theme.rating == null;
  const needsDownloads = theme.downloads == null;
  const needsTags = theme.tags == null;
  const needsName = !theme.name;
  const needsDescription = !theme.description;

  if (
    !needsAuthor &&
    !needsRating &&
    !needsDownloads &&
    !needsTags &&
    !needsName &&
    !needsDescription
  )
    return theme;

  return {
    ...theme,
    author: needsAuthor
      ? {
          id: 'unknown',
          displayName: 'Unknown',
        }
      : theme.author,
    rating: needsRating ? 0 : theme.rating,
    downloads: needsDownloads ? 0 : theme.downloads,
    tags: needsTags ? [] : theme.tags,
    name: theme.name || 'Untitled Theme',
    description: theme.description || '',
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommunitySortKey = CommunityThemeListParams['sort'];

/** Convenience helper: build a fresh source slice with default state. */
function createDefaultSourceState(initialStatus: SourceStatus = 'online'): CommunitySourceState {
  return {
    status: initialStatus,
    error: null,
    loading: false,
    loadingMore: false,
    detailLoading: false,
    themes: [],
    total: 0,
    page: 1,
    pageSize: 20,
    sortBy: 'popular',
    query: '',
    installingIds: new Set(),
    installedIds: new Set(),
    downloadProgress: new Map(),
    retryCount: new Map(),
    cache: undefined,
  };
}

interface CommunityState {
  // --- Source-driven state (RFC §4.3) ---
  /** Per-source state slices — the system of record for source data. */
  sources: Record<CommunitySourceId, CommunitySourceState>;
  /** Currently selected source; unscoped actions target this source. */
  activeSourceId: CommunitySourceId;
  /** Installation provenance: themeId → record of where/when it was installed. */
  installationLog: Map<string, InstallationRecord>;
  /** Health probe history per source — recent N probe results (boolean healthy flags). */
  statusHistory: Map<CommunitySourceId, boolean[]>;

  // --- Flat-field mirrors (backward compat — reflect active source) ---
  themes: CommunityThemeSummary[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: NonNullable<CommunitySortKey>;
  query: string;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  selectedThemeId: string | null;
  selectedThemeDetail: CommunityThemeDetail | null;
  detailLoading: boolean;
  downloadProgress: Map<string, DownloadProgress>;
  installingIds: Set<string>;
  installedIds: Set<string>;
  retryCount: Map<string, number>;

  // --- Selectors ---
  /**
   * Compute the cross-source deduplicated theme list for the active source.
   * Returns only themes whose normalized slug does not appear in any other
   * source. Pure derivation — no state mutation.
   */
  selectDeduplicatedThemes: () => CommunityThemeSummary[];

  // --- Actions ---
  loadThemes: (params?: Partial<CommunityThemeListParams>) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setQuery: (query: string) => void;
  setSortBy: (sort: NonNullable<CommunitySortKey>) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  selectTheme: (id: string | null) => void;
  loadThemeDetail: (themeId: string) => Promise<void>;
  installTheme: (themeId: string) => Promise<InstallResult>;
  uninstallTheme: (themeId: string) => Promise<void>;
  cancelInstall: (themeId: string) => Promise<void>;
  markInstalled: (themeId: string) => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  clearError: () => void;
  resetRetryCount: (themeId: string) => void;

  // --- Multi-source actions ---
  /** Switch active source — resets search query and selection. */
  setActiveSource: (sourceId: CommunitySourceId) => Promise<void>;
  /** Read the runtime status of a source. */
  getSourceStatus: (sourceId: CommunitySourceId) => SourceStatus;
  /** Update source health status from a probe result (maintains rolling history + state transition). */
  updateSourceStatus: (sourceId: CommunitySourceId, healthy: boolean) => void;
  /** Force-refresh a source's theme list (default: active). */
  refreshSource: (sourceId?: CommunitySourceId) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCommunityStore = create<CommunityState>((set, get) => {
  // Build the initial dreamskin slice once, then derive flat fields from it.
  const initialDreamskin: CommunitySourceState = createDefaultSourceState();

  /**
   * Helper: set deep-cloned sources record and atomically sync flat mirrors.
   *
   * Performs a SINGLE `set()` that updates both the `sources` slice and all
   * backward-compatible flat fields — no in-place state mutation, which would
   * bypass Zustand v5's reactivity.
   */
  function setSourcesAndSync(
    updater: (
      current: Record<CommunitySourceId, CommunitySourceState>,
    ) => Record<CommunitySourceId, CommunitySourceState>,
  ): void {
    const activeId = get().activeSourceId;
    const next = updater({ ...get().sources });
    const src = next[activeId];
    set({
      sources: next,
      themes: src.themes,
      total: src.total,
      page: src.page,
      pageSize: src.pageSize,
      sortBy: src.sortBy,
      query: src.query,
      loading: src.loading,
      error: src.error,
      downloadProgress: src.downloadProgress,
      installingIds: src.installingIds,
      installedIds: src.installedIds,
      retryCount: src.retryCount,
    });
  }

  // ---------------------------------------------------------------------------
  // Install lifecycle helpers (store-closure: has access to get/setSourcesAndSync)
  // ---------------------------------------------------------------------------

  function isInstallCancelled(activeId: CommunitySourceId, themeId: string): boolean {
    return (
      !get().sources[activeId]?.installingIds.has(themeId) && !get().installingIds.has(themeId)
    );
  }

  function cleanupInstallState(activeId: CommunitySourceId, themeId: string): void {
    const src = get().sources[activeId];
    if (!src) return;
    const installingIds = new Set(src.installingIds);
    installingIds.delete(themeId);
    const downloadProgress = new Map(src.downloadProgress);
    downloadProgress.delete(themeId);
    setSourcesAndSync((srcs) => ({
      ...srcs,
      [activeId]: { ...srcs[activeId], installingIds, downloadProgress },
    }));
  }

  function incrementRetryCount(
    activeId: CommunitySourceId,
    themeId: string,
    attempt: number,
  ): void {
    const src = get().sources[activeId];
    if (!src) return;
    const retryCount = setRetryCountWithCapacity(src.retryCount, themeId, attempt + 1);
    setSourcesAndSync((srcs) => ({
      ...srcs,
      [activeId]: { ...srcs[activeId], retryCount },
    }));
  }

  async function scheduleRetry(
    activeId: CommunitySourceId,
    themeId: string,
    attempt: number,
  ): Promise<boolean> {
    if (attempt >= MAX_RETRIES) return false;
    incrementRetryCount(activeId, themeId, attempt);
    await delay(RETRY_DELAY_MS);
    return true;
  }

  async function finishInstallFailure(
    activeId: CommunitySourceId,
    themeId: string,
    lastError: string,
  ): Promise<InstallResult> {
    // Check cancellation BEFORE cleanup — cancelInstall removes the theme from
    // installingIds, so a missing entry means deliberate cancellation.
    const wasCancelled = isInstallCancelled(activeId, themeId);
    cleanupInstallState(activeId, themeId);
    if (!wasCancelled) {
      useNotificationStore.getState().fail(lastError);
    }
    return { success: false, error: lastError };
  }

  return {
    // --- Initial state: sources ---
    sources: {
      dreamskin: { ...initialDreamskin },
      codedrobe: { ...createDefaultSourceState('online') },
    },
    activeSourceId: 'dreamskin',
    installationLog: new Map(),
    statusHistory: new Map(),

    // --- Initial state: flat mirrors (derived from dreamskin source) ---
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
    retryCount: new Map(),

    // --- Selectors (pure derivations) ---

    /**
     * Cross-source deduplication: keep only themes whose slug is unique to
     * the active source. Slug normalization lowercases and strips non-alphanumeric
     * characters before comparison.
     */
    selectDeduplicatedThemes: () => {
      const activeId = get().activeSourceId;
      const sources = get().sources;
      const activeThemes = sources[activeId]?.themes ?? [];
      if (activeThemes.length === 0) return [];

      // Build a set of normalized slugs from all OTHER sources
      const otherSlugs = new Set<string>();
      for (const [sourceId, src] of Object.entries(sources)) {
        if (sourceId === activeId) continue;
        for (const theme of src.themes) {
          const normalized = theme.slug?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
          if (normalized) otherSlugs.add(normalized);
        }
      }

      return activeThemes.filter((theme) => {
        const normalized = theme.slug?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
        if (!normalized) return true; // keep themes with no slug
        return !otherSlugs.has(normalized);
      });
    },

    // --- Load theme list ---
    loadThemes: async (params) => {
      const activeId = get().activeSourceId;
      const token = getRequestToken(activeId).next();
      set({ loading: true, error: null });
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], loading: true, error: null },
      }));

      try {
        const state = get();
        // CodeDrobe：CORS 已开放，用渲染进程 fetch 直连（主进程 net.fetch 会被 CDN 400）
        // DreamSkin：无 CORS，走主进程 IPC
        let themes: CommunityThemeSummary[];
        let total: number;
        if (activeId === 'codedrobe') {
          const directResult = await fetchCodeDrobeThemesList({
            sort: state.sortBy,
            query: state.query || undefined,
            categoryId: params?.categoryId,
            agentId: params?.agentId,
            fetchAll: true,
          });
          themes = directResult.themes;
          total = directResult.total;
        } else {
          const ipcResult = await api.listCommunityThemes({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sortBy,
            query: state.query || undefined,
            ...params,
          });
          if (ipcResult.success === true && isCommunityThemeListResult(ipcResult.data)) {
            themes = ipcResult.data.themes;
            total = ipcResult.data.total;
          } else if (ipcResult.success === false) {
            throw new Error(ipcResult.error || 'Failed to load community themes');
          } else {
            throw new Error('Failed to load community themes');
          }
        }

        // Discard stale response if a newer request has been issued for this source
        if (token !== getRequestToken(activeId).current) return;

        const sanitizedThemes = themes.map(sanitizeTheme);

        // Update source slice with fresh data + cache entry
        setSourcesAndSync((srcs) => ({
          ...srcs,
          [activeId]: {
            ...srcs[activeId],
            themes: sanitizedThemes,
            total,
            loading: false,
            error: null,
            cache: {
              data: sanitizedThemes,
              fetchedAt: Date.now(),
              ttl: CACHE_TTL_LIST,
            },
          },
        }));
      } catch (error) {
        // Discard stale response
        if (token !== getRequestToken(activeId).current) return;

        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error while loading themes';
        set({ error: errorMsg, loading: false });
        setSourcesAndSync((srcs) => ({
          ...srcs,
          [activeId]: { ...srcs[activeId], loading: false, error: errorMsg },
        }));
      }
    },

    // --- Load more (infinite scroll) ---
    loadMore: async () => {
      const activeId = get().activeSourceId;
      const token = getRequestToken(activeId).next();
      const { page, pageSize, themes, total, sortBy, query, loadingMore } = get();
      if (themes.length >= total || loadingMore) return;

      set({ loadingMore: true });
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], loading: true },
      }));

      try {
        const result = await api.listCommunityThemes({
          page: page + 1,
          pageSize,
          sort: sortBy,
          query: query || undefined,
        });

        // Discard stale response if a newer request has been issued for this source
        if (token !== getRequestToken(activeId).current) return;

        if (result?.success && isCommunityThemeListResult(result.data)) {
          const data = result.data;
          const mergedThemes = [...themes, ...data.themes.map(sanitizeTheme)];

          setSourcesAndSync((srcs) => ({
            ...srcs,
            [activeId]: {
              ...srcs[activeId],
              themes: mergedThemes,
              total: data.total,
              page: page + 1,
              loading: false,
              cache: {
                data: mergedThemes,
                fetchedAt: Date.now(),
                ttl: CACHE_TTL_LIST,
              },
            },
          }));
          set({ loadingMore: false, page: page + 1 });
        } else {
          const errorMsg =
            result?.success === false && result.error ? result.error : 'Failed to load more themes';
          set({ error: errorMsg, loadingMore: false });
          setSourcesAndSync((srcs) => ({
            ...srcs,
            [activeId]: { ...srcs[activeId], loading: false, error: errorMsg },
          }));
        }
      } catch (error) {
        // Discard stale response
        if (token !== getRequestToken(activeId).current) return;

        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error while loading more themes';
        set({ error: errorMsg, loadingMore: false });
        setSourcesAndSync((srcs) => ({
          ...srcs,
          [activeId]: { ...srcs[activeId], loading: false, error: errorMsg },
        }));
      }
    },

    // --- Refresh the current page ---
    refresh: async () => {
      const state = get();
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [state.activeSourceId]: { ...srcs[state.activeSourceId], cache: undefined },
      }));
      await get().loadThemes({
        query: state.query || undefined,
        sort: state.sortBy,
        pageSize: state.pageSize,
        page: state.page,
      });
    },

    // --- Search ---
    setQuery: (query) => {
      const activeId = get().activeSourceId;
      const sources = { ...get().sources };
      sources[activeId] = { ...sources[activeId], query, page: 1 };
      set({ sources, query, page: 1 });
    },

    setSortBy: async (sort) => {
      const activeId = get().activeSourceId;
      const sources = { ...get().sources };
      sources[activeId] = { ...sources[activeId], sortBy: sort, page: 1 };
      const state = get();
      set({ sources, sortBy: sort, page: 1 });
      await get().loadThemes({
        sort,
        query: state.query || undefined,
        page: 1,
        pageSize: state.pageSize,
      });
    },

    setPage: async (page) => {
      const activeId = get().activeSourceId;
      const sources = { ...get().sources };
      sources[activeId] = { ...sources[activeId], page };
      const state = get();
      set({ sources, page });
      await get().loadThemes({
        page,
        query: state.query || undefined,
        sort: state.sortBy,
        pageSize: state.pageSize,
      });
    },

    // --- Selection ---
    selectTheme: (id) => {
      set({ selectedThemeId: id, selectedThemeDetail: null });
    },

    // --- Load theme detail ---
    loadThemeDetail: async (themeId: string) => {
      const activeId = get().activeSourceId;
      set({ detailLoading: true, selectedThemeDetail: null });

      try {
        let detail: CommunityThemeDetail;
        if (activeId === 'codedrobe') {
          detail = await fetchCodeDrobeThemeDetail(themeId);
        } else {
          const result = await api.getCommunityTheme(themeId, activeId);
          if (result.success === true && result.data) {
            detail = sanitizeTheme(result.data);
          } else if (result.success === false) {
            throw new Error(result.error || 'Failed to load theme detail');
          } else {
            throw new Error('Failed to load theme detail');
          }
        }
        set({
          selectedThemeDetail: sanitizeTheme(detail),
          detailLoading: false,
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load detail',
          detailLoading: false,
        });
      }
    },

    // --- Install a community theme ---
    installTheme: async (themeId: string) => {
      const activeId = get().activeSourceId;
      const src = get().sources[activeId];

      // Idempotency: check BOTH source slice and flat mirrors (tests/UI may
      // set flat mirrors directly via setState).
      if (src.installingIds.has(themeId) || get().installingIds.has(themeId)) {
        return { success: false, error: 'Theme is already being installed' };
      }

      // Mark as installing
      const newInstallingIds = new Set(src.installingIds);
      newInstallingIds.add(themeId);
      const newDownloadProgress = new Map(src.downloadProgress);
      newDownloadProgress.set(themeId, {
        themeId,
        phase: 'downloading',
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
      });

      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: {
          ...srcs[activeId],
          installingIds: new Set(newInstallingIds),
          downloadProgress: new Map(newDownloadProgress),
        },
      }));

      let lastError = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // Check if cancelled before each attempt (checks source + flat mirrors)
        if (isInstallCancelled(activeId, themeId)) {
          return { success: false, error: 'Installation cancelled' };
        }

        try {
          const result = await api.downloadCommunityTheme(themeId, activeId);

          // Multi-layer null defense: guard against malformed API responses
          // where result or result.data may be null/undefined
          if (!result || typeof result !== 'object') {
            lastError = 'Installation failed: Invalid response from server';
            if (await scheduleRetry(activeId, themeId, attempt)) continue;
            return finishInstallFailure(activeId, themeId, lastError);
          }

          if (result.success && result.data?.success) {
            // Mark as installed on success
            const cur = get().sources[activeId];
            if (!cur) {
              return { success: false, error: 'Source no longer exists' };
            }
            const newInstalledIds = new Set(cur.installedIds);
            newInstalledIds.add(themeId);
            const stillInstalling = new Set(cur.installingIds);
            stillInstalling.delete(themeId);
            const progress = new Map(cur.downloadProgress);
            progress.delete(themeId);
            const newRetryCount = new Map(cur.retryCount);
            newRetryCount.delete(themeId);

            setSourcesAndSync((srcs) => ({
              ...srcs,
              [activeId]: {
                ...srcs[activeId],
                installedIds: newInstalledIds,
                installingIds: stillInstalling,
                downloadProgress: progress,
                retryCount: newRetryCount,
              },
            }));

            // Record installation provenance (RFC §4.8/§7.4)
            const theme = get().sources[activeId].themes.find((t) => t.themeId === themeId);
            const newLog = new Map(get().installationLog);
            newLog.set(themeId, {
              themeId,
              sourceId: activeId,
              installedAt: Date.now(),
              sourceThemeVersion: theme?.version || 'unknown',
            });
            set({ installationLog: newLog });

            // Stale the active-source list cache (RFC §7.4)
            const staleSources = { ...get().sources };
            const staleSrc = { ...staleSources[activeId] };
            if (staleSrc.cache) {
              staleSources[activeId] = {
                ...staleSrc,
                cache: { ...staleSrc.cache, fetchedAt: 0 },
              };
            } else {
              staleSources[activeId] = staleSrc;
            }
            set({ sources: staleSources });

            // Refresh the installed-themes catalog (existing behavior)
            void useThemeStore.getState().refreshThemes();

            // Notify other parts of the app
            useNotificationStore
              .getState()
              .showToast(
                result.data.themeId
                  ? `Theme "${themeId}" installed successfully`
                  : 'Theme installed successfully',
              );

            return result.data;
          } else {
            // API returned failure — extract error and decide whether to retry
            lastError = result.data?.error || 'Installation failed';
            if (await scheduleRetry(activeId, themeId, attempt)) continue;
            return finishInstallFailure(activeId, themeId, lastError);
          }
        } catch (error) {
          // Exception — decide whether to retry
          lastError = error instanceof Error ? error.message : 'Unknown error during installation';
          if (await scheduleRetry(activeId, themeId, attempt)) continue;
          return finishInstallFailure(activeId, themeId, lastError);
        }
      }

      // Fallback (should not reach here)
      return { success: false, error: 'Installation failed after retries' };
    },

    // --- Uninstall a community theme ---
    uninstallTheme: async (themeId: string) => {
      const activeId = get().activeSourceId;
      const src = get().sources[activeId];
      const newInstalledIds = new Set(src.installedIds);
      newInstalledIds.delete(themeId);
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], installedIds: newInstalledIds },
      }));
    },

    // --- Cancel an in-progress download ---
    cancelInstall: async (themeId: string) => {
      const activeId = get().activeSourceId;

      // IPC cancel — wrapped in try-catch so a failed cancel IPC
      // (e.g. main process restart) does not crash the UI.
      try {
        await api.cancelCommunityDownload(themeId);
      } catch (error) {
        useNotificationStore.getState().fail(error);
      }

      // Remove from installing regardless of IPC result so the UI
      // always reflects the cancelled state.
      const src = get().sources[activeId];
      const newInstalling = new Set(src.installingIds);
      newInstalling.delete(themeId);
      const newProgress = new Map(src.downloadProgress);
      newProgress.delete(themeId);

      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: {
          ...srcs[activeId],
          installingIds: newInstalling,
          downloadProgress: newProgress,
        },
      }));
    },

    // --- Mark as installed (external trigger, e.g. re-scan) ---
    markInstalled: (themeId: string) => {
      const activeId = get().activeSourceId;
      const src = get().sources[activeId];
      const newInstalledIds = new Set(src.installedIds);
      newInstalledIds.add(themeId);
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], installedIds: newInstalledIds },
      }));
    },

    // --- Update download progress (called by IPC subscription) ---
    updateDownloadProgress: (progress) => {
      const activeId = get().activeSourceId;
      const src = get().sources[activeId];
      const downloadProgress = new Map(src.downloadProgress);
      downloadProgress.set(progress.themeId, progress);
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], downloadProgress },
      }));
    },

    // --- Clear errors ---
    clearError: () => {
      set({ error: null });
      const activeId = get().activeSourceId;
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], error: null },
      }));
    },

    // --- Reset retry count for a theme (e.g. on manual retry) ---
    resetRetryCount: (themeId: string) => {
      const activeId = get().activeSourceId;
      const src = get().sources[activeId];
      const retryCount = new Map(src.retryCount);
      retryCount.delete(themeId);
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [activeId]: { ...srcs[activeId], retryCount },
      }));
    },

    // --- Multi-source actions ---

    // Switch active source — resets search and theme selection
    setActiveSource: async (sourceId) => {
      // Defensive guard: reject invalid source IDs (e.g. malformed sub-routes)
      // to prevent undefined access from crashing the page render.
      if (!get().sources[sourceId]) {
        console.warn(`[communityStore] setActiveSource: unknown sourceId "${sourceId}"`);
        return;
      }

      const sources = { ...get().sources };
      const targetSrc = { ...sources[sourceId], query: '', page: 1 };
      sources[sourceId] = targetSrc;
      const state = get();
      set({
        sources,
        activeSourceId: sourceId,
        selectedThemeId: null,
        selectedThemeDetail: null,
        // Sync flat fields from the new active source
        themes: targetSrc.themes,
        total: targetSrc.total,
        page: targetSrc.page,
        pageSize: targetSrc.pageSize,
        sortBy: targetSrc.sortBy,
        query: targetSrc.query,
        loading: targetSrc.loading,
        error: targetSrc.error,
        downloadProgress: targetSrc.downloadProgress,
        installingIds: targetSrc.installingIds,
        installedIds: targetSrc.installedIds,
        retryCount: targetSrc.retryCount,
        loadingMore: state.loadingMore,
        detailLoading: state.detailLoading,
      });

      // Load themes for the new source if it has no data yet.
      // Always trigger load when themes are empty — the per-source
      // RequestToken handles race-condition staleness (RFC §8 R6).
      const freshTargetSrc = get().sources[sourceId];
      if (freshTargetSrc.themes.length === 0) {
        await get().loadThemes();
      }
    },

    // Read the runtime status of a source
    getSourceStatus: (sourceId) => {
      return get().sources[sourceId]?.status ?? 'offline';
    },

    // Update source health from a probe result — maintains rolling history + state transition
    updateSourceStatus: (sourceId, healthy) => {
      const currentState = get();
      const patch = _updateSourceStatusImpl(currentState, sourceId, healthy);
      // Sync flat mirrors if the updated source is active
      const updatedSources = patch.sources;
      if (updatedSources && sourceId === currentState.activeSourceId) {
        const src = updatedSources[sourceId];
        if (src) {
          set({
            sources: updatedSources,
            statusHistory: patch.statusHistory,
            error: src.error,
            loading: src.loading,
          });
          return;
        }
      }
      set(patch);
    },

    // Force-refresh a source's theme list (bypasses cache)
    refreshSource: async (sourceId) => {
      const targetId = sourceId ?? get().activeSourceId;
      setSourcesAndSync((srcs) => ({
        ...srcs,
        [targetId]: { ...srcs[targetId], cache: undefined, page: 1 },
      }));
      // If refreshing the active source, use the flat-field loadThemes
      if (targetId === get().activeSourceId) {
        await get().loadThemes({ page: 1 });
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Module-level subscriptions
// ---------------------------------------------------------------------------

// Subscribe to download progress events at module init so all components
// automatically see progress updates without per-mount subscriptions.
// This pattern mirrors themeStore's onStatusChanged/onFileImported wiring.

// Store unsubscribe function for cleanup — prevents HMR subscription leaks.
let unsubCommunityDownloadProgress: (() => void) | null = null;

// HMR guard: without this flag, a hot-reload re-executes the module body and
// subscribes a second time, leaking the old listener.
let communityDownloadProgressInitialized = false;

if (
  !communityDownloadProgressInitialized &&
  typeof window !== 'undefined' &&
  api?.onCommunityDownloadProgress
) {
  communityDownloadProgressInitialized = true;
  unsubCommunityDownloadProgress = api.onCommunityDownloadProgress((progress) => {
    try {
      useCommunityStore.getState().updateDownloadProgress(progress);
    } catch {
      // Defensive: malformed progress payload should not crash the subscription.
      console.error('[communityStore] failed to process download progress', progress);
    }
  });
}

/**
 * Cleanup module-level IPC subscriptions.
 * Called from renderer.tsx `beforeunload` handler to tear down module-level
 * listeners on app exit / window close instead of leaking across HMR reloads.
 */
export function disposeCommunitySubscriptions(): void {
  if (unsubCommunityDownloadProgress) {
    unsubCommunityDownloadProgress();
    unsubCommunityDownloadProgress = null;
  }
  communityDownloadProgressInitialized = false;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all per-source request token state.
 * Call this in test `beforeEach` to prevent state leakage across tests.
 */
export function resetRequestToken(): void {
  requestTokens.clear();
}
