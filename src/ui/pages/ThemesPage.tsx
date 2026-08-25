// SPDX-License-Identifier: MPL-2.0

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { CommunityTabPanel } from '@/components/themes/CommunityTabPanel';
import { ThemeGridSkeleton } from '@/components/themes/ThemeGridSkeleton';
import { VirtualThemeGrid } from '@/components/themes/VirtualThemeGrid';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/ui/filter-chips';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AppController } from '@/hooks/useAppController';
import { type ThemeSortKey, useThemeCenter } from '@/hooks/useThemeCenter';
import { cn } from '@/lib/utils';

import type { AgentId } from '@shared/types';
import { CheckCircle2, Layers, Package, PaintBucket, Palette, UploadCloud, Users } from 'lucide-react';

type ThemesTab = 'installed' | 'community';

export function ThemesPage({ controller }: { controller: AppController }) {
  const { t } = controller;
  const tc = useThemeCenter();
  const [activeTab, setActiveTab] = useState<ThemesTab>('installed');

  // Drag-and-drop theme import: a depth counter keeps the overlay stable
  // across child dragenter/leave events (which fire on every nested element).
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) controller.dropThemeFiles(files);
  };

  // Build a map: themeId → AgentId[] (which agents have this theme active)
  const activeAgentsByTheme = useMemo(() => {
    const map = new Map<string, AgentId[]>();
    for (const app of controller.status?.apps ?? []) {
      if (app.activeThemeId) {
        const list = map.get(app.activeThemeId) ?? [];
        list.push(app.appId);
        map.set(app.activeThemeId, list);
      }
    }
    return map;
  }, [controller.status]);
  const activeThemeCount = activeAgentsByTheme.size;
  const dynamicCount = useMemo(() => tc.themes.filter((th) => th.hasWallpaper).length, [tc.themes]);

  // Select from the visible (filtered/sorted) view tc.themes, not from the full
  // installed catalog — avoids scanning themes hidden by filters. ThemeCenterCardModel
  // is a structural subset of ThemeCatalogItem; install via store to hydrate the full
  // catalog item for downstream consumers.
  const handleSelect = (id: string) => {
    if (!tc.themes.some((t) => t.id === id)) return;
    const theme = controller.installedById(id);
    if (theme) controller.setSelection({ kind: 'installed', theme });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as ThemesTab)}
      aria-label={t.navThemes}
      className="relative flex h-full min-h-0 flex-col"
    >
      {/* Tab navigation */}
      <TabsList variant="line" className="border-b border-border px-6 py-3">
        <TabsTrigger value="installed" className="text-[13px]">
          <Palette className="size-3.5" />
          {t.installedTitle}
        </TabsTrigger>
        <TabsTrigger value="community" className="text-[13px]">
          <Users className="size-3.5" />
          {t.sourceCommunity}
        </TabsTrigger>
      </TabsList>

      {/* Community tab */}
      <TabsContent value="community" className="flex-1 overflow-auto p-6">
        <CommunityTabPanel />
      </TabsContent>

      {/* Installed tab */}
      <TabsContent value="installed" className="flex min-h-0 flex-1 flex-col">
        <section
          aria-label="Drop theme package to install"
          className="flex min-h-0 flex-1 flex-col"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Toolbar — title integrated inline */}
          <PageHeader
            title={t.navThemes}
            count={tc.allCount}
            description={
              tc.themes.length === tc.allCount
                ? t.themeCount(tc.allCount)
                : `${tc.themes.length} / ${tc.allCount}`
            }
          >
            <PageToolbar
              search={{
                value: tc.query,
                onChange: tc.setQuery,
                placeholder: t.searchInstalled,
              }}
              sort={{
                value: tc.sortBy,
                options: [
                  { value: 'name', label: t.sortName },
                  { value: 'author', label: t.sortAuthor },
                  { value: 'category', label: t.sortCategory },
                  { value: 'version', label: t.sortVersion },
                ],
                onChange: (value) => tc.setSortBy(value as ThemeSortKey),
              }}
              sortOrder={{
                order: tc.sortOrder === 'asc' ? 'asc' : 'desc',
                onToggle: () => tc.setSortOrder(tc.sortOrder === 'asc' ? 'desc' : 'asc'),
              }}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void controller.importTheme()}
                    disabled={controller.isInstalling}
                  >
                    {controller.isInstalling ? (
                      <Spinner className="animate-spin" />
                    ) : (
                      <Package className="size-3.5" />
                    )}
                    {controller.isInstalling ? t.importing : t.importTheme}
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void api.openStudioWindow()}>
                    <Palette className="size-3.5" />
                    {t.navStudio}
                  </Button>
                </>
              }
            />
          </PageHeader>

          {/* Stats overview bar */}
          <div className="my-3 flex items-center gap-4 rounded-md border border-border bg-card/50 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Layers className="size-3.5 text-muted-foreground" />
              <span className="text-label font-medium tabular-nums text-foreground">{tc.allCount}</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-cr-success" />
              <span className="text-label font-medium tabular-nums text-foreground">{activeThemeCount}</span>
              <span className="text-micro text-muted-foreground">{t.themeActive}</span>
            </div>
            {dynamicCount > 0 && (
              <>
                <span className="h-3 w-px bg-border" />
                <div className="flex items-center gap-1.5">
                  <UploadCloud className="size-3.5 text-primary" />
                  <span className="text-label font-medium tabular-nums text-foreground">{dynamicCount}</span>
                  <span className="text-micro text-muted-foreground">{t.themeDynamic}</span>
                </div>
              </>
            )}
          </div>

          {/* Filter row — chip pills */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Category filter */}
            {tc.categories.length > 0 && (
              <FilterChips
                options={[
                  { value: 'all', label: t.themeFilterAll },
                  ...tc.categories.map((cat) => ({ value: cat, label: t.categoryLabel(cat) })),
                ]}
                value={tc.selectedCategory ?? 'all'}
                onChange={(v) => tc.setSelectedCategory(v === 'all' ? null : v)}
              />
            )}

            {/* Mode filter */}
            <FilterChips
              options={[
                { value: 'all', label: t.themeModeAll },
                { value: 'dark', label: t.themeModeDark },
                { value: 'light', label: t.themeModeLight },
              ]}
              value={tc.modeFilter}
              onChange={tc.setModeFilter}
            />

            {/* Dynamic filter — toggle */}
            {tc.hasDynamic && (
              <button
                type="button"
                onClick={() =>
                  tc.setDynamicFilter(tc.dynamicFilter === 'dynamic' ? 'all' : 'dynamic')
                }
                title={t.themeDynamicHint}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-pill px-2 text-[10px] font-normal transition-all duration-fast',
                  tc.dynamicFilter === 'dynamic'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-1.5 rounded-full',
                    tc.dynamicFilter === 'dynamic' ? 'bg-foreground' : 'bg-muted-foreground/50',
                  )}
                />
                {t.themeDynamicFilter}
              </button>
            )}
          </div>

          {/* Stats rendered once (above, in toolbar badges). This row removed to eliminate duplicate counts. */}

          {/* Grid — virtualized for large libraries */}
          {controller.loading ? (
            <ThemeGridSkeleton />
          ) : tc.themes.length === 0 ? (
            <EmptyState
              icon={<PaintBucket />}
              iconSize="lg"
              title={tc.query ? t.themeNoResults : t.themeLibraryEmpty}
              hint={tc.query || tc.selectedCategory ? t.noSearchResultsHint : t.emptyInstalledHint}
              className="min-h-[520px] w-full"
            />
          ) : (
            <VirtualThemeGrid
              themes={tc.themes}
              activeAgentsByTheme={activeAgentsByTheme}
              selectedId={
                controller.selection?.kind === 'installed' ? controller.selection.theme.id : null
              }
              onSelect={handleSelect}
              t={t}
            />
          )}

          {/* Drag-and-drop import overlay */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-background/80">
              <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-border bg-card px-12 py-9 text-center shadow-lg">
                <div className="flex size-14 items-center justify-center rounded-md bg-accent">
                  <UploadCloud className="size-7 text-primary" />
                </div>
                <p className="text-[11px] font-normal text-foreground">{t.dropThemeHere}</p>
                <p className="max-w-60 text-[10px] leading-relaxed text-muted-foreground">
                  {t.dropThemeHint}
                </p>
              </div>
            </div>
          )}
        </section>
      </TabsContent>
    </Tabs>
  );
}
