// SPDX-License-Identifier: MPL-2.0

/**
 * # useWallpaper
 *
 * Owns dynamic-wallpaper state for the whole app: the list of video wallpapers
 * discovered from Wallpaper Engine, the persisted preference for AgentSkin's
 * own background (enabled + selected id), per-agent wallpaper preferences
 * (each agent can have a different wallpaper injected into its page), and the
 * mutations used by the settings UI.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';

import {
  AGENT_IDS,
  type AgentId,
  type WallpaperAgentSetting,
  type WallpaperInfo,
  type WallpaperRenderOptions,
} from '@shared/types';

/** Build a default empty per-agent setting map (all agents disabled, null id). */
function emptyAgentWallpapers(): Record<AgentId, WallpaperAgentSetting> {
  const result = {} as Record<AgentId, WallpaperAgentSetting>;
  for (const id of AGENT_IDS) result[id] = { enabled: false, id: null };
  return result;
}

export function useWallpaper(
  onError?: (error: unknown) => void,
  onWallpaperApplied?: (appId: AgentId, wallpaperId: string) => Promise<void>,
) {
  const [wallpapers, setWallpapers] = useState<WallpaperInfo[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentWallpapers, setAgentWallpapers] =
    useState<Record<AgentId, WallpaperAgentSetting>>(emptyAgentWallpapers);
  /** 全局默认渲染设置（对齐/位置/翻转/滤镜/速度等），作用于桌面 UI 背景。 */
  const [render, setRender] = useState<WallpaperRenderOptions | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Initial load: discover wallpapers + read the persisted preference.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [list, settings] = await Promise.all([api.listWallpapers(), api.getSettings()]);
        if (disposed) return;
        setWallpapers(list);
        setEnabled(settings.wallpaper.enabled);
        setSelectedId(settings.wallpaper.id);
        setRender(settings.wallpaper.render);
        setAgentWallpapers(settings.wallpaper.agents ?? emptyAgentWallpapers());
      } catch {
        // Wallpaper Engine may be absent — fail soft with an empty list.
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  /** Persist the AgentSkin UI wallpaper preference + optional global render
   *  settings, and update local state. */
  const setWallpaper = useCallback(
    async (nextEnabled: boolean, nextId: string | null, render?: WallpaperRenderOptions) => {
      try {
        const settings = await api.setWallpaper({ enabled: nextEnabled, id: nextId, render });
        setEnabled(settings.wallpaper.enabled);
        setSelectedId(settings.wallpaper.id);
        setRender(settings.wallpaper.render);
      } catch (error) {
        onError?.(error);
      }
    },
    [onError],
  );

  /** Open a file dialog to import a local image or video as a wallpaper. */
  const importWallpaper = useCallback(async () => {
    try {
      const list = await api.importWallpaper();
      setWallpapers(list);
    } catch (error) {
      onError?.(error);
    }
  }, [onError]);

  /**
   * Delete a locally-imported wallpaper by id. Only items with a `local:`
   * prefix (user-imported) can be deleted; workshop and theme-bundled
   * wallpapers are read-only. If the deleted wallpaper was selected as the
   * AgentSkin UI background, the selection is cleared.
   */
  const deleteWallpaper = useCallback(
    async (id: string) => {
      try {
        const list = await api.deleteWallpaper(id);
        setWallpapers(list);
        // If the deleted wallpaper was the active UI background, clear it.
        if (selectedId === id) {
          setSelectedId(null);
        }
        // Clear any per-agent selection that pointed at the deleted wallpaper.
        setAgentWallpapers((prev) => {
          const next = {} as Record<AgentId, WallpaperAgentSetting>;
          let changed = false;
          for (const key of Object.keys(prev) as AgentId[]) {
            const entry = prev[key];
            if (entry.id === id) {
              next[key] = { enabled: false, id: null };
              changed = true;
            } else {
              next[key] = entry;
            }
          }
          return changed ? next : prev;
        });
      } catch (error) {
        onError?.(error);
      }
    },
    [selectedId, onError],
  );

  /**
   * Persist a per-agent wallpaper preference. The wallpaper is NOT immediately
   * injected — call {@link applyAgentWallpaper} to trigger CDP injection into
   * the agent's running page.
   */
  const setAgentWallpaper = useCallback(
    async (
      appId: AgentId,
      nextEnabled: boolean,
      nextId: string | null,
      render?: WallpaperRenderOptions,
    ): Promise<boolean> => {
      try {
        const settings = await api.setAgentWallpaper(appId, {
          enabled: nextEnabled,
          id: nextId,
          render,
        });
        setAgentWallpapers(settings.wallpaper.agents ?? emptyAgentWallpapers());
        return true;
      } catch (error) {
        onError?.(error);
        return false;
      }
    },
    [onError],
  );

  /**
   * Immediately inject (or remove) the wallpaper into a running agent's page
   * via CDP. Returns `{ ok, reason }` so the UI can surface errors.
   *
   * When `restartExisting` is false/absent, only probes for an existing CDP
   * port — returns `{ ok: false, reason: 'requires-restart' }` if the agent
   * is running without `--remote-debugging-port`. The caller should prompt
   * the user for consent and retry with `restartExisting: true`.
   */
  const applyAgentWallpaper = useCallback(
    async (appId: AgentId, options?: { restartExisting?: boolean }) => {
      return api.applyAgentWallpaper(appId, options);
    },
    [],
  );

  /**
   * Convenience: persist a per-agent wallpaper preference AND immediately
   * apply it to the agent's running page.
   *
   * When the apply succeeds and `onWallpaperApplied` is provided (pywal-style
   * wallpaper→theme linkage), the callback runs afterwards — fire-and-forget:
   * failures inside it never roll back the wallpaper apply, they're only
   * reported via onError. `onWallpaperApplied` is expected to re-apply the
   * wallpaper after its own theme apply (theme apply clears per-agent
   * wallpaper per "last applied wins"), so callers must guard against
   * recursion (e.g. a ref that short-circuits while the callback runs).
   */
  const setAndApplyAgentWallpaper = useCallback(
    async (
      appId: AgentId,
      nextEnabled: boolean,
      nextId: string | null,
      options?: { restartExisting?: boolean; render?: WallpaperRenderOptions },
    ) => {
      const persisted = await setAgentWallpaper(appId, nextEnabled, nextId, options?.render);
      if (!persisted) {
        // Preference failed to persist (reported via onError) — don't inject
        // into the agent, or the apply would succeed without the setting.
        return { ok: false, reason: 'persist-failed' as const };
      }
      const result = await applyAgentWallpaper(appId, options);
      if (result?.ok && nextEnabled && nextId && onWallpaperApplied) {
        try {
          await onWallpaperApplied(appId, nextId);
        } catch (error) {
          // The wallpaper itself is applied; the follow-up (theme extraction +
          // apply) is best-effort. Report but keep the wallpaper result.
          onError?.(error);
        }
      }
      return result;
    },
    [setAgentWallpaper, applyAgentWallpaper, onWallpaperApplied, onError],
  );

  /**
   * Activate the video wallpaper bundled with a theme. Refreshes the list
   * first so the wallpaper is present, then persists the preference.
   *
   * Resolution order for the wallpaper id:
   * 1. `workshopId` — a Wallpaper Engine workshop item id (discovered by
   *    WallpaperService.scan() from the Steam workshop directory). Activates
   *    the workshop video directly.
   * 2. `theme:{themeId}` — a video file bundled inside the theme package
   *    (registered at boot via WallpaperService.registerThemeWallpaper).
   *
   * Called by the theme-apply flow after a successful apply so the video
   * background follows the theme. If the resolved wallpaper id is not in the
   * list (e.g. the workshop item isn't subscribed), this is a no-op.
   */
  const activateThemeWallpaper = useCallback(
    async (themeId: string, workshopId?: string) => {
      try {
        const list = await api.listWallpapers();
        setWallpapers(list);
        const targetId = workshopId ?? `theme:${themeId}`;
        if (list.some((w) => w.id === targetId)) {
          await setWallpaper(true, targetId);
        }
      } catch (error) {
        // Best-effort: a theme apply shouldn't fail because the wallpaper
        // activation failed. Report and move on.
        onError?.(error);
      }
    },
    [setWallpaper, onError],
  );

  /** The currently active wallpaper (resolved from the list), or null. */
  const active: WallpaperInfo | null =
    enabled && selectedId ? (wallpapers.find((w) => w.id === selectedId) ?? null) : null;

  return {
    wallpapers,
    loading,
    enabled,
    selectedId,
    agentWallpapers,
    active,
    render,
    setWallpaper,
    importWallpaper,
    deleteWallpaper,
    setAgentWallpaper,
    applyAgentWallpaper,
    setAndApplyAgentWallpaper,
    activateThemeWallpaper,
  };
}
