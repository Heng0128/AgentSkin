// SPDX-License-Identifier: MPL-2.0

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { VirtualThemeGrid } from '@/components/themes/VirtualThemeGrid';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
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

import { PackageIcon, Search01Icon, UploadSquareIcon } from '@hugeicons/core-free-icons';
import type { AgentId } from '@shared/types';

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
  const dynamicCount = tc.themes.filter((th) => th.hasWallpaper).length;

  const handleSelect = (id: string) => {
    const theme = controller.installed.find((item) => item.id === id);
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
      {/* Swiss header — consistent with the other pages: display title +
          mono counter + hairline separator */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-sm font-bold tracking-tight">{t.navThemes}</h2>
        <span className="rounded-[2px] bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
          {tc.allCount}
        </span>
        <span className="h-3 w-px bg-border" aria-hidden />
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60">
          {tc.categories.length > 0 ? t.categoryLabel(tc.selectedCategory ?? 'all') : ''}
        </span>
      </div>

      {/* Swiss Toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="mono text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
          {tc.themes.length === tc.allCount
            ? t.themeCount(tc.allCount)
            : `${tc.themes.length} / ${tc.allCount}`}
        </span>

        {/* Search box — Swiss: rounded-[2px] h-[30px] */}
        <InputGroup className="ml-auto h-[30px] rounded-[2px]" style={{ width: '200px' }}>
          <InputGroupInput
            value={tc.query}
            onChange={(e) => tc.setQuery(e.target.value)}
            placeholder={t.searchInstalled}
            aria-label={t.searchInstalled}
          />
          <InputGroupAddon align="inline-start">
            <HugeIcon icon={Search01Icon} />
          </InputGroupAddon>
        </InputGroup>

        {/* Sort select — Swiss: rounded-[2px] shadcn Select */}
        <Select value={tc.sortBy} onValueChange={(v) => tc.setSortBy(v as ThemeSortKey)}>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  className="h-[30px] w-[130px] rounded-[2px] border-border bg-muted text-[11px] focus:border-primary focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.13)]"
                  aria-label={t.sortName}
                >
                  <SelectValue />
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10.5px]">
                {t.studioSortHint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <SelectContent className="rounded-[2px] border-border bg-card">
            <SelectItem value="name" className="text-[11px]">
              {t.sortName}
            </SelectItem>
            <SelectItem value="author" className="text-[11px]">
              {t.sortAuthor}
            </SelectItem>
            <SelectItem value="category" className="text-[11px]">
              {t.sortCategory}
            </SelectItem>
            <SelectItem value="version" className="text-[11px]">
              {t.sortVersion}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle — Swiss segmented */}
        <div className="inline-flex items-center gap-0.5 rounded-[2px] bg-muted p-0.5">
          <button
            type="button"
            onClick={() => tc.setSortOrder(tc.sortOrder === 'asc' ? 'desc' : 'asc')}
            aria-label={tc.sortOrder === 'asc' ? t.sortDesc : t.sortAsc}
            aria-pressed={tc.sortOrder === 'asc'}
            className={cn(
              'h-[26px] rounded-[2px] px-2.5 text-xs font-medium transition-all duration-150',
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
          className="h-[30px] rounded-[2px] border border-border2 bg-card2 text-foreground transition-[border-color,color] duration-150 hover:border-primary hover:text-primary"
          disabled={controller.isInstalling}
          onClick={() => void controller.importTheme()}
        >
          {controller.isInstalling ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeIcon icon={PackageIcon} data-icon="inline-start" />
          )}
          {controller.isInstalling ? t.importing : t.importTheme}
        </Button>

        {/* Theme Studio — btn-red */}
        <Button
          size="sm"
          className="h-[30px] rounded-[2px] bg-primary text-primary-foreground border border-primary transition-[background-color,transform] duration-150 hover:bg-primary/90 active:translate-y-px active:scale-[.99]"
          onClick={() => {
            void api.openStudioWindow();
          }}
        >
          Theme Studio
        </Button>
      </div>

      {/* Filter row — Swiss segmented controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category filter — segmented */}
        {tc.categories.length > 0 && (
          <div className="inline-flex items-center gap-0.5 rounded-[2px] bg-muted border border-border p-0.5">
            <button
              type="button"
              onClick={() => tc.setSelectedCategory(null)}
              className={cn(
                'h-[26px] rounded-[2px] px-2.5 text-[11.5px] font-medium transition-all duration-150',
                tc.selectedCategory === null
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.themeFilterAll}
            </button>
            {tc.categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => tc.setSelectedCategory(cat)}
                className={cn(
                  'h-[26px] rounded-[2px] px-2.5 text-[11.5px] font-medium transition-all duration-150',
                  tc.selectedCategory === cat
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.categoryLabel(cat)}
              </button>
            ))}
          </div>
        )}

        {/* Mode filter — segmented */}
        <div className="inline-flex items-center gap-0.5 rounded-[2px] bg-muted border border-border p-0.5">
          {(['all', 'dark', 'light'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => tc.setModeFilter(m)}
              className={cn(
                'h-[26px] rounded-[2px] px-2.5 text-[11.5px] font-medium transition-all duration-150',
                tc.modeFilter === m
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'all' ? t.themeModeAll : m === 'dark' ? t.themeModeDark : t.themeModeLight}
            </button>
          ))}
        </div>

        {/* Dynamic filter — toggle */}
        {tc.hasDynamic && (
          <button
            type="button"
            onClick={() => tc.setDynamicFilter(tc.dynamicFilter === 'dynamic' ? 'all' : 'dynamic')}
            title={t.themeDynamicHint}
            className={cn(
              'inline-flex h-[26px] items-center gap-1 rounded-[2px] px-2.5 text-[11.5px] font-medium transition-all duration-150',
              tc.dynamicFilter === 'dynamic'
                ? 'bg-card text-foreground border border-border'
                : 'bg-muted text-muted-foreground hover:text-foreground border border-border',
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

        {/* Stats badges — right side — Swiss Badge */}
        <div className="ml-auto flex items-center gap-2">
          {dynamicCount > 0 && (
            <Badge variant="red" data-icon="inline-start" className="gap-1">
              {dynamicCount} DYNAMIC
            </Badge>
          )}
          {activeThemeCount > 0 && (
            <Badge variant="default" data-icon="inline-start" className="gap-1">
              {activeThemeCount} ACTIVE
            </Badge>
          )}
        </div>
      </div>

      {/* Quick guide accordion — collapsible usage instructions */}
      <Accordion type="single" collapsible className="mb-2">
        <AccordionItem value="guide" className="border-b-0">
          <AccordionTrigger className="py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            {t.quickGuide}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1 pb-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground/70">
              <p>· {t.guideImport}</p>
              <p>· {t.guidePreview}</p>
              <p>· {t.guideDynamic}</p>
              <p>· {t.guideStudio}</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Swiss metadata row — theme count + active palette info */}
      <div className="flex items-center gap-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">
          Library
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {tc.themes.length === tc.allCount
            ? `${tc.allCount} themes`
            : `${tc.themes.length} / ${tc.allCount} themes`}
        </span>
        {dynamicCount > 0 && (
          <>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span className="font-mono text-[10px] text-muted-foreground">
              {dynamicCount} dynamic
            </span>
          </>
        )}
        {activeThemeCount > 0 && (
          <>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span className="font-mono text-[10px] text-muted-foreground">
              {activeThemeCount} active
            </span>
          </>
        )}
      </div>

      {/* Grid — virtualized for large libraries */}
      {controller.loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="size-6 text-primary" />
        </div>
      ) : tc.themes.length === 0 ? (
        <div
          className="flex min-h-[520px] flex-col items-center justify-center py-12 text-center"
          style={{ gridColumn: '1/-1' }}
        >
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
          <p
            className="text-xs font-medium text-muted-foreground"
            style={{ letterSpacing: '0.1em', fontFamily: 'var(--f-mono, monospace)' }}
          >
            {tc.query ? 'NO RESULTS' : 'LIBRARY EMPTY'}
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
            background: 'var(--glass, rgba(14,14,17,0.62))',
            backdropFilter: 'blur(20px) saturate(1.5)',
          }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-[2px] border-2 border-dashed border-border bg-card px-12 py-9 text-center"
            style={{ boxShadow: 'var(--shadow, 0 10px 28px rgba(0,0,0,0.4))' }}
          >
            <div
              className="flex size-14 items-center justify-center rounded-[2px]"
              style={{ background: 'var(--redbg, rgba(255,69,58,0.13))' }}
            >
              <HugeIcon
                icon={UploadSquareIcon}
                className="size-7"
                style={{ color: 'var(--red, #FF453A)' }}
              />
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
