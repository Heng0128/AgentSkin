// SPDX-License-Identifier: MPL-2.0

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Spinner } from '@/components/ui/spinner';
import { AgentStatusDot } from '@/components/workspace/AgentStatusDot';
import type { AppController } from '@/hooks/useAppController';
import { useNotifications } from '@/hooks/useNotifications';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { cn } from '@/lib/utils';
import { useWallpaperVideoUrl } from '@/lib/wallpaperVideo';

import {
  CheckmarkCircle02Icon,
  Download01Icon,
  Image02Icon,
  Search01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import type { AgentId, WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { AGENT_IDS, AGENT_META, WALLPAPER_ALIGNMENTS } from '@shared/types';

type TypeFilter = 'all' | 'video' | 'image' | 'web' | 'scene';

/** Swiss toggle switch — 34×20, rounded-full, red when active, 14px knob with slide animation (matches A.html .sw). */
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full transition-colors duration-base ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/50 border',
        checked ? 'bg-primary border-primary' : 'bg-card2 border-[var(--border2)]',
      )}
    >
      <span
        className={cn(
          'inline-block size-[14px] rounded-full shadow-sm transition-transform duration-base',
          checked ? 'bg-background translate-x-[17px]' : 'bg-muted-foreground translate-x-[2px]',
        )}
      />
    </button>
  );
}

/**
 * Map a wallpaper injection `detail` verdict to a human-readable, localized
 * failure message. The engine emits raw verdicts like
 * `stream:loadfail:src-not-supported`, `image:loadfail:csp-or-unsupported`,
 * `cdp-connect-failed:CDP request timed out`, which are meaningless to users.
 *
 * Classification priority (a detail string may carry multiple per-target
 * verdicts joined by `, ` or `|`):
 * 1. Codec unsupported — `src-not-supported` (video.error.code === 4). The
 *    stream→blob fallback cannot fix this (same codec), so the only remedy is
 *    transcoding. Surfaced with an actionable "transcode to H.264" hint.
 * 2. CDP connect / timeout — `cdp-connect-failed` or `CDP request timed out`
 *    or `WebSocket closed`. Usually transient; retry after confirming the app
 *    is running.
 * 3. CSP / media load failure — `loadfail:csp-or-unsupported`, `loadfail`
 *    without a codec code, `blob:loadfail`. Indicates the app's CSP blocked
 *    the media source or the media failed to decode.
 * 4. Other / unknown — fallback.
 *
 * Returns the localized message; never returns the raw verdict.
 */
function describeWallpaperFailure(detail: string | undefined, t: UiMessages): string {
  if (!detail) return t.wpFailUnknown;
  const lower = detail.toLowerCase();
  // Codec not supported (MEDIA_ERR_SRC_NOT_SUPPORTED). Highest priority: the
  // fallback path can't help, so the user MUST transcode.
  if (lower.includes('src-not-supported')) return t.wpFailCodec;
  // CDP transport failures: connect refused, command timeout, socket closed.
  if (
    lower.includes('cdp-connect-failed') ||
    lower.includes('timed out') ||
    lower.includes('websocket closed') ||
    lower.includes('cdp request')
  ) {
    return t.wpFailCdp;
  }
  // Visibility probe failure: media loaded but wallpaper is not visible
  // (punch-through failed, element removed by React, or clipped). Retry
  // usually fixes this because the punch-through is timing-sensitive.
  if (lower.includes('invisible')) {
    return t.wpFailInvisible;
  }
  // CSP block or generic media load failure (not codec-specific).
  if (
    lower.includes('csp-or-unsupported') ||
    lower.includes('loadfail') ||
    lower.includes('blob:loadfail') ||
    lower.includes('stream:loadfail')
  ) {
    return t.wpFailCsp;
  }
  return t.wpFailOther;
}

/**
 * # WallpaperEnginePage
 *
 * Unified wallpaper page: browse Wallpaper Engine workshop wallpapers (dynamic
 * + static), apply them to individual agents via CDP injection, and toggle
 * AgentSkin's own animated background.
 */
export function WallpaperEnginePage({ controller }: { controller: AppController }) {
  const { t, wallpaper, appStatusFor, setWallpaperRestartPrompt } = controller;
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
  // WE-style sort: by title (asc) or by size (desc).
  const [sortBy, setSortBy] = useState<'title' | 'size'>('title');
  const [selected, setSelected] = useState<WallpaperInfo | null>(null);
  /** 渲染设置草稿（对齐/位置/翻转/滤镜/视差/音频等），编辑后随「设为 UI 背景」
   *  或「应用到 agent」一起持久化；未编辑时为 undefined（用全局默认/主题默认）。 */
  const [renderDraft, setRenderDraft] = useState<WallpaperRenderOptions | undefined>(undefined);
  const [applyingTo, setApplyingTo] = useState<AgentId | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  /** Persistent per-agent injection result (survives until next action on that agent).
   *  `detail` carries the per-target verdicts for precise failure diagnosis. */
  const [injectResults, setInjectResults] = useState<
    Partial<Record<AgentId, { status: 'ok' | 'fail'; detail?: string }>>
  >({});
  // Streaming loopback URL for the selected wallpaper's media (video/gif only).
  const selectedVideo = useWallpaperVideoUrl(
    selected && (selected.playback === 'video' || selected.playback === 'gif') ? selected.id : null,
  );

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
    // WE-style sort: title A→Z, or size large→small.
    const sorted = [...list].sort((a, b) =>
      sortBy === 'title' ? a.title.localeCompare(b.title, 'zh-Hans-CN') : b.sizeBytes - a.sizeBytes,
    );
    return sorted;
  }, [wallpapers, filter, search, sortBy]);

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
        const result = await setAndApplyAgentWallpaper(agentId, true, wallpaperId, {
          render: renderDraft,
        });
        if (result.ok) {
          showToast(t.weInjected(name));
          setInjectResults((prev) => ({ ...prev, [agentId]: { status: 'ok' } }));
        } else if (result.reason === 'requires-restart') {
          // Agent is not CDP-ready — prompt the user for explicit consent.
          // NEVER auto-restart/launch: the hard constraint forbids restarting
          // an agent without the user's permission. `restartReason` lets the
          // dialog show specific guidance (e.g. "not-running" → the agent will
          // be launched from its install path after confirmation).
          setWallpaperRestartPrompt({
            appId: agentId,
            wallpaperId,
            restartReason: result.restartReason,
          });
          setInjectResults((prev) => ({
            ...prev,
            [agentId]: { status: 'fail', detail: 'requires-restart' },
          }));
        } else {
          // Surface a human-readable failure reason. `detail` carries raw
          // per-target verdicts (e.g. "image:loadfail:csp-or-unsupported",
          // "stream:loadfail:src-not-supported") that are meaningless to users.
          // `describeWallpaperFailure` maps them to actionable guidance:
          // codec-not-supported (transcode hint), CDP/timeout (retry hint),
          // CSP/load-failure, or a generic fallback.
          const baseMsg =
            result.reason === 'agent-not-running'
              ? t.weAgentNotRunning(name)
              : result.reason === 'agent-not-installed'
                ? t.weAgentNotInstalled(name)
                : describeWallpaperFailure(result.detail, t);
          showToast(baseMsg, 'destructive');
          setInjectResults((prev) => ({
            ...prev,
            [agentId]: { status: 'fail', detail: result.detail },
          }));
        }
      } catch {
        showToast(t.weApplyFailed, 'destructive');
        setInjectResults((prev) => ({ ...prev, [agentId]: { status: 'fail' } }));
      } finally {
        setApplyingTo(null);
      }
    },
    [setAndApplyAgentWallpaper, showToast, t, setWallpaperRestartPrompt, renderDraft],
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

  /** Apply the selected wallpaper to every running agent, with a bounded
   *  concurrency pool so a large agent fleet doesn't trigger a CDP storm. */
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

      const CONCURRENCY = 4;
      let cursor = 0;
      // 成功计数用 worker 局部变量累加（P3-7 之前试图在 setState updater 里读取
      // latest snapshot，但 updater 要等渲染期才执行，紧随其后的 showToast 拿到的
      // finalOk 恒为 0 —— toast 永远显示 "0/N 成功"）。JS 单线程下 await 边界之间
      // 的 read-modify-write 是无竞争的，这里直接在 worker 内累加、结束后读取。
      let okCount = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const idx = cursor++;
          if (idx >= targets.length) break;
          const agentId = targets[idx];
          setApplyingTo(agentId);
          try {
            const result = await setAndApplyAgentWallpaper(agentId, true, wallpaperId);
            if (result.ok) {
              okCount++;
              setInjectResults((prev) => ({ ...prev, [agentId]: { status: 'ok' } }));
            } else {
              setInjectResults((prev) => ({
                ...prev,
                [agentId]: { status: 'fail', detail: result.detail },
              }));
            }
          } catch {
            setInjectResults((prev) => ({ ...prev, [agentId]: { status: 'fail' } }));
          }
          // Fold the increment into the setState updater so the worker does
          // not share mutable let bindings — JS single-thread safety is not
          // obvious from a quick scan and this form removes the ambiguity.
          setBatchProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev));
        }
      };

      const poolSize = Math.min(CONCURRENCY, targets.length);
      await Promise.all(Array.from({ length: poolSize }, () => worker()));

      setApplyingTo(null);
      setBatchProgress(null);
      showToast(
        t.weApplyAllDone(okCount, targets.length),
        okCount === targets.length ? 'default' : 'destructive',
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
    <div className="we-app flex h-full min-h-0 flex-col min-w-0">
      {/* Not installed hint (non-blocking — still shows local imports) */}
      {installed === false && wallpapers.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-[2px] bg-card2">
              <HugeIcon icon={Image02Icon} className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-display text-sm font-bold">{t.weNotInstalled}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.weNotInstalledHint}</p>
            </div>
            <button
              type="button"
              onClick={() => void importWallpaper()}
              className="rounded-[2px] bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t.wallpaperImport}
            </button>
          </div>
        </div>
      )}

      {/* Main content (when wallpapers exist or WE is installed) */}
      {(installed !== false || wallpapers.length > 0) && (
        <>
          {/* Toolbar: search + sort + segmented type filter (WE-style sub-bar) */}
          <div className="we-sub flex items-center gap-[8px] border-b border-border px-[14px] py-[10px]">
            <div className="relative max-w-[240px] flex-1">
              <HugeIcon
                icon={Search01Icon}
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.weSearchPlaceholder}
                className="h-[30px] w-full rounded-[2px] border border-border bg-card2 pl-8 pr-3 font-mono text-[11px] outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            {/* Sort dropdown — WE-style */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'title' | 'size')}
              aria-label={sortBy === 'title' ? t.weSortTitle : t.weSortSize}
              className="h-[30px] rounded-[2px] border border-border bg-[var(--bg2)] px-2 font-mono text-[10.5px] text-muted-foreground outline-none transition-colors focus:border-primary"
            >
              <option value="title">{t.weSortTitle}</option>
              <option value="size">{t.weSortSize}</option>
            </select>
            <div className="we-tabs flex items-center gap-[2px] rounded-[2px] bg-[var(--bg2)] p-[2px]">
              {(['all', 'video', 'image', 'web', 'scene'] as const).map((f) => (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex items-center gap-1 rounded-[2px] px-[12px] py-[5px] font-medium text-[11px] transition-colors duration-fast',
                    filter === f
                      ? 'bg-card text-foreground font-semibold shadow-sm'
                      : 'text-muted-foreground/70 hover:text-foreground',
                  )}
                >
                  {f === 'video' && <HugeIcon icon={Video01Icon} className="size-2.5" />}
                  {f === 'image' && <HugeIcon icon={Image02Icon} className="size-2.5" />}
                  {f === 'all'
                    ? t.weFilterAll
                    : f === 'video'
                      ? t.weFilterVideo
                      : f === 'image'
                        ? t.weFilterImage
                        : f === 'web'
                          ? t.weFilterWeb
                          : t.weFilterScene}
                </button>
              ))}
            </div>
            {/* Import + enable toggle — pushed to the toolbar's right edge */}
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => void importWallpaper()}
                className="flex items-center gap-1.5 rounded-[2px] border border-[var(--border2)] bg-card2 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <HugeIcon icon={Download01Icon} className="size-3" />
                {t.wallpaperImport}
              </button>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                  {t.wallpaperEnable}
                </span>
                <Switch
                  checked={enabled}
                  onChange={(v) => void setWallpaper(v, v ? selectedId : null)}
                />
              </div>
            </div>
          </div>

          {/* Grid + detail sidebar — 左右两栏：左侧网格，右侧选中壁纸详情 */}
          <div className="flex min-h-0 flex-1">
            <div className="we-grid min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex h-40 items-center justify-center font-mono text-[11px] tracking-wider text-muted-foreground/60">
                  {t.weEmpty}
                </div>
              ) : (
                <div className={cn('grid gap-2', gridClass(filtered.length))}>
                  {filtered.map((wp, i) => (
                    <WallpaperCard
                      key={wp.id}
                      wallpaper={wp}
                      index={i}
                      selected={selected?.id === wp.id}
                      isUiBackground={enabled && selectedId === wp.id}
                      previewOnly={wp.previewOnly}
                      onSelect={() => setSelected(wp)}
                      deletable={wp.source === 'local' && wp.id.startsWith('local:')}
                      isDeleting={deletingId === wp.id}
                      onDelete={() => void handleDelete(wp.id)}
                      deleteLabel={t.wallpaperDelete}
                      confirmLabel={t.wallpaperDeleteConfirm}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Detail panel — 右侧侧栏（预览 + 信息 + 操作） */}
            {selected && (
              <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-card2">
                {/* 侧栏头 */}
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/60">
                    PREVIEW · DETAILS
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label={t.close}
                    className="flex size-5 items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {/* Batch progress bar */}
                  {batchProgress && (
                    <div className="mb-2 flex items-center gap-2">
                      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-slow"
                          style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                        {t.weApplyingAll(batchProgress.done, batchProgress.total)}
                      </span>
                    </div>
                  )}
                  {/* Preview — 宽幅预览 */}
                  <div className="aspect-video w-full shrink-0 overflow-hidden rounded-[2px] bg-[#000]">
                    <WallpaperPreview
                      key={selected.id}
                      playback={selected.playback}
                      mediaUrl={selectedVideo.url}
                      previewUrl={selected.previewUrl}
                      loading={selectedVideo.loading}
                      className="size-full object-cover"
                      loadingNode={
                        <div className="flex size-full items-center justify-center">
                          <Spinner className="size-5 text-muted-foreground/50" />
                        </div>
                      }
                      emptyNode={
                        <div className="flex size-full items-center justify-center">
                          <HugeIcon
                            icon={selected.type === 'video' ? Video01Icon : Image02Icon}
                            className="size-8 text-muted-foreground"
                          />
                        </div>
                      }
                    />
                  </div>

                  {/* Info + actions (Swiss) — 纵向堆叠 */}
                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-sm font-bold">{selected.title}</h3>
                      <span className="rounded-[2px] bg-muted px-1 py-0.5 font-mono text-[9px] tracking-wider text-muted-foreground">
                        {selected.type === 'video'
                          ? t.weFilterVideo
                          : selected.type === 'image'
                            ? t.weFilterImage
                            : selected.type === 'web'
                              ? t.weFilterWeb
                              : t.weFilterScene}
                      </span>
                      <span className="rounded-[2px] border border-border px-1 py-0.5 font-mono text-[9px] tracking-wider text-muted-foreground/60">
                        {selected.source === 'workshop'
                          ? 'WORKSHOP'
                          : t.weFilterLocal.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                      {formatSize(selected.sizeBytes)}
                      {selected.tags.length > 0 && (
                        <span className="opacity-60">
                          {' '}
                          · {selected.tags.slice(0, 3).join(' • ')}
                        </span>
                      )}
                    </p>

                    {/* Preview-only warning (Swiss mono) */}
                    {selected.previewOnly && (
                      <p className="mt-1.5 rounded-[2px] bg-cr-warning/10 px-2 py-1 font-mono text-[10px] leading-tight text-cr-warning">
                        {t.wePreviewOnlyHint}
                      </p>
                    )}

                    {/* Actions row: set as UI background + agent apply buttons */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* Set as AgentSkin background (Swiss primary) */}
                      <button
                        type="button"
                        onClick={() => void setWallpaper(true, selected.id, renderDraft)}
                        className={cn(
                          'rounded-[2px] px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors',
                          enabled && selectedId === selected.id
                            ? 'bg-primary text-primary-foreground'
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
                        const agentSetting = agentWallpapers[agentId] ?? {
                          enabled: false,
                          id: null,
                        };
                        const isApplied = agentSetting.enabled && agentSetting.id === selected.id;
                        const isApplying = applyingTo === agentId;
                        const status = appStatusFor(agentId);
                        const isInstalled = status?.installed ?? false;
                        const isRunning = status?.running ?? false;
                        const isReady = status?.debugReady ?? false;
                        const lastResult = injectResults[agentId];
                        const isFail = lastResult?.status === 'fail';
                        // Determine precise state label
                        const stateLabel = isApplying
                          ? t.weStatusInjecting
                          : isApplied
                            ? t.weStatusApplied
                            : isFail
                              ? t.weStatusFailed
                              : !isInstalled
                                ? t.weStatusNotInstalled
                                : !isRunning
                                  ? t.weStatusOffline
                                  : isReady
                                    ? t.weStatusReady
                                    : t.weStatusRunning;
                        // Can inject if running — if CDP isn't ready, the
                        // apply will return 'requires-restart' and the user
                        // will be prompted for explicit restart consent.
                        const canInject = isRunning && !isApplying && !selected.previewOnly;
                        // Tooltip includes the failure detail (verdicts) so the
                        // user can see WHY injection failed without opening logs.
                        const failDetail =
                          isFail && lastResult?.detail ? `\n${lastResult.detail}` : '';
                        return (
                          <div key={agentId} className="flex flex-col items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                isApplied
                                  ? handleRemove(agentId)
                                  : handleApply(selected.id, agentId)
                              }
                              disabled={!canInject && !isApplied}
                              title={`${AGENT_META[agentId].displayName} · ${stateLabel}${status?.port ? ` · :${status.port}` : ''}${failDetail}`}
                              className={cn(
                                'relative flex size-8 items-center justify-center rounded-[2px] border transition-all duration-slow',
                                isApplied
                                  ? 'border-cr-success/60 bg-cr-success/10'
                                  : isFail
                                    ? 'border-destructive/50 bg-destructive/5'
                                    : isReady
                                      ? 'border-cr-info/50 bg-cr-info/5 hover:border-cr-info/70 hover:bg-cr-info/10'
                                      : isRunning
                                        ? 'border-border bg-muted/30 hover:bg-muted'
                                        : isInstalled
                                          ? 'border-cr-warning/30 bg-cr-warning/5 opacity-60'
                                          : 'border-border/40 bg-muted/20 opacity-35 cursor-not-allowed',
                                isApplying && 'opacity-60 scale-95',
                              )}
                            >
                              {isApplying ? (
                                <div className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground" />
                              ) : isApplied ? (
                                <HugeIcon
                                  icon={CheckmarkCircle02Icon}
                                  className="size-4.5 text-cr-success"
                                />
                              ) : (
                                <AppMark appId={agentId} size={18} />
                              )}
                              {/* Multi-state status dot */}
                              {!isApplying && (
                                <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                                  {/* Ping animation only for CDP-ready (not yet applied) */}
                                  {isReady && !isApplied && !isFail && (
                                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                                  )}
                                  <span
                                    className={cn(
                                      'relative inline-flex size-2.5 rounded-full ring-2 ring-background transition-colors duration-slower',
                                      isApplied
                                        ? 'bg-cr-success'
                                        : isFail
                                          ? 'bg-destructive'
                                          : isReady
                                            ? 'bg-cyan-400'
                                            : isRunning
                                              ? 'bg-cr-info'
                                              : isInstalled
                                                ? 'bg-cr-warning/70'
                                                : 'bg-transparent',
                                    )}
                                  />
                                </span>
                              )}
                            </button>
                            {/* Precise state label (Swiss mono) */}
                            <span
                              className={cn(
                                'max-w-[3.5rem] truncate text-center font-mono text-[8px] tracking-wider leading-tight transition-colors duration-slower',
                                isApplied
                                  ? 'text-cr-success'
                                  : isFail
                                    ? 'text-destructive'
                                    : isReady
                                      ? 'text-cr-info'
                                      : isRunning
                                        ? 'text-muted-foreground'
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
                        disabled={
                          !!batchProgress ||
                          !!applyingTo ||
                          runningAgentCount === 0 ||
                          selected.previewOnly
                        }
                        title={
                          selected.previewOnly
                            ? t.wePreviewOnlyHint
                            : runningAgentCount > 0
                              ? t.weRunningAgents(runningAgentCount)
                              : t.weNoRunningAgents
                        }
                        className={cn(
                          'flex items-center gap-1.5 rounded-[2px] border border-border px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors',
                          batchProgress || applyingTo || selected.previewOnly
                            ? 'cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-60'
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

                    {/* Running agents hint (live, Swiss mono) */}
                    <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground">
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
                        <span className="text-cr-info">
                          {`(${readyAgentCount} ${t.weStatusReady})`}
                        </span>
                      )}
                      <span className="mx-1 opacity-40">·</span>
                      {relativeTime}
                    </p>
                  </div>

                  {/* 渲染设置面板 — 对齐 Wallpaper Engine 渲染面板：主题配色/速度/
                        对齐/位置/翻转/视差/图片筛选器/音频。编辑后随「设为 UI 背景」
                        或「应用到 agent」一起持久化。 */}
                  <div className="mt-3 border-t border-border pt-3">
                    <RenderSettingsPanel
                      value={renderDraft}
                      onChange={setRenderDraft}
                      playback={selected.playback}
                    />
                  </div>
                </div>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- WallpaperCard sub-component ---

/** 渲染设置面板（对齐 WE 渲染面板）。`value` 是编辑中的草稿（undefined =
 *  未自定义，用全局/主题默认）；`onChange` 更新草稿。滑块编辑即时更新草稿，
 *  持久化发生在点「设为 UI 背景」/「应用到 agent」时。 */
function RenderSettingsPanel({
  value,
  onChange,
  playback,
}: {
  value: WallpaperRenderOptions | undefined;
  onChange: (v: WallpaperRenderOptions | undefined) => void;
  playback: WallpaperInfo['playback'];
}) {
  const r = value ?? {};
  // 局部 setter：更新单个字段；全部字段都回默认时重置为 undefined。
  const set = (patch: Partial<WallpaperRenderOptions>) => {
    const next = { ...r, ...patch };
    const isEmpty =
      next.speed === undefined &&
      next.loop === undefined &&
      next.alignment === undefined &&
      next.positionX === undefined &&
      next.positionY === undefined &&
      next.flipH === undefined &&
      next.flipV === undefined &&
      next.parallax === undefined &&
      next.brightness === undefined &&
      next.contrast === undefined &&
      next.saturation === undefined &&
      next.hueRotate === undefined &&
      next.sepia === undefined &&
      next.grayscale === undefined &&
      next.blur === undefined &&
      next.tint === undefined &&
      next.audioLevel === undefined;
    onChange(isEmpty ? undefined : next);
  };
  const isVideo = playback === 'video';
  /** Swiss property row: 76px mono label + flex-1 range + 42px value (matches A.html .we-prow). */
  const slider = (
    label: string,
    key: keyof WallpaperRenderOptions,
    min: number,
    max: number,
    step = 1,
    display?: string,
  ) => (
    <div className="we-prow flex items-center gap-[9px]">
      <span className="w-[76px] shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={typeof r[key] === 'number' ? (r[key] as number) : min}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<WallpaperRenderOptions>)}
        className="we-range h-[3px] flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border2)] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-card [&::-webkit-slider-thumb]:shadow-sm"
      />
      <span className="w-[42px] text-right font-mono text-[10px] font-bold tabular-nums text-foreground">
        {display ?? (typeof r[key] === 'number' ? String(r[key]) : '默认')}
      </span>
    </div>
  );

  return (
    <div className="mt-[8px] grid grid-cols-2 gap-x-[9px] gap-y-[6px] rounded-[2px] border border-border bg-card2/80 p-[10px_14px_4px]">
      <div className="col-span-2 flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold tracking-[.14em] text-muted-foreground uppercase">
          RENDER_SETTINGS
        </span>
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="font-mono text-[9px] tracking-[.08em] text-muted-foreground/60 hover:text-primary"
        >
          RESET
        </button>
      </div>

      {/* 主题配色 tint (Swiss row) */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
          THEME_TINT
        </span>
        <input
          type="color"
          value={r.tint ?? '#c41e2a'}
          onChange={(e) => set({ tint: e.target.value })}
          className="h-[26px] w-[30px] cursor-pointer rounded-[2px] border border-[var(--border2)] bg-card2 p-[2px]"
        />
        <span className="w-[42px] text-right font-mono text-[10px] font-bold text-foreground">
          {r.tint ? r.tint.toUpperCase() : '默认'}
        </span>
      </div>

      {/* 对齐方式 (Swiss select) */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
          ALIGNMENT
        </span>
        <select
          value={r.alignment ?? 'fill'}
          onChange={(e) =>
            set({ alignment: e.target.value as WallpaperRenderOptions['alignment'] })
          }
          className="h-[26px] flex-1 rounded-[2px] border border-border bg-card2 px-1.5 py-0.5 font-mono text-[10px] tracking-wider"
        >
          {WALLPAPER_ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* 播放速度（仅视频） */}
      {isVideo &&
        slider('播放速度', 'speed', 25, 200, 5, r.speed !== undefined ? `${r.speed}x` : undefined)}
      {/* 循环（仅视频, Swiss inline) */}
      {isVideo && (
        <div className="we-prow flex items-center gap-[9px]">
          <span className="w-[76px] shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
            LOOP
          </span>
          <Switch checked={r.loop ?? true} onChange={(v) => set({ loop: v })} />
        </div>
      )}

      {slider(
        '位置 X',
        'positionX',
        -100,
        100,
        1,
        r.positionX !== undefined ? `${r.positionX}%` : undefined,
      )}
      {slider(
        '位置 Y',
        'positionY',
        -100,
        100,
        1,
        r.positionY !== undefined ? `${r.positionY}%` : undefined,
      )}
      {slider(
        '视差',
        'parallax',
        0,
        100,
        5,
        r.parallax !== undefined ? `${r.parallax}` : undefined,
      )}
      {slider(
        '音频响应',
        'audioLevel',
        0,
        100,
        5,
        r.audioLevel !== undefined ? `${r.audioLevel}` : undefined,
      )}

      {/* 翻转 (Swiss switches) */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
          FLIP
        </span>
        <span className="flex flex-1 items-center gap-[6px]">
          <button
            type="button"
            onClick={() => set({ flipH: !r.flipH })}
            className={cn(
              'h-[24px] flex-1 rounded-[2px] border border-[var(--border2)] bg-card2 font-mono text-[9.5px] font-semibold tracking-wider transition-colors',
              r.flipH ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
            )}
          >
            H ↕
          </button>
          <button
            type="button"
            onClick={() => set({ flipV: !r.flipV })}
            className={cn(
              'h-[24px] flex-1 rounded-[2px] border border-[var(--border2)] bg-card2 font-mono text-[9.5px] font-semibold tracking-wider transition-colors',
              r.flipV ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
            )}
          >
            V ↔
          </button>
        </span>
      </div>

      {/* 图片筛选器 (Swiss section header) */}
      <div className="col-span-2 mt-[6px] grid grid-cols-2 gap-x-[9px] gap-y-[9px]">
        <span className="col-span-2 flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[.14em] text-muted-foreground uppercase">
            IMAGE_FILTERS
          </span>
          <span className="h-px flex-1 bg-border" />
        </span>
        {slider(
          '亮度',
          'brightness',
          0,
          200,
          5,
          r.brightness !== undefined ? `${r.brightness}` : undefined,
        )}
        {slider(
          '对比度',
          'contrast',
          0,
          200,
          5,
          r.contrast !== undefined ? `${r.contrast}` : undefined,
        )}
        {slider(
          '饱和度',
          'saturation',
          0,
          200,
          5,
          r.saturation !== undefined ? `${r.saturation}` : undefined,
        )}
        {slider(
          '色相',
          'hueRotate',
          -180,
          180,
          5,
          r.hueRotate !== undefined ? `${r.hueRotate}°` : undefined,
        )}
        {slider('模糊', 'blur', 0, 50, 1, r.blur !== undefined ? `${r.blur}px` : undefined)}
        {slider(
          '灰度',
          'grayscale',
          0,
          100,
          5,
          r.grayscale !== undefined ? `${r.grayscale}` : undefined,
        )}
        {slider('棕褐', 'sepia', 0, 100, 5, r.sepia !== undefined ? `${r.sepia}` : undefined)}
      </div>
    </div>
  );
}

/** Renders a wallpaper preview according to its `playback` kind:
 *  - `video` — plays via `<video>`, falling back to the still preview image
 *    when the clip can't be decoded (e.g. an HEVC mp4 Chromium rejects).
 *  - `gif` — renders the media as an `<img>`, which browsers animate natively
 *    (a `<video>` element cannot play GIFs).
 *  - `image` — shows the still preview (static images).
 *  - `web` / `scene` — shows the still preview image (the workshop
 *    preview.jpg/png). The actual animated content is rendered on demand
 *    via an iframe (web) or canvas (scene) when applied to an agent — the
 *    grid card only shows a static thumbnail.
 *  When neither media nor a preview is available it shows `loadingNode` while
 *  the media URL resolves, then `emptyNode`. Key the element by wallpaper id at
 *  the call site so the failed state resets when the selection changes. */
function WallpaperPreview({
  playback,
  mediaUrl,
  previewUrl,
  className,
  loading,
  loadingNode,
  emptyNode,
}: {
  playback: 'video' | 'gif' | 'image' | 'web' | 'scene';
  mediaUrl: string | null;
  previewUrl: string | null;
  className: string;
  loading: boolean;
  loadingNode?: ReactNode;
  emptyNode?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const onError = () => setFailed(true);
  if (playback === 'video' && mediaUrl && !failed) {
    return (
      <video
        src={mediaUrl}
        muted
        loop
        autoPlay
        playsInline
        disablePictureInPicture
        onError={onError}
        className={className}
      />
    );
  }
  if (playback === 'gif' && mediaUrl && !failed) {
    return <img src={mediaUrl} alt="" onError={onError} className={className} />;
  }
  // image / web / scene: show the still preview image.
  if (previewUrl) {
    return <img src={previewUrl} alt="" loading="lazy" className={className} />;
  }
  if (loading) return <>{loadingNode}</>;
  return <>{emptyNode}</>;
}

function WallpaperCard({
  wallpaper,
  index,
  selected,
  isUiBackground,
  previewOnly,
  deletable,
  isDeleting,
  onSelect,
  onDelete,
  deleteLabel,
  confirmLabel,
  t,
}: {
  wallpaper: WallpaperInfo;
  index: number;
  selected: boolean;
  isUiBackground: boolean;
  previewOnly: boolean;
  deletable: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleteLabel: string;
  confirmLabel: string;
  t: UiMessages;
}) {
  const [confirming, setConfirming] = useState(false);
  const wantsMedia = wallpaper.playback === 'video' || wallpaper.playback === 'gif';
  // Lazy-load the streaming URL only when the card is (about to be) visible.
  // Previously every grid card resolved its loopback video URL + registered a
  // media-server token at once — a 45-wallpaper library fired 45 IPC calls and
  // minted 45 server entries on first paint, stalling the main process. The
  // IntersectionObserver gates resolution to the visible viewport (+0.15x
  // overscan), so scrolling populates cards on demand instead of all at once.
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || !wantsMedia) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '15% 0px', threshold: 0 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [wantsMedia]);
  const { url: mediaUrl, loading: mediaLoading } = useWallpaperVideoUrl(
    wantsMedia && inView ? wallpaper.id : null,
  );
  return (
    <div
      ref={cardRef}
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      className={cn(
        // h-full + flex-col: the card stretches to fill its grid row
        // (rows use auto-rows-fr), so a small library fills the viewport
        // vertically instead of leaving whitespace under the last row.
        'group relative flex h-full flex-col overflow-hidden rounded-[2px] border border-border bg-card text-left transition-all duration-base animate-card-enter',
        'hover:border-primary/40 hover:shadow-sm',
        selected && 'border-primary/60 shadow-sm',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-h-0 flex-1 flex-col">
        {/* Preview — flex-1 so the card fills its row height; min-h keeps a
            usable 16:9-ish preview even when rows are content-sized. */}
        <div className="relative w-full min-h-[110px] flex-1 overflow-hidden bg-muted">
          <WallpaperPreview
            playback={wallpaper.playback}
            mediaUrl={mediaUrl}
            previewUrl={wallpaper.previewUrl}
            loading={mediaLoading}
            className="size-full object-cover transition-transform duration-slow group-hover:scale-[1.03]"
            loadingNode={
              <div className="flex size-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground/50" />
              </div>
            }
            emptyNode={
              <div className="flex size-full items-center justify-center">
                <HugeIcon
                  icon={wallpaper.type === 'video' ? Video01Icon : Image02Icon}
                  className="size-8 text-muted-foreground/40"
                />
              </div>
            }
          />
          {/* WE-style hover overlay — dark scrim + hint sliding up on hover */}
          <div
            className="pointer-events-none absolute inset-0 flex items-end opacity-0 transition-opacity duration-fast group-hover:opacity-100"
            aria-hidden
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <span className="relative flex w-full items-center justify-between px-2.5 pb-2 font-mono text-[10px] tracking-wider text-white/90">
              {wallpaper.type === 'video'
                ? t.weTypeVideo
                : wallpaper.type === 'image'
                  ? t.weTypeImage
                  : wallpaper.type === 'web'
                    ? t.weTypeWeb
                    : t.weTypeScene}
              <span className="tabular-nums">{formatSize(wallpaper.sizeBytes)}</span>
            </span>
          </div>
          {/* Type badge (Swiss mono) */}
          <span
            className={cn(
              'absolute bottom-1 right-1 flex items-center gap-0.5 rounded-[2px] px-1 py-0.5 font-mono text-[9px] tracking-wider',
              wallpaper.type === 'video'
                ? 'bg-primary/85 text-white'
                : wallpaper.type === 'image'
                  ? 'bg-cr-info/85 text-white'
                  : wallpaper.type === 'web'
                    ? 'bg-success/85 text-white'
                    : 'bg-cr-warning/85 text-white',
            )}
          >
            <HugeIcon
              icon={wallpaper.type === 'video' ? Video01Icon : Image02Icon}
              className="size-2"
            />
            {wallpaper.type === 'video'
              ? 'VID'
              : wallpaper.type === 'image'
                ? 'IMG'
                : wallpaper.type === 'web'
                  ? 'WEB'
                  : 'SCN'}
          </span>
          {/* UI background indicator (Swiss) */}
          {isUiBackground && (
            <span className="absolute left-1 top-1 rounded-[2px] bg-primary px-1 py-0.5 font-mono text-[8px] tracking-wider text-primary-foreground">
              UI
            </span>
          )}
          {/* Preview-only badge (Swiss warning) */}
          {previewOnly && !isUiBackground && (
            <span className="absolute left-1 top-1 rounded-[2px] bg-cr-warning px-1 py-0.5 font-mono text-[8px] tracking-wider text-white">
              PREVIEW
            </span>
          )}
          {/* Source badge for local imports (Swiss) */}
          {wallpaper.source === 'local' && (
            <span className="absolute right-1 top-1 rounded-[2px] bg-muted px-1 py-0.5 font-mono text-[8px] tracking-wider text-muted-foreground">
              LOCAL
            </span>
          )}
        </div>

        {/* Title (Swiss mono info) */}
        <div className="px-2 py-1.5">
          <p className="truncate font-display text-[11px] font-bold">{wallpaper.title}</p>
          <p className="mt-0.5 font-mono text-[9px] tracking-wider text-muted-foreground">
            {formatSize(wallpaper.sizeBytes)}
          </p>
        </div>
      </button>

      {/* Delete button for local wallpapers (Swiss) */}
      {deletable && (
        <div className="absolute left-1 bottom-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
          {confirming ? (
            <div className="flex items-center gap-0.5 rounded-[2px] bg-card px-1 py-0.5 shadow-md">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                  setConfirming(false);
                }}
                disabled={isDeleting}
                className="rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {isDeleting ? '…' : confirmLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                className="rounded-[2px] px-1 py-0.5 font-mono text-[9px] tracking-wider text-muted-foreground hover:bg-muted"
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
              className="rounded-[2px] bg-card px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-muted-foreground shadow-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
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
  // Responsive WE-style grid: with 4+ items use auto-fill so cards flow at a
  // fixed minimum width (170px) and a wide window produces more columns —
  // previously the grid was capped at 4 columns, so a large library left big
  // horizontal whitespace and stretched cards. Small counts stay centered at
  // a bounded width so 1–3 cards don't stretch into one oversized row.
  //
  // auto-rows-fr: rows share the container height, so with few wallpapers the
  // cards grow taller and fill the vertical space (no whitespace under the
  // last row); with many wallpapers the rows stay content-sized and scroll.
  const fill = 'auto-rows-fr';
  if (count === 1) return `grid-cols-[minmax(0,340px)] justify-center ${fill}`;
  if (count === 2) return `grid-cols-2 max-w-[700px] ${fill}`;
  if (count === 3) return `grid-cols-3 max-w-[1020px] ${fill}`;
  return `grid-cols-[repeat(auto-fill,minmax(170px,1fr))] ${fill}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
