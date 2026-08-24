// SPDX-License-Identifier: MPL-2.0

/**
 * # WallpaperEnginePage
 *
 * 编排层：组合 toolbar + grid + detail sidebar，自身不含业务逻辑。
 * 状态/副作用/handler 全部委托给 useWallpaperPageController hook。
 */

import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/ui/filter-chips';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { InjectResultsPanel } from '@/components/wallpaper/InjectResultsPanel';
import { WallpaperGrid } from '@/components/wallpaper/WallpaperGrid';
import type { AppController } from '@/hooks/useAppController';
import { useWallpaperPageController } from '@/hooks/useWallpaperPageController';

import type { WallpaperInfo } from '@shared/types';
import { Download, Image, Video } from 'lucide-react';

/** 页面 wrapper — 持有 AppController (由上层注入)。 */
export function WallpaperEnginePage({ controller }: { controller: AppController }) {
  return <WallpaperEnginePageInner controller={controller} />;
}

function WallpaperEnginePageInner({ controller }: { controller: AppController }) {
  const {
    t,
    wallpaper: {
      enabled,
      selectedId,
      agentWallpapers,
      wallpapers,
      setWallpaper,
      importWallpaper,
      error,
      initialize,
    },
    appStatusFor,
    isRefreshing,
  } = controller;

  const page = useWallpaperPageController(controller);
  const {
    filter,
    search,
    sortBy,
    selected,
    renderDraft,
    applyingTo,
    deletingId,
    batchProgress,
    injectResults,
    filtered,
    installed,
    relativeTime,
    runningAgentCount,
    readyAgentCount,
    selectedVideo,
    setFilter,
    setSearch,
    setSortBy,
    setRenderDraft,
    handleApply,
    handleDelete,
    handleApplyAll,
    selectWallpaper,
  } = page;

  // Derived forwarded callbacks
  const handleSetUiBackground = () => {
    if (!selected) return;
    void setWallpaper(true, selected.id, renderDraft);
  };
  const handleApplyAgent = (agentId: Parameters<typeof handleApply>[1]) => {
    if (!selected) return;
    void handleApply(selected.id, agentId);
  };
  const handleApplyAllAgents = () => {
    if (!selected) return;
    void handleApplyAll(selected.id);
  };

  // --- Loading state ---
  if (controller.wallpaper.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          <p className="text-[11px]">{t.weDetecting}</p>
        </div>
      </div>
    );
  }

  // --- Error state: WE installed but initial list failed (IPC timeout, permission, etc.) ---
  if (error && wallpapers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-md bg-destructive/10">
            <Image className="size-6 text-destructive" />
          </div>
          <div>
            <p className="text-[11px] font-normal text-danger">{t.weLoadFailed}</p>
            <p className="mt-1 max-w-[260px] text-[10px] text-muted-foreground">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void initialize()}
            className="rounded-sm border border-destructive/30 bg-surface px-2 py-1 text-[10px] font-normal text-destructive transition-colors hover:bg-destructive/10"
          >
            {t.weRetry}
          </button>
        </div>
      </div>
    );
  }

  // --- Not installed hint ---
  if (installed === false && wallpapers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-md bg-card2">
            <Image className="size-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[11px] font-normal">{t.weNotInstalled}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{t.weNotInstalledHint}</p>
          </div>
          <button
            type="button"
            onClick={() => void importWallpaper()}
            className="rounded-sm bg-primary px-2 py-1 text-[10px] font-normal text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t.wallpaperImport}
          </button>
        </div>
      </div>
    );
  }

  // --- Main content: toolbar + grid + detail sidebar ---
  return (
    <div className="we-app flex h-full min-h-0 flex-col min-w-0">
      {/* Page header */}
      <PageHeader title={t.wallpaperSection} description={t.wePageDesc} count={wallpapers.length}>
        <button
          type="button"
          onClick={() => void importWallpaper()}
          className="flex items-center gap-1 rounded-sm bg-surface px-2 py-1 text-[10px] font-normal transition-colors hover:border-primary hover:text-primary"
        >
          <Download className="size-3" />
          {t.wallpaperImport}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{t.wallpaperEnable}</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void setWallpaper(v, v ? selectedId : null)}
          />
        </div>
      </PageHeader>

      {/* Toolbar: search + sort + segmented type filter */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t.weSearchPlaceholder,
        }}
        sort={{
          value: sortBy,
          options: [
            { value: 'title', label: t.weSortTitle },
            { value: 'size', label: t.weSortSize },
          ],
          onChange: setSortBy,
        }}
        left={
          <FilterChips
            options={[
              { value: 'all', label: t.weFilterAll },
              { value: 'video', label: t.weFilterVideo, icon: Video },
              { value: 'image', label: t.weFilterImage, icon: Image },
              { value: 'web', label: t.weFilterWeb },
              { value: 'scene', label: t.weFilterScene },
            ]}
            value={filter}
            onChange={setFilter}
            className="gap-1"
          />
        }
      />

      {/* Grid + detail sidebar (desktop) / Sheet (mobile) */}
      <div className="flex min-h-0 flex-1">
        <div className="we-grid min-h-0 flex-1 overflow-y-auto p-2">
          <WallpaperGrid
            wallpapers={filtered}
            selectedId={selected?.id ?? null}
            isUiBackground={(wp: WallpaperInfo) => enabled && selectedId === wp.id}
            t={t}
            onSelect={selectWallpaper}
            deletingId={deletingId}
            onDelete={handleDelete}
            onEmptyNode={
              <EmptyState icon={<Image className="size-8" />} title={t.weEmpty} />
            }
          />
        </div>

        {/* Desktop: right detail panel (visible md+) */}
        {selected && (
          <div className="hidden md:block">
            <InjectResultsPanel
              selected={selected}
              renderDraft={renderDraft}
              isUiBackground={enabled && selectedId === selected.id}
              enabled={enabled}
              onSetUiBackground={handleSetUiBackground}
              onRenderDraftChange={setRenderDraft}
              applyingTo={applyingTo}
              batchProgress={batchProgress}
              injectResults={injectResults}
              runningAgentCount={runningAgentCount}
              readyAgentCount={readyAgentCount}
              appStatusFor={appStatusFor}
              agentWallpapers={agentWallpapers}
              isRefreshing={isRefreshing}
              relativeTime={relativeTime}
              selectedVideo={selectedVideo}
              onClose={() => page.setSelected(null)}
              onApply={handleApplyAgent}
              onRemove={page.handleRemove}
              onApplyAll={handleApplyAllAgents}
              t={t}
            />
          </div>
        )}
      </div>

      {/* Mobile: bottom sheet for selected wallpaper (<md) */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && page.setSelected(null)}>
        <SheetContent
          side="bottom"
          overlayClassName="md:hidden"
          className="h-[80svh] overflow-y-auto rounded-t-md p-0 md:hidden"
        >
          {selected && (
            <InjectResultsPanel
              selected={selected}
              renderDraft={renderDraft}
              isUiBackground={enabled && selectedId === selected.id}
              enabled={enabled}
              onSetUiBackground={handleSetUiBackground}
              onRenderDraftChange={setRenderDraft}
              applyingTo={applyingTo}
              batchProgress={batchProgress}
              injectResults={injectResults}
              runningAgentCount={runningAgentCount}
              readyAgentCount={readyAgentCount}
              appStatusFor={appStatusFor}
              agentWallpapers={agentWallpapers}
              isRefreshing={isRefreshing}
              relativeTime={relativeTime}
              selectedVideo={selectedVideo}
              onClose={() => page.setSelected(null)}
              onApply={handleApplyAgent}
              onRemove={page.handleRemove}
              onApplyAll={handleApplyAllAgents}
              t={t}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

