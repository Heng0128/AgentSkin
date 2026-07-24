// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Progress } from '@/components/ui/progress';
import { AgentStatusDot } from '@/components/workspace/AgentStatusDot';
import type { AppController } from '@/hooks/useAppController';
import { useNotifications } from '@/hooks/useNotifications';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { cn } from '@/lib/utils';

import {
  CheckmarkCircle02Icon,
  Download01Icon,
  Image02Icon,
  Search01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons';
import type { AgentId, WallpaperInfo } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';

type TypeFilter = 'all' | 'video' | 'image';

/** Apple-style iOS switch. */
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-muted-foreground/25',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
          checked ? 'translate-x-[16px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/**
 * # WallpaperEnginePage
 *
 * Unified wallpaper page: browse Wallpaper Engine workshop wallpapers (dynamic
 * + static), apply them to individual agents via CDP injection, and toggle
 * AgentSkin's own animated background.
 */
export function WallpaperEnginePage({ controller }: { controller: AppController }) {
  const { t, wallpaper, appStatusFor } = controller;
  const { showToast } = useNotifications(t);
  const {
    wallpapers,
    loading,
    enabled,
    selectedId,
    agentWallpapers,
    setWallpaper,
    importWallpaper,
    deleteWallpaper,
    setAndApplyAgentWallpaper,
    setAgentWallpaper,
  } = wallpaper;

  const [installed, setInstalled] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WallpaperInfo | null>(null);
  const [applyingTo, setApplyingTo] = useState<AgentId | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  /** Persistent per-agent injection result (survives until next action on that agent). */
  const [injectResults, setInjectResults] = useState<Partial<Record<AgentId, 'ok' | 'fail'>>>({});

  // Detect Wallpaper Engine installation on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detection = await api.weDetect();
        if (!cancelled) setInstalled(detection.installed);
      } catch {
        if (!cancelled) setInstalled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Shared relative-time hook drives the detail-panel hint's "updated Ns ago"
  // stamp. The global status poll (3s, in useBoot) keeps data fresh.
  const relativeTime = useRelativeTime(
    controller.lastStatusAt,
    controller.isRefreshing,
    controller.t,
  );

  const filtered = useMemo(() => {
    let list = wallpapers;
    if (filter !== 'all') list = list.filter((w) => w.type === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(q) || w.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [wallpapers, filter, search]);

  const videoCount = useMemo(
    () => wallpapers.filter((w) => w.type === 'video').length,
    [wallpapers],
  );
  const imageCount = wallpapers.length - videoCount;

  // Count running agents for the status hint in the detail panel.
  const runningAgentCount = useMemo(
    () => AGENT_IDS.filter((id) => appStatusFor(id)?.running).length,
    [appStatusFor],
  );
  // Count CDP-ready agents (can inject immediately without restart).
  const readyAgentCount = useMemo(
    () => AGENT_IDS.filter((id) => appStatusFor(id)?.debugReady).length,
    [appStatusFor],
  );

  const handleApply = useCallback(
    async (wallpaperId: string, agentId: AgentId) => {
      setApplyingTo(agentId);
      setInjectResults((prev) => ({ ...prev, [agentId]: undefined }));
      const name = AGENT_META[agentId].displayName;
      showToast(t.weInjecting(name));
      try {
        const result = await setAndApplyAgentWallpaper(agentId, true, wallpaperId);
        if (result.ok) {
          showToast(t.weInjected(name));
          setInjectResults((prev) => ({ ...prev, [agentId]: 'ok' }));
        } else {
          showToast(
            result.reason === 'agent-not-running' ? t.weAgentNotRunning(name) : t.weApplyFailed,
            'destructive',
          );
          setInjectResults((prev) => ({ ...prev, [agentId]: 'fail' }));
        }
      } catch {
        showToast(t.weApplyFailed, 'destructive');
        setInjectResults((prev) => ({ ...prev, [agentId]: 'fail' }));
      } finally {
        setApplyingTo(null);
      }
    },
    [setAndApplyAgentWallpaper, showToast, t],
  );

  const handleRemove = useCallback(
    async (agentId: AgentId) => {
      const name = AGENT_META[agentId].displayName;
      setApplyingTo(agentId);
      setInjectResults((prev) => ({ ...prev, [agentId]: undefined }));
      try {
        await setAgentWallpaper(agentId, false, null);
        await api.removeWallpaperFromAgent(agentId);
        showToast(t.weRemoved(name));
      } catch {
        /* best-effort */
      } finally {
        setApplyingTo(null);
      }
    },
    [setAgentWallpaper, showToast, t],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteWallpaper(id);
        if (selected?.id === id) setSelected(null);
        showToast(t.wallpaperDeleted);
      } catch {
        showToast(t.wallpaperDeleteFailed, 'destructive');
      } finally {
        setDeletingId(null);
      }
    },
    [deleteWallpaper, selected, showToast, t],
  );

  /** Apply the selected wallpaper to every running agent sequentially. */
  const handleApplyAll = useCallback(
    async (wallpaperId: string) => {
      const targets = AGENT_IDS.filter((id) => appStatusFor(id)?.running);
      if (targets.length === 0) {
        showToast(t.weNoRunningAgents, 'destructive');
        return;
      }
      setBatchProgress({ done: 0, total: targets.length });
      setInjectResults((prev) => {
        const cleared = { ...prev };
        for (const id of targets) cleared[id] = undefined;
        return cleared;
      });
      let ok = 0;
      for (let i = 0; i < targets.length; i++) {
        const agentId = targets[i];
        setApplyingTo(agentId);
        try {
          const result = await setAndApplyAgentWallpaper(agentId, true, wallpaperId);
          if (result.ok) {
            ok++;
            setInjectResults((prev) => ({ ...prev, [agentId]: 'ok' }));
          } else {
            setInjectResults((prev) => ({ ...prev, [agentId]: 'fail' }));
          }
        } catch {
          setInjectResults((prev) => ({ ...prev, [agentId]: 'fail' }));
        }
        setBatchProgress({ done: i + 1, total: targets.length });
      }
      setApplyingTo(null);
      setBatchProgress(null);
      showToast(
        t.weApplyAllDone(ok, targets.length),
        ok === targets.length ? 'default' : 'destructive',
      );
    },
    [appStatusFor, setAndApplyAgentWallpaper, showToast, t],
  );

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          <p className="text-sm">{t.weDetecting}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-[-0.01em]">{t.navWallpaperEngine}</h2>
            {wallpapers.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {wallpapers.length}
              </Badge>
            )}
            {wallpapers.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {t.weStats(videoCount, imageCount)}
              </span>
            )}
          </div>
          {/* AgentSkin background toggle + import */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void importWallpaper()}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HugeIcon icon={Download01Icon} className="size-3" />
              {t.wallpaperImport}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t.wallpaperEnable}</span>
              <Switch
                checked={enabled}
                onChange={(v) => void setWallpaper(v, v ? selectedId : null)}
              />
            </div>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t.wePageDesc}</p>
      </div>

      {/* Not installed hint (non-blocking — still shows local imports) */}
      {installed === false && wallpapers.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
              <HugeIcon icon={Image02Icon} className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t.weNotInstalled}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.weNotInstalledHint}</p>
            </div>
            <button
              type="button"
              onClick={() => void importWallpaper()}
              className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              {t.wallpaperImport}
            </button>
          </div>
        </div>
      )}

      {/* Main content (when wallpapers exist or WE is installed) */}
      {(installed !== false || wallpapers.length > 0) && (
        <>
          {/* Toolbar: search + type filter */}
          <div className="flex items-center gap-3 border-b px-6 py-3">
            <div className="relative max-w-xs flex-1">
              <HugeIcon
                icon={Search01Icon}
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.weSearchPlaceholder}
                className="h-8 w-full rounded-lg border bg-background pl-8 pr-3 text-xs outline-none transition-colors focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
              {(['all', 'video', 'image'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                    filter === f
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f === 'video' && <HugeIcon icon={Video01Icon} className="size-3" />}
                  {f === 'image' && <HugeIcon icon={Image02Icon} className="size-3" />}
                  {f === 'all' ? t.weFilterAll : f === 'video' ? t.weFilterVideo : t.weFilterImage}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {filtered.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {t.weEmpty}
              </div>
            ) : (
              <div className={cn('grid gap-3', gridClass(filtered.length))}>
                {filtered.map((wp, i) => (
                  <WallpaperCard
                    key={wp.id}
                    wallpaper={wp}
                    index={i}
                    selected={selected?.id === wp.id}
                    isUiBackground={enabled && selectedId === wp.id}
                    onSelect={() => setSelected(wp)}
                    deletable={wp.source === 'local' && wp.id.startsWith('local:')}
                    isDeleting={deletingId === wp.id}
                    onDelete={() => void handleDelete(wp.id)}
                    deleteLabel={t.wallpaperDelete}
                    confirmLabel={t.wallpaperDeleteConfirm}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel (bottom sheet) */}
          {selected && (
            <div className="border-t bg-background/95 px-6 py-4 backdrop-blur-sm">
              {/* Batch progress bar */}
              {batchProgress && (
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t.weApplyingAll(batchProgress.done, batchProgress.total)}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-4">
                {/* Preview thumbnail */}
                <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {selected.previewDataUrl ? (
                    <img src={selected.previewDataUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <HugeIcon
                        icon={selected.type === 'video' ? Video01Icon : Image02Icon}
                        className="size-6 text-muted-foreground"
                      />
                    </div>
                  )}
                </div>

                {/* Info + actions */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{selected.title}</h3>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {selected.type === 'video' ? t.weFilterVideo : t.weFilterImage}
                    </Badge>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {selected.source === 'workshop' ? 'Workshop' : t.weFilterLocal}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatSize(selected.sizeBytes)}
                    {selected.tags.length > 0 && ` · ${selected.tags.slice(0, 3).join(', ')}`}
                  </p>

                  {/* Actions row: set as UI background + agent apply buttons */}
                  <div className="mt-3 flex items-center gap-3">
                    {/* Set as AgentSkin background */}
                    <button
                      type="button"
                      onClick={() => void setWallpaper(true, selected.id)}
                      className={cn(
                        'rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                        enabled && selectedId === selected.id
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {enabled && selectedId === selected.id
                        ? t.wallpaperSelected
                        : t.wallpaperEnable}
                    </button>

                    <div className="h-4 w-px bg-border" />

                    {/* Agent apply buttons — 5-state precision */}
                    {AGENT_IDS.map((agentId) => {
                      const agentSetting = agentWallpapers[agentId] ?? { enabled: false, id: null };
                      const isApplied = agentSetting.enabled && agentSetting.id === selected.id;
                      const isApplying = applyingTo === agentId;
                      const status = appStatusFor(agentId);
                      const isInstalled = status?.installed ?? false;
                      const isRunning = status?.running ?? false;
                      const isReady = status?.debugReady ?? false;
                      const lastResult = injectResults[agentId];
                      // Determine precise state label
                      const stateLabel = isApplying
                        ? t.weStatusInjecting
                        : isApplied
                          ? t.weStatusApplied
                          : lastResult === 'fail'
                            ? t.weStatusFailed
                            : !isInstalled
                              ? t.weStatusNotInstalled
                              : !isRunning
                                ? t.weStatusOffline
                                : isReady
                                  ? t.weStatusReady
                                  : t.weStatusRunning;
                      // Can inject if running (ensureCdpReady will enable CDP)
                      const canInject = isRunning && !isApplying;
                      return (
                        <div key={agentId} className="flex flex-col items-center gap-1">
                          <button
                            onClick={() =>
                              isApplied ? handleRemove(agentId) : handleApply(selected.id, agentId)
                            }
                            disabled={!canInject && !isApplied}
                            title={`${AGENT_META[agentId].displayName} · ${stateLabel}${status?.port ? ` · :${status.port}` : ''}`}
                            className={cn(
                              'relative flex size-9 items-center justify-center rounded-xl border transition-all duration-300',
                              isApplied
                                ? 'border-emerald-400/60 bg-emerald-500/10 ring-1 ring-emerald-400/40'
                                : lastResult === 'fail'
                                  ? 'border-red-400/50 bg-red-500/5 ring-1 ring-red-400/30'
                                  : isReady
                                    ? 'border-cyan-400/50 bg-cyan-500/5 hover:border-cyan-400/70 hover:bg-cyan-500/10'
                                    : isRunning
                                      ? 'border-blue-400/40 bg-blue-500/5 hover:border-blue-400/60 hover:bg-blue-500/10'
                                      : isInstalled
                                        ? 'border-amber-400/30 bg-amber-500/5 opacity-60'
                                        : 'border-border/40 bg-muted/20 opacity-35 cursor-not-allowed',
                              isApplying && 'opacity-60 scale-95',
                            )}
                          >
                            {isApplying ? (
                              <div className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground" />
                            ) : isApplied ? (
                              <HugeIcon
                                icon={CheckmarkCircle02Icon}
                                className="size-4.5 text-emerald-500"
                              />
                            ) : (
                              <AppMark appId={agentId} size={18} />
                            )}
                            {/* Multi-state status dot */}
                            {!isApplying && (
                              <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                                {/* Ping animation only for CDP-ready (not yet applied) */}
                                {isReady && !isApplied && lastResult !== 'fail' && (
                                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                                )}
                                <span
                                  className={cn(
                                    'relative inline-flex size-2.5 rounded-full ring-2 ring-background transition-colors duration-500',
                                    isApplied
                                      ? 'bg-emerald-500'
                                      : lastResult === 'fail'
                                        ? 'bg-red-500'
                                        : isReady
                                          ? 'bg-cyan-400'
                                          : isRunning
                                            ? 'bg-blue-400'
                                            : isInstalled
                                              ? 'bg-amber-400/70'
                                              : 'bg-transparent',
                                  )}
                                />
                              </span>
                            )}
                          </button>
                          {/* Precise state label */}
                          <span
                            className={cn(
                              'max-w-[3.5rem] truncate text-center text-[9px] leading-tight transition-colors duration-500',
                              isApplied
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : lastResult === 'fail'
                                  ? 'text-red-500'
                                  : isReady
                                    ? 'text-cyan-600 dark:text-cyan-400'
                                    : isRunning
                                      ? 'text-blue-500 dark:text-blue-400'
                                      : 'text-muted-foreground/60',
                            )}
                          >
                            {stateLabel}
                          </span>
                        </div>
                      );
                    })}

                    {/* Apply to all running agents */}
                    <button
                      type="button"
                      onClick={() => void handleApplyAll(selected.id)}
                      disabled={!!batchProgress || !!applyingTo || runningAgentCount === 0}
                      title={
                        runningAgentCount > 0
                          ? t.weRunningAgents(runningAgentCount)
                          : t.weNoRunningAgents
                      }
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                        batchProgress || applyingTo
                          ? 'border-muted bg-muted text-muted-foreground opacity-60'
                          : runningAgentCount > 0
                            ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                            : 'border-border/50 bg-muted/20 text-muted-foreground opacity-40 cursor-not-allowed',
                      )}
                    >
                      {batchProgress
                        ? t.weApplyingAll(batchProgress.done, batchProgress.total)
                        : t.weApplyAll}
                    </button>
                  </div>

                  {/* Running agents hint (live) */}
                  <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <AgentStatusDot
                      size="xs"
                      variant={
                        controller.isRefreshing
                          ? 'refreshing'
                          : runningAgentCount > 0
                            ? 'active'
                            : 'offline'
                      }
                    />
                    {runningAgentCount > 0
                      ? t.weRunningAgents(runningAgentCount)
                      : t.weNoRunningAgents}
                    {readyAgentCount > 0 && readyAgentCount < runningAgentCount && (
                      <span className="text-cyan-500 dark:text-cyan-400">
                        {`(${readyAgentCount} ${t.weStatusReady})`}
                      </span>
                    )}
                    <span className="mx-1">·</span>
                    {relativeTime}
                  </p>
                </div>

                {/* Close */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-xs"
                >
                  {t.weClose}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Sub-components ---

function WallpaperCard({
  wallpaper,
  index,
  selected,
  isUiBackground,
  deletable,
  isDeleting,
  onSelect,
  onDelete,
  deleteLabel,
  confirmLabel,
}: {
  wallpaper: WallpaperInfo;
  index: number;
  selected: boolean;
  isUiBackground: boolean;
  deletable: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleteLabel: string;
  confirmLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 animate-card-enter',
        'hover:-translate-y-0.5 hover:shadow-md',
        selected
          ? 'border-primary/50 shadow-sm ring-1 ring-primary/30'
          : 'border-border hover:border-primary/30',
      )}
    >
      <button onClick={onSelect} className="flex flex-1 flex-col">
        {/* Preview */}
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {wallpaper.previewDataUrl ? (
            <img
              src={wallpaper.previewDataUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <HugeIcon
                icon={wallpaper.type === 'video' ? Video01Icon : Image02Icon}
                className="size-8 text-muted-foreground/40"
              />
            </div>
          )}
          {/* Type badge */}
          <span
            className={cn(
              'absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm',
              wallpaper.type === 'video'
                ? 'bg-violet-500/80 text-white'
                : 'bg-sky-500/80 text-white',
            )}
          >
            <HugeIcon
              icon={wallpaper.type === 'video' ? Video01Icon : Image02Icon}
              className="size-2.5"
            />
            {wallpaper.type === 'video' ? '动态' : '静态'}
          </span>
          {/* UI background indicator */}
          {isUiBackground && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-primary/90 px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
              UI
            </span>
          )}
          {/* Source badge for local imports */}
          {wallpaper.source === 'local' && (
            <span className="absolute right-1.5 top-1.5 rounded-md bg-amber-500/80 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
              本地
            </span>
          )}
        </div>

        {/* Title */}
        <div className="px-3 py-2">
          <p className="truncate text-xs font-medium">{wallpaper.title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {formatSize(wallpaper.sizeBytes)}
          </p>
        </div>
      </button>

      {/* Delete button for local wallpapers */}
      {deletable && (
        <div className="absolute left-1.5 bottom-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {confirming ? (
            <div className="flex items-center gap-1 rounded-lg bg-background/95 px-1 py-0.5 shadow-md backdrop-blur">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                  setConfirming(false);
                }}
                disabled={isDeleting}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isDeleting ? '…' : confirmLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              className="rounded-lg bg-background/95 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-red-500/10 hover:text-red-600"
            >
              {deleteLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-sm';
  if (count === 2) return 'grid-cols-2 max-w-lg';
  if (count === 3) return 'grid-cols-3';
  if (count === 4) return 'grid-cols-2 max-w-lg';
  if (count <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
