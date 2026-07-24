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
import { AGENT_IDS, type AgentId, type WallpaperAgentSetting, type WallpaperInfo } from '@shared/types';
import { api } from '@/api/agentSkinClient';

/** Build a default empty per-agent setting map (all agents disabled, null id). */
function emptyAgentWallpapers(): Record<AgentId, WallpaperAgentSetting> {
  const result = {} as Record<AgentId, WallpaperAgentSetting>;
  for (const id of AGENT_IDS) result[id] = { enabled: false, id: null };
  return result;
}

export function useWallpaper() {
  const [wallpapers, setWallpapers] = useState<WallpaperInfo[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentWallpapers, setAgentWallpapers] = useState<Record<AgentId, WallpaperAgentSetting>>(
    emptyAgentWallpapers,
  );
  const [loading, setLoading] = useState(true);

  // Initial load: discover wallpapers + read the persisted preference.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [list, settings] = await Promise.all([
          api.listWallpapers(),
          api.getSettings(),
        ]);
        if (disposed) return;
        setWallpapers(list);
        setEnabled(settings.wallpaper.enabled);
        setSelectedId(settings.wallpaper.id);
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

  /** Persist the AgentSkin UI wallpaper preference and update local state. */
  const setWallpaper = useCallback(async (nextEnabled: boolean, nextId: string | null) => {
    const settings = await api.setWallpaper({ enabled: nextEnabled, id: nextId });
    setEnabled(settings.wallpaper.enabled);
    setSelectedId(settings.wallpaper.id);
  }, []);

  /** Open a file dialog to import a local image or video as a wallpaper. */
  const importWallpaper = useCallback(async () => {
    const list = await api.importWallpaper();
    setWallpapers(list);
  }, []);

  /**
   * Delete a locally-imported wallpaper by id. Only items with a `local:`
   * prefix (user-imported) can be deleted; workshop and theme-bundled
   * wallpapers are read-only. If the deleted wallpaper was selected as the
   * AgentSkin UI background, the selection is cleared.
   */
  const deleteWallpaper = useCallback(async (id: string) => {
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
  }, [selectedId]);

  /**
   * Persist a per-agent wallpaper preference. The wallpaper is NOT immediately
   * injected — call {@link applyAgentWallpaper} to trigger CDP injection into
   * the agent's running page.
   */
  const setAgentWallpaper = useCallback(async (
    appId: AgentId,
    nextEnabled: boolean,
    nextId: string | null,
  ) => {
    const settings = await api.setAgentWallpaper(appId, {
      enabled: nextEnabled,
      id: nextId,
    });
    setAgentWallpapers(settings.wallpaper.agents ?? emptyAgentWallpapers());
  }, []);

  /**
   * Immediately inject (or remove) the wallpaper into a running agent's page
   * via CDP. Returns `{ ok, reason }` so the UI can surface errors.
   */
  const applyAgentWallpaper = useCallback(async (appId: AgentId) => {
    return api.applyAgentWallpaper(appId);
  }, []);

  /**
   * Convenience: persist a per-agent wallpaper preference AND immediately
   * apply it to the agent's running page.
   */
  const setAndApplyAgentWallpaper = useCallback(async (
    appId: AgentId,
    nextEnabled: boolean,
    nextId: string | null,
  ) => {
    await setAgentWallpaper(appId, nextEnabled, nextId);
    return applyAgentWallpaper(appId);
  }, [setAgentWallpaper, applyAgentWallpaper]);

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
  const activateThemeWallpaper = useCallback(async (
    themeId: string,
    workshopId?: string,
  ) => {
    const list = await api.listWallpapers();
    setWallpapers(list);
    const targetId = workshopId ?? `theme:${themeId}`;
    if (list.some((w) => w.id === targetId)) {
      await setWallpaper(true, targetId);
    }
  }, [setWallpaper]);

  /** The currently active wallpaper (resolved from the list), or null. */
  const active: WallpaperInfo | null =
    enabled && selectedId ? wallpapers.find((w) => w.id === selectedId) ?? null : null;

  return {
    wallpapers,
    loading,
    enabled,
    selectedId,
    agentWallpapers,
    active,
    setWallpaper,
    importWallpaper,
    deleteWallpaper,
    setAgentWallpaper,
    applyAgentWallpaper,
    setAndApplyAgentWallpaper,
    activateThemeWallpaper,
  };
}
