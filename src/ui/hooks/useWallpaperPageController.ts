// SPDX-License-Identifier: MPL-2.0

/**
 * useWallpaperPageController — 编排 WallpaperEnginePage 的全部页面级状态、
 * 副作用与回调。将 1200 行的状态/逻辑从主页面剥离，使页面退化为纯编排层。
 *
 * 职责边界:
 *   - 持有所有 useState (filter/search/sort/selected/renderDraft/apply/delete/batch/injectResults ...)
 *   - 封装 useEffect (WE 检测 + useRelativeTime + selectedVideo)
 *   - 封装 useMemo (filtered / runningAgentCount / readyAgentCount)
 *   - 封装所有 async handler (handleApply/handleRemove/handleDelete/handleApplyAll/...)
 *
 * 返回扁平对象供页面和子组件使用。禁止导出任何 React 组件。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useWallpaperVideoUrl } from '@/lib/wallpaperVideo';
import { describeWallpaperFailure } from '@/pages/wallpaper/describeWallpaperFailure';
import { useNotificationStore } from '@/stores/notificationStore';
import { isCompanionBusy, useWallpaperStore } from '@/stores/wallpaperStore';

import type { AgentId, WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import type { AppController } from './useAppController';

export type TypeFilter = 'all' | 'video' | 'image' | 'web' | 'scene';

/** 单 agent 注入结果（含可选 verdict detail 用于失败诊断） */
export type AgentInjectResult = { status: 'ok' | 'fail'; detail?: string };

export interface WallpaperPageController {
  // ── UI filter state ─────────────────────────────────────────────────
  filter: TypeFilter;
  search: string;
  sortBy: 'title' | 'size';

  // ── Selection / render state ─────────────────────────────────────────
  selected: WallpaperInfo | null;
  renderDraft: WallpaperRenderOptions | undefined;

  // ── Async progress state ────────────────────────────────────────────
  applyingTo: AgentId | null;
  deletingId: string | null;
  batchProgress: { done: number; total: number } | null;
  injectResults: Partial<Record<AgentId, AgentInjectResult>>;

  // ── Derived data ────────────────────────────────────────────────────
  filtered: WallpaperInfo[];
  installed: boolean | null;
  relativeTime: string;
  runningAgentCount: number;
  readyAgentCount: number;
  selectedVideo: { url: string | null; loading: boolean };

  // ── Actions ─────────────────────────────────────────────────────────
  setFilter: (f: TypeFilter) => void;
  setSearch: (q: string) => void;
  setSortBy: (s: 'title' | 'size') => void;
  setSelected: (wp: WallpaperInfo | null) => void;
  setRenderDraft: (d: WallpaperRenderOptions | undefined) => void;
  setInjectResults: React.Dispatch<
    React.SetStateAction<Partial<Record<AgentId, AgentInjectResult>>>
  >;
  clearInjectResult: (agentId: AgentId) => void;
  handleApply: (wallpaperId: string, agentId: AgentId) => Promise<void>;
  handleRemove: (agentId: AgentId) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  handleApplyAll: (wallpaperId: string) => Promise<void>;
  selectWallpaper: (wp: WallpaperInfo) => void;
}

export function useWallpaperPageController(controller: AppController): WallpaperPageController {
  const { t, wallpaper, appStatusFor, setWallpaperRestartPrompt } = controller;
  const showToast = useNotificationStore((s) => s.showToast);
  const setAgentWallpaper = useWallpaperStore((s) => s.setAgentWallpaper);
  const {
    importWallpaper: _importWallpaper,
    deleteWallpaper,
    setAndApplyAgentWallpaper,
  } = wallpaper;

  // suppress unused import — available for future extension
  void _importWallpaper;

  // ── Local state ─────────────────────────────────────────────────────
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'title' | 'size'>('title');
  const [selected, setSelected] = useState<WallpaperInfo | null>(null);
  const [renderDraft, setRenderDraft] = useState<WallpaperRenderOptions | undefined>(undefined);
  const [applyingTo, setApplyingTo] = useState<AgentId | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [injectResults, setInjectResults] = useState<Partial<Record<AgentId, AgentInjectResult>>>(
    {},
  );

  // ── WE install detection (on mount) ─────────────────────────────────
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

  // ── Relative time for status hint ────────────────────────────────────
  const relativeTime = useRelativeTime(
    controller.lastStatusAt,
    controller.isRefreshing,
    controller.t,
  );

  // ── Derived: filtered + sorted wallpaper list ────────────────────────
  const filtered = useMemo(() => {
    let list = wallpaper.wallpapers;
    if (filter !== 'all') list = list.filter((w) => w.type === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(q) || w.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) =>
      sortBy === 'title' ? a.title.localeCompare(b.title, 'zh-Hans-CN') : b.sizeBytes - a.sizeBytes,
    );
  }, [wallpaper.wallpapers, filter, search, sortBy]);

  // ── Derived: agent counts ────────────────────────────────────────────
  const runningAgentCount = useMemo(
    () => AGENT_IDS.filter((id) => appStatusFor(id)?.running).length,
    [appStatusFor],
  );
  const readyAgentCount = useMemo(
    () => AGENT_IDS.filter((id) => appStatusFor(id)?.debugReady).length,
    [appStatusFor],
  );

  // ── Streaming video URL for selected wallpaper ───────────────────────
  const selectedVideo = useWallpaperVideoUrl(
    selected && (selected.playback === 'video' || selected.playback === 'gif') ? selected.id : null,
  );

  // ── Handler: apply wallpaper to single agent ─────────────────────────
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

  // ── Handler: remove wallpaper from single agent ──────────────────────
  const handleRemove = useCallback(
    async (agentId: AgentId) => {
      const name = AGENT_META[agentId].displayName;
      // R4 arbitration (RFC 2026-08-19): refuse to remove while the
      // wallpaper→theme companion is mid-apply for this agent — the in-flight
      // apply would re-inject the wallpaper right after the removal.
      if (isCompanionBusy(agentId)) {
        showToast(t.weSyncInProgress, 'destructive');
        return;
      }
      setApplyingTo(agentId);
      setInjectResults((prev) => ({ ...prev, [agentId]: undefined }));
      try {
        await setAgentWallpaper(agentId, false, null);
        await api.removeWallpaperFromAgent(agentId);
        showToast(t.weRemoved(name));
      } catch (error) {
        // Report removal failure to user — silent failure leaves wallpaper injected
        showToast(t.weApplyFailed, 'destructive');
      } finally {
        setApplyingTo(null);
      }
    },
    [setAgentWallpaper, showToast, t],
  );

  // ── Handler: delete local wallpaper ──────────────────────────────────
  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteWallpaper(id);
        setSelected((prev) => (prev?.id === id ? null : prev));
        showToast(t.wallpaperDeleted);
      } catch {
        showToast(t.wallpaperDeleteFailed, 'destructive');
      } finally {
        setDeletingId(null);
      }
    },
    [deleteWallpaper, showToast, t],
  );

  // ── Handler: apply to all running agents (bounded concurrency) ───────
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
      let okCount = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const idx = cursor++;
          if (idx >= targets.length) break;
          const agentId = targets[idx];
          setApplyingTo(agentId);
          try {
            const result = await setAndApplyAgentWallpaper(agentId, true, wallpaperId, {
              render: renderDraft,
            });
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
    [appStatusFor, setAndApplyAgentWallpaper, showToast, t, renderDraft],
  );

  // Derived helper: select wallpaper (exposed alias for clarity)
  const selectWallpaper = useCallback((wp: WallpaperInfo) => {
    setSelected(wp);
  }, []);

  // Derived helper: clear a single agent's inject result
  const clearInjectResult = useCallback((agentId: AgentId) => {
    setInjectResults((prev) => ({ ...prev, [agentId]: undefined }));
  }, []);

  return {
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
    setSelected,
    setRenderDraft,
    setInjectResults,
    clearInjectResult,
    handleApply,
    handleRemove,
    handleDelete,
    handleApplyAll,
    selectWallpaper,
  };
}
