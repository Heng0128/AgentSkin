// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityTabPanel
 *
 * Community theme browser panel — search bar, sort selector, responsive
 * card grid, and a "load more" button. Consumes `useCommunityStore` for
 * all state and actions.
 *
 * Handles three visual states:
 *   - Loading (initial fetch) → centered spinner
 *   - Empty → empty-state message
 *   - Error → error message with retry button
 */

import { useCallback, useEffect, useRef } from 'react';
import { CommunityThemeCard } from './CommunityThemeCard';
import { useCommunityStore } from '@/stores/communityStore';
import { Spinner } from '@/components/ui/spinner';
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
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="size-6 text-primary" />
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
      {/* Toolbar — search + sort */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t.communitySearchPlaceholder}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />

        <select
          value={sortBy}
          onChange={(e) =>
            handleSortChange(e.target.value as 'popular' | 'recent' | 'rating')
          }
          className="rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary"
        >
          <option value="popular">{t.communitySortPopular}</option>
          <option value="recent">{t.communitySortRecent}</option>
          <option value="rating">{t.communitySortRating}</option>
        </select>
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
