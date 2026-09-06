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
import { fetchCodeDrobeCategories } from '@/api/community-direct-api';
import type { CommunityCategory } from '@shared/types/community';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import { AlertCircle, Clock, Globe, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShallow } from 'zustand/react/shallow';

const SEARCH_DEBOUNCE = 300;

type SortKey = 'popular' | 'recent' | 'favorites';

interface CommunityTabPanelProps {
  /** When true, the built-in ThemeDetailPanel is hidden (parent renders its own detail panel). */
  hideDetailPanel?: boolean;
  /** External selected theme id — overrides store selection for grid highlight. */
  selectedThemeId?: string | null;
  /** Callback when a card is clicked (select + load detail). */
  onSelectTheme?: (themeId: string | null) => void;
  /** Callback when an author name is clicked on a card. */
  onAuthorClick?: (authorId: string) => void;
}

export function CommunityTabPanel({
  hideDetailPanel = false,
  selectedThemeId: externalSelectedId,
  onSelectTheme,
  onAuthorClick,
}: CommunityTabPanelProps) {
  // RC1-step4: Replace full-store subscription with precise selector + useShallow
  // to prevent re-renders when unrelated community fields change.
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
    activeSourceId,
    getSourceStatus,
    loadThemes,
    loadMore,
    setQuery,
    setSortBy,
    selectTheme,
    loadThemeDetail,
  } = useCommunityStore(
    useShallow((s) => ({
      themes: s.themes,
      total: s.total,
      loading: s.loading,
      loadingMore: s.loadingMore,
      error: s.error,
      query: s.query,
      sortBy: s.sortBy,
      installingIds: s.installingIds,
      installedIds: s.installedIds,
      downloadProgress: s.downloadProgress,
      selectedThemeId: s.selectedThemeId,
      selectedThemeDetail: s.selectedThemeDetail,
      activeSourceId: s.activeSourceId,
      getSourceStatus: s.getSourceStatus,
      loadThemes: s.loadThemes,
      loadMore: s.loadMore,
      setQuery: s.setQuery,
      setSortBy: s.setSortBy,
      selectTheme: s.selectTheme,
      loadThemeDetail: s.loadThemeDetail,
    })),
  );

  // CodeDrobe categories — fetched on source switch to codedrobe.
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (activeSourceId !== 'codedrobe') {
      setCategories([]);
      setSelectedCategoryId(null);
      return;
    }
    let cancelled = false;
    void fetchCodeDrobeCategories()
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {
        // Non-fatal: categories are a nice-to-have filter.
      });
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  // Reload themes when category changes.
  useEffect(() => {
    if (activeSourceId === 'codedrobe') {
      void loadThemes({ categoryId: selectedCategoryId ?? undefined, page: 1 });
    }
  }, [selectedCategoryId, activeSourceId, loadThemes]);

  const activeStatus = getSourceStatus(activeSourceId);
  const isSourceOffline = activeStatus === 'offline';

  const [installErrors, setInstallErrors] = useState<
    Map<string, { error: string; retryCount: number }>
  >(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RC4-step8: Use a ref to always read the latest installErrors without stale closure.
  // The useCallback below has an empty dependency array, so it captures the initial
  // `installErrors` Map forever. The ref is updated on every render to point to the
  // latest Map, ensuring retryCount reads are always fresh.
  const installErrorsRef = useRef(installErrors);
  installErrorsRef.current = installErrors;
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

  const handleInstallWithTracking = useCallback(async (themeId: string) => {
    // RC4-step8: Read retryCount from the ref (always latest) instead of closure.
    const retryCount = installErrorsRef.current.get(themeId)?.retryCount ?? 0;
    const result = await useCommunityStore.getState().installTheme(themeId);

    if (!result.success && result.error) {
      setInstallErrors((prev) => {
        const next = new Map(prev);
        next.set(themeId, { error: result.error ?? '', retryCount: retryCount + 1 });
        return next;
      });
    } else if (result.success) {
      setInstallErrors((prev) => {
        const next = new Map(prev);
        next.delete(themeId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    // Offline sources (e.g. CodeDrobe placeholder) must not trigger API calls.
    if (isSourceOffline) return;
    loadThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThemes, activeSourceId]);

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
    { value: 'favorites', label: t.communitySortFavorites },
  ];

  // Error — show full-page error (less common, blocks interaction until dismissed)
  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Toolbar categories={[]} selectedCategoryId={null} onSelectCategory={() => {}} />
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<AlertCircle />}
            iconSize="lg"
            title={error}
            action={
              <Button variant="outline" size="sm" onClick={() => loadThemes()}>
                {t.communityRetry}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // Offline source — show toolbar (for source switch) + centered empty state
  if (isSourceOffline) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Toolbar categories={[]} selectedCategoryId={null} onSelectCategory={() => {}} />
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<Clock />}
            iconSize="lg"
            title={t.communitySourceComingSoon}
            hint={t.communitySourceOfflineDescription}
          />
        </div>
      </div>
    );
  }

  // Determine grid content: loading skeleton, empty state, or card grid
  let gridContent: React.ReactNode;
  if (loading && themes.length === 0) {
    gridContent = (
      <div className="grid grid-cols-1 gap-3 animate-pulse sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="aspect-[16/9] w-full bg-muted" />
            <div className="flex flex-col gap-2 p-3">
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
  } else if (themes.length === 0) {
    gridContent = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<Globe />}
          iconSize="lg"
          title={query ? t.communityEmptyNoResult : t.communityEmptyNoThemes}
        />
      </div>
    );
  } else {
    gridContent = (
      <>
        <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {themes.map((theme) => {
            const isInstalled = installedIds.has(theme.themeId);
            const isInstalling = installingIds.has(theme.themeId);
            const progress = downloadProgress.get(theme.themeId);
            const installError = installErrors.get(theme.themeId);

            return (
              <CommunityThemeCard
                key={theme.themeId}
                theme={theme}
                selected={selectedThemeId === theme.themeId}
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
                onAuthorClick={onAuthorClick}
                className="cursor-pointer"
                onClick={() => {
                  selectTheme(theme.themeId);
                  loadThemeDetail(theme.themeId);
                  onSelectTheme?.(theme.themeId);
                }}
              />
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
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Toolbar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
      />

      {/* Count indicator */}
      <div className="shrink-0 text-[11px] text-muted-foreground">
        {(t.communityCountLabel as string)
          ?.replace('{n}', String(themes.length))
          .replace('{total}', String(total)) ??
          `Showing ${themes.length} of ${total} themes`}
      </div>

      {/* Master-detail: grid yields width to the detail panel on the right */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Card grid — scrollable */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{gridContent}</div>

        {/* Theme detail panel (only rendered in standalone mode) */}
        {!hideDetailPanel && selectedThemeId && selectedThemeDetail && (
          <div className="h-full shrink-0 animate-slide-in-right as-slide-up-enter">
            <ThemeDetailPanel
              theme={selectedThemeDetail}
              onClose={() => {
                selectTheme(null);
                onSelectTheme?.(null);
              }}
              onInstall={() => {
                useCommunityStore.getState().installTheme(selectedThemeId);
              }}
              isInstalling={installingIds.has(selectedThemeId)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Toolbar sub-component — keeps search + sort always accessible
function Toolbar({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: {
  categories: CommunityCategory[];
  selectedCategoryId: string | null;
  onSelectCategory: (slug: string | null) => void;
}) {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale as 'zh-CN' | 'en'];

  const { query, sortBy, setSortBy, activeSourceId } = useCommunityStore(
    useShallow((s) => ({
      query: s.query,
      sortBy: s.sortBy,
      setSortBy: s.setSortBy,
      activeSourceId: s.activeSourceId,
    })),
  );

  const sortOptions: SegmentedOption<SortKey>[] = [
    { value: 'popular', label: t.communitySortPopular },
    { value: 'recent', label: t.communitySortRecent },
    { value: 'favorites', label: t.communitySortFavorites },
  ];

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSortChange = useCallback(
    (sort: SortKey) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void setSortBy(sort);
    },
    [setSortBy],
  );

  const handleSearch = useCallback((value: string) => {
    const { setQuery, loadThemes } = useCommunityStore.getState();
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadThemes({ query: value || undefined, page: 1 });
    }, SEARCH_DEBOUNCE);
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2">
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
      {/* Sort control — both sources support it (CodeDrobe: popular→downloads) */}
      <SegmentedControl
        options={sortOptions}
        value={sortBy}
        onChange={(v) => handleSortChange(v)}
        size="sm"
      />
      {/* Category filter — CodeDrobe only (hide zero-count categories) */}
      {activeSourceId === 'codedrobe' && categories.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className={cn(
              'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              !selectedCategoryId
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.communityCategoryAll ?? 'All'}
          </button>
          {categories.filter((cat) => cat.themeCount > 0).map((cat) => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => onSelectCategory(cat.slug)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                selectedCategoryId === cat.slug
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {cat.name}
              <span className="ml-1 text-[10px] text-muted-foreground/60">{cat.themeCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
