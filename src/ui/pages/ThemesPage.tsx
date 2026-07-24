// SPDX-License-Identifier: MPL-2.0

import { ThemeCard } from '@/components/themes/ThemeCard';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import type { AppController } from '@/hooks/useAppController';
import type { ThemeSortKey } from '@/hooks/useThemeCenter';
import { useThemeCenter } from '@/hooks/useThemeCenter';
import { cn } from '@/lib/utils';

import { PackageIcon, Search01Icon } from '@hugeicons/core-free-icons';
import type { AgentId } from '@shared/types';

/** Adaptive grid columns based on item count (user preference: content-driven layout). */
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-3';
  if (count === 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

export function ThemesPage({ controller }: { controller: AppController }) {
  const { t } = controller;
  const tc = useThemeCenter(controller);

  // Build a map: themeId → AgentId[] (which agents have this theme active)
  const activeAgentsByTheme = new Map<string, AgentId[]>();
  for (const app of controller.status?.apps ?? []) {
    if (app.activeThemeId) {
      const list = activeAgentsByTheme.get(app.activeThemeId) ?? [];
      list.push(app.appId);
      activeAgentsByTheme.set(app.activeThemeId, list);
    }
  }
  const activeThemeCount = activeAgentsByTheme.size;
  const dynamicCount = tc.themes.filter((th) => th.hasWallpaper).length;

  const handleSelect = (id: string) => {
    const theme = controller.installed.find((item) => item.id === id);
    if (theme) controller.setSelection({ kind: 'installed', theme });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t.navThemes}</h2>
        <span className="text-xs text-muted-foreground">
          {tc.themes.length === tc.allCount
            ? t.themeCount(tc.allCount)
            : `${tc.themes.length} / ${tc.allCount}`}
        </span>
        {/* Stats badges */}
        {tc.allCount > 0 && (
          <div className="flex items-center gap-1.5">
            {dynamicCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                {dynamicCount} {t.themeDynamicBadge}
              </span>
            )}
            {activeThemeCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {t.themeStatsActive(activeThemeCount)}
              </span>
            )}
          </div>
        )}

        <InputGroup className="ml-auto h-8 w-56">
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

        <Button
          size="sm"
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
      </div>

      {/* Category filter + Mode filter + Sort */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        {/* Category filter — Apple-style segmented control */}
        {tc.categories.length > 0 && (
          <div className="inline-flex items-center gap-0.5 rounded-[11px] bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
            <button
              type="button"
              onClick={() => tc.setSelectedCategory(null)}
              className={cn(
                'h-7 rounded-lg px-2.5 text-xs font-medium transition-all duration-200 ease-out',
                tc.selectedCategory === null
                  ? 'bg-card text-foreground shadow-xs'
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
                  'h-7 rounded-lg px-2.5 text-xs font-medium transition-all duration-200 ease-out',
                  tc.selectedCategory === cat
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.categoryLabel(cat)}
              </button>
            ))}
          </div>
        )}

        {/* Mode filter — light/dark segmented control */}
        <div className="inline-flex items-center gap-0.5 rounded-[11px] bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
          {(['all', 'dark', 'light'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => tc.setModeFilter(m)}
              className={cn(
                'h-7 rounded-lg px-2.5 text-xs font-medium transition-all duration-200 ease-out',
                tc.modeFilter === m
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'all' ? t.themeModeAll : m === 'dark' ? t.themeModeDark : t.themeModeLight}
            </button>
          ))}
        </div>

        {/* Dynamic filter — toggle for video wallpaper themes */}
        {tc.hasDynamic && (
          <button
            type="button"
            onClick={() => tc.setDynamicFilter(tc.dynamicFilter === 'dynamic' ? 'all' : 'dynamic')}
            title={t.themeDynamicHint}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-[11px] px-2.5 text-xs font-medium transition-all duration-200 ease-out',
              tc.dynamicFilter === 'dynamic'
                ? 'bg-primary/10 text-primary shadow-xs ring-1 ring-primary/20'
                : 'bg-black/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]',
            )}
          >
            <span className="relative flex size-1.5">
              <span
                className={cn(
                  'absolute inline-flex size-full rounded-full',
                  tc.dynamicFilter === 'dynamic'
                    ? 'animate-ping bg-primary/60'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex size-1.5 rounded-full',
                  tc.dynamicFilter === 'dynamic' ? 'bg-primary' : 'bg-muted-foreground/50',
                )}
              />
            </span>
            {t.themeDynamicFilter}
          </button>
        )}

        {/* Sort + order */}
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={tc.sortBy}
            onChange={(e) => tc.setSortBy(e.target.value as ThemeSortKey)}
            className="h-7 rounded-lg border bg-background px-2 text-xs text-muted-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary/30"
          >
            <option value="name">{t.sortName}</option>
            <option value="author">{t.sortAuthor}</option>
            <option value="category">{t.sortCategory}</option>
            <option value="version">{t.sortVersion}</option>
          </select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => tc.setSortOrder(tc.sortOrder === 'asc' ? 'desc' : 'asc')}
            aria-label={tc.sortOrder === 'asc' ? t.sortAsc : t.sortDesc}
          >
            <span className="text-xs font-mono">{tc.sortOrder === 'asc' ? '↑' : '↓'}</span>
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {controller.loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner className="size-6 text-primary" />
          </div>
        ) : tc.themes.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60">
              <HugeIcon icon={PackageIcon} className="size-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground/80">
              {tc.query || tc.selectedCategory ? t.noSearchResults : t.emptyInstalledTitle}
            </p>
            <p className="max-w-52 text-xs leading-relaxed text-muted-foreground">
              {tc.query || tc.selectedCategory ? t.noSearchResultsHint : t.emptyInstalledHint}
            </p>
          </div>
        ) : (
          <div className={cn('grid gap-3', gridColsClass(tc.themes.length))}>
            {tc.themes.map((theme, index) => (
              <div
                key={theme.id}
                className="animate-card-enter"
                style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
              >
                <ThemeCard
                  theme={theme}
                  selected={
                    controller.selection?.kind === 'installed' &&
                    controller.selection.theme.id === theme.id
                  }
                  activeAgentIds={activeAgentsByTheme.get(theme.id) ?? []}
                  onSelect={() => handleSelect(theme.id)}
                  t={t}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
