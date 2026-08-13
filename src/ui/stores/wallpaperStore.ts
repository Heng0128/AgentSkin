// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaperStore
 *
 * Owns dynamic-wallpaper state for the whole app: the list of video wallpapers
 * discovered from Wallpaper Engine, the persisted preference for AgentSkin's
 * own background (enabled + selected id), per-agent wallpaper preferences
 * (each agent can have a different wallpaper injected into its page), and the
 * mutations used by the settings UI.
 *
 * Extracted from `useWallpaper` (Phase A3).
 *
 * ## Cross-store: wallpaper → theme companion
 *
 * When a wallpaper is applied to an agent (the original `onWallpaperApplied`
 * callback), extract a matching theme from the wallpaper, apply it, then
 * re-apply the wallpaper (theme apply clears per-agent wallpaper per
 * "last applied wins"). Previously this ran through a `wallpaperCompanionRef`
 * hack wired by useAppController; now wallpaperStore drives it directly via
 * `useThemeStore.getState()`. A module-level `companionBusyByAgent` Set
 * guards against the recursion that the re-apply would otherwise trigger,
 * scoped per AgentId so concurrent agents do not steal each other's guard.
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useThemeStore } from '@/stores/themeStore';

import { toMessage } from '@shared/errors';
import type {
  AgentId,
  RestartReason,
  WallpaperAgentSetting,
  WallpaperInfo,
  WallpaperRenderOptions,
} from '@shared/types';
import { AGENT_IDS } from '@shared/types';
import { create } from 'zustand';

/** Shape returned by the `api.applyAgentWallpaper` IPC call. */
export interface ApplyAgentWallpaperResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  restartReason?: RestartReason;
}

/** Build a default empty per-agent setting map (all agents disabled, null id). */
function emptyAgentWallpapers(): Record<AgentId, WallpaperAgentSetting> {
  const result = {} as Record<AgentId, WallpaperAgentSetting>;
  for (const id of AGENT_IDS) result[id] = { enabled: false, id: null };
  return result;
}

/** Recursion guard for the wallpaper → theme → wallpaper companion loop (per-agent). */
const companionBusyByAgent = new Set<AgentId>();

/** Current size of the companion-busy guard set — used by the concurrency
 *  reporter to push live diagnostics to the main process. */
export function getCompanionBusySize(): number {
  return companionBusyByAgent.size;
}

interface WallpaperState {
  wallpapers: WallpaperInfo[];
  enabled: boolean;
  selectedId: string | null;
  agentWallpapers: Record<AgentId, WallpaperAgentSetting>;
  render: WallpaperRenderOptions | undefined;
  loading: boolean;
  /** Error message when wallpaper listing fails (e.g., WE not installed, IPC timeout). */
  error: string | null;

  initialize: () => Promise<void>;
  setWallpaper: (
    nextEnabled: boolean,
    nextId: string | null,
    render?: WallpaperRenderOptions,
  ) => Promise<void>;
  importWallpaper: () => Promise<void>;
  deleteWallpaper: (id: string) => Promise<void>;
  setAgentWallpaper: (
    appId: AgentId,
    nextEnabled: boolean,
    nextId: string | null,
    render?: WallpaperRenderOptions,
  ) => Promise<boolean>;
  applyAgentWallpaper: (
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ) => Promise<ApplyAgentWallpaperResult>;
  setAndApplyAgentWallpaper: (
    appId: AgentId,
    nextEnabled: boolean,
    nextId: string | null,
    options?: { restartExisting?: boolean; render?: WallpaperRenderOptions },
  ) => Promise<ApplyAgentWallpaperResult>;
  activateThemeWallpaper: (
    themeId: string,
    workshopId?: string,
    appId?: AgentId,
  ) => Promise<ApplyAgentWallpaperResult | undefined>;
}

export const useWallpaperStore = create<WallpaperState>((set, get) => ({
  wallpapers: [],
  enabled: false,
  selectedId: null,
  agentWallpapers: emptyAgentWallpapers(),
  render: undefined,
  loading: true,
  error: null,

  initialize: async () => {
    try {
      const [list, settings] = await Promise.all([api.listWallpapers(), api.getSettings()]);
      // Single set() to avoid two rapid re-renders (one for data, one for
      // loading:false). React 18+ batches them, but a single update eliminates
      // any risk of contributing to a burst that could trip React 19's
      // useSyncExternalStore max-update-depth guard (error #185).
      set({
        wallpapers: list,
        enabled: settings.wallpaper.enabled,
        selectedId: settings.wallpaper.id,
        render: settings.wallpaper.render,
        agentWallpapers: settings.wallpaper.agents ?? emptyAgentWallpapers(),
        loading: false,
        error: null,
      });
    } catch (err) {
      // Wallpaper Engine may be absent — fail soft with an empty list,
      // but retain the error message so the UI can show a degraded state.
      // Use toMessage() to match studioStore pattern for consistent
      // timeout formatting ('[Timeout: <channel>]' vs raw IPC message).
      set({ loading: false, error: toMessage(err) });
    }
  },

  setWallpaper: async (nextEnabled, nextId, render) => {
    try {
      const settings = await api.setWallpaper({ enabled: nextEnabled, id: nextId, render });
      set({
        enabled: settings.wallpaper.enabled,
        selectedId: settings.wallpaper.id,
        render: settings.wallpaper.render,
      });
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  importWallpaper: async () => {
    try {
      set({ wallpapers: await api.importWallpaper() });
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  deleteWallpaper: async (id) => {
    try {
      set({ wallpapers: await api.deleteWallpaper(id) });
      // If the deleted wallpaper was the active UI background, clear it.
      if (get().selectedId === id) {
        set({ selectedId: null });
      }
      // Clear any per-agent selection that pointed at the deleted wallpaper.
      const prev = get().agentWallpapers;
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
      if (changed) set({ agentWallpapers: next });
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  setAgentWallpaper: async (appId, nextEnabled, nextId, render) => {
    try {
      const settings = await api.setAgentWallpaper(appId, {
        enabled: nextEnabled,
        id: nextId,
        render,
      });
      set({ agentWallpapers: settings.wallpaper.agents ?? emptyAgentWallpapers() });
      return true;
    } catch (error) {
      useNotificationStore.getState().fail(error);
      return false;
    }
  },

  applyAgentWallpaper: async (appId, options): Promise<ApplyAgentWallpaperResult> => {
    try {
      return (await api.applyAgentWallpaper(appId, options)) as ApplyAgentWallpaperResult;
    } catch (error) {
      useNotificationStore.getState().fail(error);
      return { ok: false, reason: 'ipc-error' };
    }
  },

  setAndApplyAgentWallpaper: async (
    appId,
    nextEnabled,
    nextId,
    options,
  ): Promise<ApplyAgentWallpaperResult> => {
    const persisted = await get().setAgentWallpaper(appId, nextEnabled, nextId, options?.render);
    if (!persisted) {
      // Preference failed to persist — don't inject into the agent, or the
      // apply would succeed without the setting.
      return { ok: false, reason: 'persist-failed' };
    }
    const result = await get().applyAgentWallpaper(appId, options);

    if (result?.ok && nextEnabled && nextId && !companionBusyByAgent.has(appId)) {
      // pywal-style wallpaper→theme linkage: auto-extract a matching theme,
      // apply it, then re-apply the wallpaper (theme apply clears per-agent
      // wallpaper per "last applied wins"). Fire-and-forget: failures inside
      // never roll back the wallpaper apply, only reported via notification.
      try {
        companionBusyByAgent.add(appId);
        const theme = await api.extractThemeFromWallpaper(nextId);
        const applied = await useThemeStore
          .getState()
          .applyToApp(theme.id, theme.displayName, appId);
        if (applied) {
          // Re-apply the wallpaper. companionBusyByAgent prevents re-entry.
          await get().setAndApplyAgentWallpaper(appId, true, nextId, { render: options?.render });
        }
      } catch (error) {
        useNotificationStore.getState().fail(error);
      } finally {
        companionBusyByAgent.delete(appId);
      }
    }

    return result;
  },

  /**
   * Activate a theme's bundled wallpaper.
   *
   * Two call modes:
   *  - Standalone (no appId): writes global wallpaper preference via `setWallpaper`.
   *    Used by settings UI manual trigger.
   *  - Theme-apply linkage (with appId): after global preference, also persists
   *    the per-agent wallpaper setting (`setAgentWallpaper`) and triggers CDP
   *    injection (`applyAgentWallpaper`). Called by `themeStore.applyToApp`
   *    success branch so the wallpaper follows the theme automatically.
   *
   * Failures are reported via notification but never throw — a wallpaper
   * activation failure must not roll back a successful theme apply.
   */
  activateThemeWallpaper: async (themeId, workshopId, appId) => {
    try {
      const list = await api.listWallpapers();
      set({ wallpapers: list });
      const targetId = workshopId ?? `theme:${themeId}`;
      if (list.some((w) => w.id === targetId)) {
        await get().setWallpaper(true, targetId);
        if (appId) {
          // Theme-apply linkage: persist per-agent preference and inject.
          // Failure to persist → don't inject (would succeed without setting).
          const persisted = await get().setAgentWallpaper(appId, true, targetId);
          if (persisted) {
            const result = await get().applyAgentWallpaper(appId);
            return result;
          }
        }
      }
    } catch (error) {
      // Best-effort: a theme apply shouldn't fail because the wallpaper
      // activation failed. Report and move on.
      useNotificationStore.getState().fail(error);
    }
  },
}));

/** Selector: the currently active wallpaper (resolved from the list), or null. */
export const selectActiveWallpaper = (s: WallpaperState): WallpaperInfo | null =>
  s.enabled && s.selectedId ? (s.wallpapers.find((w) => w.id === s.selectedId) ?? null) : null;
