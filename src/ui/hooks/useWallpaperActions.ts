// SPDX-License-Identifier: MPL-2.0

/**
 * NOTE — 待合并：本文件当前没有任何调用方（dead code）。其 handler
 * (handleApply / handleRemove / handleDelete / handleApplyAll) 与
 * `useWallpaperPageController.ts` 中的同名 handler 几乎完全重复，后者才是
 * WallpaperEnginePage 实际使用的入口。合并成单一 hook 需单独一轮执行
 * （涉及 WallpaperEnginePage / InjectResultsPanel 等调用方核对），此处不做
 * 破坏性改动，仅保留注释说明。
 */

import { useCallback } from 'react';
import { api } from '@/api/agentSkinClient';
import type { AppController } from '@/hooks/useAppController';
import { describeWallpaperFailure } from '@/pages/wallpaper/describeWallpaperFailure';

import type { AgentId, WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';

export interface WallpaperActionsParams {
  controller: AppController;
  showToast: (message: string, variant?: 'default' | 'destructive') => void;
  state: {
    renderDraft: WallpaperRenderOptions | undefined;
    selected: WallpaperInfo | null;
  };
  setters: {
    setApplyingTo: (v: AgentId | null) => void;
    setBatchProgress: React.Dispatch<React.SetStateAction<{ done: number; total: number } | null>>;
    setDeletingId: (v: string | null) => void;
    setInjectResults: React.Dispatch<
      React.SetStateAction<Partial<Record<AgentId, { status: 'ok' | 'fail'; detail?: string }>>>
    >;
    setSelected: (v: WallpaperInfo | null) => void;
  };
}

export interface WallpaperActions {
  handleApply: (wallpaperId: string, agentId: AgentId) => Promise<void>;
  handleRemove: (agentId: AgentId) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  handleApplyAll: (wallpaperId: string) => Promise<void>;
}

export function useWallpaperActions(params: WallpaperActionsParams): WallpaperActions {
  const { controller, showToast, state, setters } = params;
  const { t, appStatusFor, setWallpaperRestartPrompt } = controller;
  const { setAndApplyAgentWallpaper, setAgentWallpaper } = controller.wallpaper;
  const { renderDraft, selected } = state;
  const { setApplyingTo, setBatchProgress, setDeletingId, setInjectResults, setSelected } = setters;

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
    [
      setAndApplyAgentWallpaper,
      showToast,
      t,
      setWallpaperRestartPrompt,
      renderDraft,
      setInjectResults,
      setApplyingTo,
    ],
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
    [setAgentWallpaper, showToast, t, setInjectResults, setApplyingTo],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await controller.wallpaper.deleteWallpaper(id);
        if (selected?.id === id) setSelected(null);
        showToast(t.wallpaperDeleted);
      } catch {
        showToast(t.wallpaperDeleteFailed, 'destructive');
      } finally {
        setDeletingId(null);
      }
    },
    [controller.wallpaper, selected, showToast, t, setSelected, setDeletingId],
  );

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
      // cursor++ is atomic in JS single-threaded execution — no true parallelism,
      // so concurrent workers cannot get duplicate indices. Safe for this pattern.
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
    [
      appStatusFor,
      setAndApplyAgentWallpaper,
      showToast,
      t,
      renderDraft,
      setInjectResults,
      setBatchProgress,
      setApplyingTo,
    ],
  );

  return { handleApply, handleRemove, handleDelete, handleApplyAll };
}
