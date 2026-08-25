// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityTabPanel
 *
 * Community theme browser panel — search bar, sort selector, responsive
 * card grid, and a "load more" button. Consumes `useCommunityStore` for
 * all state and actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CommunityThemeCard } from '@/components/themes/CommunityThemeCard';
import { ThemeDetailPanel } from '@/components/themes/ThemeDetailPanel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import { AlertCircle, Search, Users } from 'lucide-react';

const SEARCH_DEBOUNCE = 300;

type SortKey = 'popular' | 'recent' | 'rating';

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
    selectedThemeId,
    selectedThemeDetail,
    loadThemes,
    loadMore,
    setQuery,
    setSortBy,
    selectTheme,
    loadThemeDetail,
  } = useCommunityStore();

  const [installErrors, setInstallErrors] = useState<
    Map<string, { error: string; retryCount: number }>
  >(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const handleInstall = useCallback(async (themeId: string) => {
    setInstallErrors((prev) => {
      const next = new Map(prev);
      next.delete(themeId);
      return next;
    });
    await useCommunityStore.getState().installTheme(themeId);
  }, []);

  const handleInstallWithTracking = useCallback(
    async (themeId: string) => {
      const retryCount = installErrors.get(themeId)?.retryCount ?? 0;
      const result = await useCommunityStore.getState().installTheme(themeId);

      if (!result.success && result.error) {
        setInstallErrors((prev) => {
          const next = new Map(prev);
          next.set(themeId, { error: result.error!, retryCount: retryCount + 1 });
          return next;
        });
      } else if (result.success) {
        setInstallErrors((prev) => {
          const next = new Map(prev);
          next.delete(themeId);
          return next;
        });
      }
    },
    [installErrors],
  );

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

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

  const handleSortChange = useCallback(
    (sort: SortKey) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSortBy(sort);
    },
    [setSortBy],
  );

  const sortOptions: SegmentedOption<SortKey>[] = [
    { value: 'popular', label: t.communitySortPopular },
    { value: 'recent', label: t.communitySortRecent },
    { value: 'rating', label: t.communitySortRating },
  ];

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle />}
        iconSize="lg"
        title={error}
        action={
          <Button variant="outline" size="sm" onClick={() => loadThemes()}>
            {t.communityRetry}
          </Button>
        }
        className="min-h-[400px] w-full"
      />
    );
  }

  if (loading && themes.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 animate-pulse sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-md border border-border bg-card"
          >
            <div className="aspect-[16/9] w-full bg-muted" />
            <div className="flex flex-col gap-2 p-2.5">
              <div className="h-3.5 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="flex gap-3">
                <div className="h-3 w-12 rounded bg-muted" />
                <div className="h-3 w-12 rounded bg-muted" />
              </div>
            </div>
            <div className="border-t border-border p-2">
              <div className="h-7 w-full rounded-md bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <EmptyState
        icon={<Users />}
        iconSize="lg"
        title={query ? t.communityEmptyNoResult : t.communityEmptyNoThemes}
        className="min-h-[400px] w-full"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t.communitySearchPlaceholder}
            className="pl-8"
          />
        </div>
        <SegmentedControl
          options={sortOptions}
          value={sortBy}
          onChange={(v) => handleSortChange(v)}
          size="sm"
        />
      </div>

      {/* Card grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {themes.map((theme) => {
            const isInstalled = installedIds.has(theme.themeId);
            const isInstalling = installingIds.has(theme.themeId);
            const progress = downloadProgress.get(theme.themeId);
            const installError = installErrors.get(theme.themeId);

            return (
              <div
                key={theme.themeId}
                onClick={() => {
                  selectTheme(theme.themeId);
                  loadThemeDetail(theme.themeId);
                }}
                className="cursor-pointer"
              >
                <CommunityThemeCard
                  theme={theme}
                  isInstalled={isInstalled}
                  isInstalling={isInstalling}
                  downloadProgress={progress}
                  installError={installError?.error ?? null}
                  retryCount={installError?.retryCount ?? 0}
                  onInstall={() => {
                    void handleInstallWithTracking(theme.themeId);
                  }}
                  onUninstall={() => {
                    useCommunityStore.getState().uninstallTheme(theme.themeId);
                  }}
                  onCancel={() => {
                    useCommunityStore.getState().cancelInstall(theme.themeId);
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Load more */}
        {themes.length < total && (
          <div className="flex justify-center py-4">
            <Button variant="outline" size="default" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t.communityLoading : t.communityLoadMore}
            </Button>
          </div>
        )}
      </div>

      {/* Theme detail panel */}
      {selectedThemeId && selectedThemeDetail && (
        <ThemeDetailPanel
          theme={selectedThemeDetail}
          onClose={() => selectTheme(null)}
          onInstall={() => {
            useCommunityStore.getState().installTheme(selectedThemeId);
          }}
          isInstalling={installingIds.has(selectedThemeId)}
        />
      )}
    </div>
  );
}
