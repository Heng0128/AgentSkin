// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemesPage
 *
 * 编排层：组合 toolbar + grid + detail sidebar，自身不含业务逻辑。
 * 状态/副作用/handler 全部委托给 useThemePageController hook。
 */

import { api } from '@/api/agentSkinClient';
import { DetailPanel } from '@/components/DetailPanel';
import { VirtualThemeGrid } from '@/components/themes/VirtualThemeGrid';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/ui/filter-chips';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { SkeletonProvider } from '@/components/ui/SkeletonProvider';
import { Spinner } from '@/components/ui/spinner';
import type { AppController } from '@/hooks/useAppController';
import { useSkeletonStrategy } from '@/hooks/useSkeletonStrategy';
import { useThemeCenter } from '@/hooks/useThemeCenter';
import { useThemePageController } from '@/hooks/useThemePageController';
import { cn } from '@/lib/utils';

import {
  CheckCircle2,
  ClipboardCopy,
  ClipboardPaste,
  Layers,
  Package,
  PaintBucket,
  Palette,
  UploadCloud,
  Users,
} from 'lucide-react';

export function ThemesPage({ controller }: { controller: AppController }) {
  const { t } = controller;
  const tc = useThemeCenter();
  const page = useThemePageController(controller);

  // --- Loading state (anti-flicker + timeout via useSkeletonStrategy) ---
  const showThemeSkeleton = useSkeletonStrategy(controller.loading);

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        {/* Master-detail: grid yields width to the detail panel on the right */}
        <div className="flex min-h-0 flex-1 gap-3">
          <section
            aria-label="Drop theme package to install"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
            onDragEnter={page.handleDragEnter}
            onDragOver={page.handleDragOver}
            onDragLeave={page.handleDragLeave}
            onDrop={page.handleDrop}
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
                  onChange: (value) =>
                    tc.setSortBy(value as 'name' | 'author' | 'category' | 'version'),
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        page.setShowPasteDialog(true);
                      }}
                    >
                      <ClipboardPaste className="size-3.5" />
                      {t.importFromString}
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => void api.openStudioWindow()}>
                      <Palette className="size-3.5" />
                      {t.navStudio}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => controller.setRoute('community.dreamskin')}
                    >
                      <Users className="size-3.5 mr-1" />
                      {t.navCommunity}
                    </Button>
                  </>
                }
              />
            </PageHeader>

            {/* Stats overview bar */}
            <div className="as-stat-bar">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-muted">
                  <Layers className="size-3.5 text-muted-foreground" />
                </div>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {tc.allCount}
                </span>
                <span className="text-[11px] text-muted-foreground">{t.installedTitle}</span>
              </div>
              <span className="as-hairline-v h-5" />
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-muted">
                  <CheckCircle2 className="size-3.5 text-cr-success" />
                </div>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {page.activeThemeCount}
                </span>
                <span className="text-[11px] text-muted-foreground">{t.themeActive}</span>
              </div>
              {page.dynamicCount > 0 && (
                <>
                  <span className="as-hairline-v h-5" />
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-muted">
                      <UploadCloud className="size-3.5 text-primary" />
                    </div>
                    <span className="text-base font-semibold tabular-nums text-foreground">
                      {page.dynamicCount}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{t.themeDynamic}</span>
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
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all duration-base',
                    tc.dynamicFilter === 'dynamic'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-1.5 rounded-full',
                      tc.dynamicFilter === 'dynamic'
                        ? 'bg-accent-foreground'
                        : 'bg-muted-foreground/50',
                    )}
                  />
                  {t.themeDynamicFilter}
                </button>
              )}
            </div>

            {/* Grid — virtualized for large libraries, with crossfade transition */}
            <SkeletonProvider
              loading={showThemeSkeleton.showSkeleton}
              config={{ header: true, toolbar: true, body: 'grid', count: 12, aspect: '16/9' }}
              className="min-h-0 flex-1"
            >
              {tc.themes.length === 0 ? (
                <EmptyState
                  icon={<PaintBucket />}
                  iconSize="lg"
                  title={tc.query ? t.themeNoResults : t.themeLibraryEmpty}
                  hint={
                    tc.query || tc.selectedCategory ? t.noSearchResultsHint : t.emptyInstalledHint
                  }
                  className="min-h-[32rem] w-full"
                />
              ) : (
                <VirtualThemeGrid
                  themes={tc.themes}
                  activeAgentsByTheme={page.activeAgentsByTheme}
                  selectedId={
                    controller.selection?.kind === 'installed'
                      ? controller.selection.theme.id
                      : null
                  }
                  onSelect={page.handleSelect}
                  t={t}
                />
              )}
            </SkeletonProvider>

            {/* Drag-and-drop import overlay */}
            {page.dragOver && (
              <div className="pointer-events-none absolute inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-scrim">
                <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-primary/40 bg-card px-12 py-10 text-center shadow-xl">
                  <div className="flex size-16 items-center justify-center rounded-lg bg-accent">
                    <UploadCloud className="size-8 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{t.dropThemeHere}</p>
                  <p className="max-w-80 text-[11px] leading-relaxed text-muted-foreground">
                    {t.dropThemeHint}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Installed-theme detail panel — in-flow on the right, grid yields width */}
          {controller.selection && (
            <div className="h-full shrink-0 as-slide-up-enter">
              <DetailPanel
                controller={controller}
                selection={controller.selection}
                onClose={() => controller.setSelection(null)}
                extraActions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void page.handleCopyThemeString()}
                  >
                    <ClipboardCopy className="size-3.5" />
                    {t.copyThemeString}
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Paste-from-string dialog */}
      <Dialog open={page.showPasteDialog} onOpenChange={page.setShowPasteDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.pasteThemeString}</DialogTitle>
          </DialogHeader>
          <textarea
            value={page.pasteInput}
            onChange={(e) => {
              page.setPasteInput(e.target.value);
              if (page.pasteError) page.setPasteError(null);
            }}
            placeholder={t.pasteHint}
            rows={4}
            className="w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {page.pasteError && <p className="text-[11px] text-destructive">{page.pasteError}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                page.setShowPasteDialog(false);
                page.setPasteInput('');
                page.setPasteError(null);
              }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!page.pasteInput.trim() || page.importing}
              onClick={() => void page.handlePasteImport()}
            >
              {page.importing ? <Spinner className="animate-spin" /> : null}
              {page.importing ? t.importing : t.importFromString}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
