// SPDX-License-Identifier: MPL-2.0

/**
 * # WallpaperEnginePage
 *
 * 编排层：组合 toolbar + grid + detail sidebar，自身不含业务逻辑。
 * 状态/副作用/handler 全部委托给 useWallpaperPageController hook。
 */

import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { InjectResultsPanel } from '@/components/wallpaper/InjectResultsPanel';
import { WallpaperGrid } from '@/components/wallpaper/WallpaperGrid';
import type { AppController, useAppController } from '@/hooks/useAppController';
import { useWallpaperPageController } from '@/hooks/useWallpaperPageController';

import type { WallpaperInfo } from '@shared/types';
import { Download, Image, Search, Video } from 'lucide-react';

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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          <p className="text-sm">{t.weDetecting}</p>
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
            <p className="font-display text-sm font-bold text-destructive">{t.weLoadFailed}</p>
            <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void initialize()}
            className="rounded-md border border-destructive/30 bg-card2 px-3 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
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
            <p className="font-display text-sm font-bold">{t.weNotInstalled}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.weNotInstalledHint}</p>
          </div>
          <button
            type="button"
            onClick={() => void importWallpaper()}
            className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
      {/* Toolbar: search + sort + segmented type filter */}
      <Toolbar
        t={t}
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        filter={filter}
        onFilterChange={setFilter}
        enabled={enabled}
        onToggleEnabled={(v) => void setWallpaper(v, v ? selectedId : null)}
        onImport={() => void importWallpaper()}
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
            onEmptyNode={t.weEmpty}
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

// ── Sub-components ──────────────────────────────────────────────────────

interface ToolbarProps {
  t: ReturnType<typeof useAppController>['t'];
  search: string;
  onSearchChange: (v: string) => void;
  sortBy: 'title' | 'size';
  onSortByChange: (v: 'title' | 'size') => void;
  filter: string;
  onFilterChange: (v: 'all' | 'video' | 'image' | 'web' | 'scene') => void;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  onImport: () => void;
}

function Toolbar({
  t,
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  filter,
  onFilterChange,
  enabled,
  onToggleEnabled,
  onImport,
}: ToolbarProps) {
  return (
    <div className="we-sub flex flex-wrap items-center gap-[8px]  px-4 py-2">
      <div className="relative min-w-[180px] max-w-[240px] flex-1">
        <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.weSearchPlaceholder}
          className="h-7 w-full rounded-md border border-input bg-card2 pl-8 pr-3 font-mono text-[11px] outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
      </div>
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value as 'title' | 'size')}
        aria-label={sortBy === 'title' ? t.weSortTitle : t.weSortSize}
        className="h-7 rounded-md border border-input bg-card px-2 font-mono text-[10px] text-muted-foreground outline-none transition-colors focus:border-primary"
      >
        <option value="title">{t.weSortTitle}</option>
        <option value="size">{t.weSortSize}</option>
      </select>
      <SegmentedControl
        size="sm"
        value={filter}
        onChange={(v) => onFilterChange(v as 'all' | 'video' | 'image' | 'web' | 'scene')}
        options={(['all', 'video', 'image', 'web', 'scene'] as const).map((f) => ({
          value: f,
          label:
            f === 'all'
              ? t.weFilterAll
              : f === 'video'
                ? t.weFilterVideo
                : f === 'image'
                  ? t.weFilterImage
                  : f === 'web'
                    ? t.weFilterWeb
                    : t.weFilterScene,
          icon: f === 'video' ? Video : f === 'image' ? Image : undefined,
        }))}
      />
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onImport}
          className="flex items-center gap-1 rounded-md  bg-card2 px-2 py-1 as-label transition-colors hover:border-primary hover:text-primary"
        >
          <Download className="size-3" />
          {t.wallpaperImport}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t.wallpaperEnable}</span>
          <Switch checked={enabled} onCheckedChange={onToggleEnabled} />
        </div>
      </div>
    </div>
  );
}
