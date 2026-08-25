// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityTabPanel
 *
 * Community theme browser panel — search bar, sort selector, responsive
 * card grid, and a "load more" button. Consumes `useCommunityStore` for
 * all state and actions.
 *
 * Handles three visual states:
 *   - Loading (initial fetch) → skeleton card grid (6 placeholders)
 *   - Empty → empty-state message
 *   - Error → error message with retry button
 */

import { useCallback, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { CommunityThemeCard } from './CommunityThemeCard';
import { useCommunityStore } from '@/stores/communityStore';
import { cn } from '@/lib/utils';
import { uiMessages } from '@shared/i18n';
import { useShellStore } from '@/stores/shellStore';

/** Debounce delay for search input (ms). */
const SEARCH_DEBOUNCE = 300;

export function CommunityTabPanel() {
  const {
    themes,
    total,
    loading,
    loadingMore,
    error,
    query,
    sortBy,
    installingIds,
    installedIds,
    downloadProgress,
    loadThemes,
    loadMore,
    setQuery,
    setSortBy,
  } = useCommunityStore();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  // Initial load
  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  // Search with debounce
  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        loadThemes({ query: value || undefined, page: 1 });
      }, SEARCH_DEBOUNCE);
    },
    [setQuery, loadThemes],
  );

  // Sort change — immediate reload
  const handleSortChange = useCallback(
    (sort: 'popular' | 'recent' | 'rating') => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSortBy(sort);
    },
    [setSortBy],
  );

  // --- Error state ---
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[13px] text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => loadThemes()}
          className="mt-4 text-[13px] text-primary hover:underline"
        >
          {t.communityRetry}
        </button>
      </div>
    );
  }

  // --- Loading state (initial) ---
  if (loading && themes.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 animate-pulse sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-md border border-border bg-card"
          >
            {/* Skeleton preview area — 16:9 aspect */}
            <div className="aspect-[16/9] w-full bg-muted" />
            {/* Skeleton info section */}
            <div className="flex flex-col gap-2 p-2.5">
              <div className="h-3.5 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="flex gap-3">
                <div className="h-3 w-12 rounded bg-muted" />
                <div className="h-3 w-12 rounded bg-muted" />
              </div>
            </div>
            {/* Skeleton action button */}
            <div className="border-t border-border p-2">
              <div className="h-7 w-full rounded-md bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --- Empty state ---
  if (themes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[13px] text-muted-foreground">
          {query ? t.communityEmptyNoResult : t.communityEmptyNoThemes}
        </p>
      </div>
    );
  }

  // --- Theme grid ---
  return (
    <div className="flex flex-col gap-4">
      {/* Search and filter bar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t.communitySearchPlaceholder}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* Sort toggle */}
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => handleSortChange('popular')}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              sortBy === 'popular'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.communitySortPopular}
          </button>
          <button
            type="button"
            onClick={() => handleSortChange('recent')}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              sortBy === 'recent'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.communitySortRecent}
          </button>
          <button
            type="button"
            onClick={() => handleSortChange('rating')}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              sortBy === 'rating'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.communitySortRating}
          </button>
        </div>
      </div>

      {/* Card grid — responsive columns */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {themes.map((theme) => {
          const isInstalled = installedIds.has(theme.themeId);
          const isInstalling = installingIds.has(theme.themeId);
          const progress =
            downloadProgress.get(theme.themeId)?.progress ?? 0;

          return (
            <CommunityThemeCard
              key={theme.themeId}
              theme={theme}
              isInstalled={isInstalled}
              isInstalling={isInstalling}
              downloadProgress={progress}
              onInstall={() => {
                useCommunityStore.getState().installTheme(theme.themeId);
              }}
              onUninstall={() => {
                useCommunityStore.getState().uninstallTheme(theme.themeId);
              }}
              onCancel={() => {
                useCommunityStore.getState().cancelInstall(theme.themeId);
              }}
            />
          );
        })}
      </div>

      {/* Load more */}
      {themes.length < total && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(
              'rounded-md border border-input px-4 py-2 text-[13px] transition-colors',
              loadingMore
                ? 'cursor-not-allowed text-muted-foreground'
                : 'hover:bg-muted',
            )}
          >
            {loadingMore ? t.communityLoading : t.communityLoadMore}
          </button>
        </div>
      )}
    </div>
  );
}
