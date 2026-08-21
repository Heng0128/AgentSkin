// SPDX-License-Identifier: MPL-2.0

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { VirtualThemeGrid } from '@/components/themes/VirtualThemeGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AppController } from '@/hooks/useAppController';
import type { ThemeSortKey } from '@/hooks/useThemeCenter';
import { useThemeCenter } from '@/hooks/useThemeCenter';
import { cn } from '@/lib/utils';

import type { AgentId } from '@shared/types';
import { Package, Search, UploadCloud } from 'lucide-react';

export function ThemesPage({ controller }: { controller: AppController }) {
  const { t } = controller;
  const tc = useThemeCenter();

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
    <section
      aria-label={t.navThemes}
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Page header — consistent with the other pages: display title +
          mono counter + hairline separator */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-sm font-bold tracking-tight">{t.navThemes}</h2>
        <span className="rounded-[var(--dl-radius,2px)] bg-muted px-1 py-0 text-xs text-muted-foreground">
          {tc.allCount}
        </span>
        <span className="h-3 w-px bg-border" aria-hidden />
        <span className="text-xs text-muted-foreground/60">
          {tc.categories.length > 0 ? t.categoryLabel(tc.selectedCategory ?? 'all') : ''}
        </span>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
          {tc.themes.length === tc.allCount
            ? t.themeCount(tc.allCount)
            : `${tc.themes.length} / ${tc.allCount}`}
        </span>

        {/* Search box — rounded-md h-7 */}
        <InputGroup
          className="ml-auto h-7 rounded-[var(--dl-radius,2px)]"
          style={{ width: '200px' }}
        >
          <InputGroupInput
            value={tc.query}
            onChange={(e) => tc.setQuery(e.target.value)}
            placeholder={t.searchInstalled}
            aria-label={t.searchInstalled}
          />
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
        </InputGroup>

        {/* Sort select — rounded-md shadcn Select */}
        <Select value={tc.sortBy} onValueChange={(v) => tc.setSortBy(v as ThemeSortKey)}>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  className="h-7 w-[130px] rounded-[var(--dl-radius,2px)] border-input bg-muted text-xs focus:border-primary focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.13)]"
                  aria-label={t.sortName}
                >
                  <SelectValue />
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                {t.studioSortHint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SelectContent className="rounded-[var(--dl-radius,2px)] border-border bg-card">
            <SelectItem value="name" className="text-xs">
              {t.sortName}
            </SelectItem>
            <SelectItem value="author" className="text-xs">
              {t.sortAuthor}
            </SelectItem>
            <SelectItem value="category" className="text-xs">
              {t.sortCategory}
            </SelectItem>
            <SelectItem value="version" className="text-xs">
              {t.sortVersion}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle — sort direction */}
        <div className="inline-flex items-center gap-0 rounded-[var(--dl-radius,2px)] bg-muted p-0.5">
          <button
            type="button"
            onClick={() => tc.setSortOrder(tc.sortOrder === 'asc' ? 'desc' : 'asc')}
            aria-label={tc.sortOrder === 'asc' ? t.sortDesc : t.sortAsc}
            aria-pressed={tc.sortOrder === 'asc'}
            className={cn(
              'h-6 rounded-[var(--dl-radius,2px)] px-2 text-xs font-medium transition-all duration-fast',
              'bg-card text-foreground',
            )}
          >
            <span className="font-mono">{tc.sortOrder === 'asc' ? '↑' : '↓'}</span>
          </button>
        </div>

        {/* Import */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-[var(--dl-radius,2px)] bg-card2 text-foreground transition-[border-color,color] duration-fast hover:border-primary hover:text-primary"
          disabled={controller.isInstalling}
          onClick={() => void controller.importTheme()}
        >
          {controller.isInstalling ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Package data-icon="inline-start" />
          )}
          {controller.isInstalling ? t.importing : t.importTheme}
        </Button>

        {/* Studio — btn-red */}
        <Button
          size="sm"
          className="h-7 rounded-[var(--dl-radius,2px)] bg-primary text-primary-foreground border border-primary transition-[background-color] duration-fast hover:bg-primary/90 active:bg-primary/80"
          onClick={() => {
            void api.openStudioWindow();
          }}
        >
          {t.navStudio}
        </Button>
      </div>

      {/* Filter row — segmented controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category filter */}
        {tc.categories.length > 0 && (
          <SegmentedControl
            size="sm"
            bordered
            value={tc.selectedCategory ?? 'all'}
            onChange={(v) => tc.setSelectedCategory(v === 'all' ? null : v)}
            options={[
              { value: 'all', label: t.themeFilterAll },
              ...tc.categories.map((cat) => ({ value: cat, label: t.categoryLabel(cat) })),
            ]}
          />
        )}

        {/* Mode filter */}
        <SegmentedControl
          size="sm"
          bordered
          value={tc.modeFilter}
          onChange={(v) => tc.setModeFilter(v)}
          options={(['all', 'dark', 'light'] as const).map((m) => ({
            value: m,
            label: m === 'all' ? t.themeModeAll : m === 'dark' ? t.themeModeDark : t.themeModeLight,
          }))}
        />

        {/* Dynamic filter — toggle */}
        {tc.hasDynamic && (
          <button
            type="button"
            onClick={() => tc.setDynamicFilter(tc.dynamicFilter === 'dynamic' ? 'all' : 'dynamic')}
            title={t.themeDynamicHint}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-[var(--dl-radius,2px)] px-2 text-xs font-medium transition-all duration-fast',
              tc.dynamicFilter === 'dynamic'
                ? 'bg-card text-foreground '
                : 'bg-muted text-muted-foreground hover:text-foreground ',
            )}
          >
            <span className="relative flex size-1.5">
              <span
                className={cn(
                  'absolute inline-flex size-full rounded-full',
                  tc.dynamicFilter === 'dynamic'
                    ? 'animate-ping bg-foreground/40'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex size-1.5 rounded-full',
                  tc.dynamicFilter === 'dynamic' ? 'bg-foreground' : 'bg-muted-foreground/50',
                )}
              />
            </span>
            {t.themeDynamicFilter}
          </button>
        )}

        {/* Stats badges — right side — Badge */}
        <div className="ml-auto flex items-center gap-2">
          {dynamicCount > 0 && (
            <Badge variant="red" data-icon="inline-start" className="gap-1">
              {dynamicCount} {t.themeDynamic}
            </Badge>
          )}
          {activeThemeCount > 0 && (
            <Badge variant="default" data-icon="inline-start" className="gap-1">
              {activeThemeCount} {t.themeActive}
            </Badge>
          )}
        </div>
      </div>

      {/* Stats rendered once (above, in toolbar badges). This row removed to eliminate duplicate counts. */}

      {/* Grid — virtualized for large libraries */}
      {controller.loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="size-6 text-primary" />
        </div>
      ) : tc.themes.length === 0 ? (
        <div className="flex min-h-[520px] flex-col items-center justify-center py-12 text-center">
          <i
            style={{
              display: 'block',
              fontStyle: 'normal',
              fontSize: '26px',
              marginBottom: '10px',
              opacity: 0.5,
            }}
          >
            ◉
          </i>
          <p className="text-xs font-medium text-muted-foreground">
            {tc.query ? t.themeNoResults : t.themeLibraryEmpty}
          </p>
          <p className="mt-2 max-w-52 text-xs leading-relaxed text-muted-foreground/70">
            {tc.query || tc.selectedCategory ? t.noSearchResultsHint : t.emptyInstalledHint}
          </p>
        </div>
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
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          style={{
            background: 'color-mix(in srgb, var(--background) 72%, transparent)',
            backdropFilter: 'blur(20px) saturate(1.5)',
          }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-[var(--dl-radius,2px)] border-2 border-dashed border-border bg-card px-12 py-9 text-center"
            style={{ boxShadow: 'var(--shadow, 0 10px 28px rgba(0,0,0,0.4))' }}
          >
            <div className="flex size-14 items-center justify-center rounded-[var(--dl-radius,2px)] bg-accent">
              <UploadCloud className="size-7 text-primary" />
            </div>
            <p className="text-sm font-semibold text-foreground">{t.dropThemeHere}</p>
            <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
              {t.dropThemeHint}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
