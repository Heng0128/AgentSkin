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

/**
 * Runtime type guard for a single WallpaperInfo object.
 * Validates required fields exist with correct types. Optional/nullable
 * fields are only checked for type when present.
 */
function isWallpaperInfo(value: unknown): value is WallpaperInfo {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.title !== 'string') return false;
  if (typeof obj.type !== 'string' || !['video', 'image', 'web', 'scene'].includes(obj.type))
    return false;
  if (typeof obj.projectType !== 'string') return false;
  if (typeof obj.playback !== 'string') return false;
  if (obj.previewUrl !== null && typeof obj.previewUrl !== 'string') return false;
  if (typeof obj.sizeBytes !== 'number') return false;
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === 'string')) return false;
  if (typeof obj.source !== 'string' || !['workshop', 'local'].includes(obj.source)) return false;
  if (typeof obj.previewOnly !== 'boolean') return false;
  return true;
}

/**
 * Normalize the three possible return shapes from the importWallpaper IPC
 * into a single WallpaperInfo[] array. Returns an empty array for any
 * unrecognized shape so callers always get a safe iterable.
 */
function normalizeWallpaperResult(result: unknown): WallpaperInfo[] {
  if (Array.isArray(result)) {
    return result.filter(isWallpaperInfo);
  }
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (obj.ok === true && Array.isArray(obj.items)) {
      return obj.items.filter(isWallpaperInfo);
    }
  }
  return [];
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

/** True while the wallpaper→theme→wallpaper companion is running for this
 *  agent (RFC 2026-08-19 R4): remove flows must not race the companion's
 *  apply chain, or the removal would be re-injected by the in-flight apply. */
export function isCompanionBusy(appId: AgentId): boolean {
  return companionBusyByAgent.has(appId);
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
    render?: WallpaperRenderOptions,
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
      const result = await api.importWallpaper();
      // IPC handler 三种返回形态（类型声明为 WallpaperInfo[] 但实际更宽）：
      //   1. 取消/未选文件 → WallpaperInfo[] (deps.wallpapers.list())
      //   2. 成功          → { ok: true, items: WallpaperInfo[] }
      //   3. 失败          → { ok: false; error: string }
      // normalizeWallpaperResult handles shapes 1 and 2; shape 3 is handled below.
      const items = normalizeWallpaperResult(result);
      if (items.length > 0) {
        set({ wallpapers: items });
      } else if (
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).ok === false &&
        typeof (result as Record<string, unknown>).error === 'string'
      ) {
        // ok=false 路径：报告具体错误给用户
        useNotificationStore
          .getState()
          .fail(new Error((result as Record<string, unknown>).error as string));
      }
      // ok=false 且无 error 信息时静默降级（避免无意义报错）
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
      // Spread the previous record and only override the keys that changed,
      // rather than rebuilding the entire record.
      const prev = get().agentWallpapers;
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(prev) as AgentId[]) {
        if (prev[key].id === id) {
          next[key] = { enabled: false, id: null };
          changed = true;
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

    if (result?.ok && nextEnabled && nextId) {
      // pywal-style wallpaper→theme linkage: extra-work is delegated to the
      // standalone companion helper (extract theme, apply — the theme apply
      // flow re-injects the wallpaper in the main process).
      await runWallpaperCompanion(appId, nextId);
    }

    return result;
  },

  /**
   * Activate a theme's bundled wallpaper — **preference-only** (RFC
   * 2026-08-19 R1, Single Injector).
   *
   * Writes the global wallpaper preference (`setWallpaper`) and, when an
   * `appId` is given, the per-agent wallpaper setting (`setAgentWallpaper`)
   * so the choice survives restart. It deliberately does NOT trigger CDP
   * injection: the main-process apply flow already injects the theme's
   * bundled wallpaper in its background chain
   * (`theme-apply-flow.ts → injectAgentWallpaperFromApply`). A renderer-side
   * `applyAgentWallpaper` here would be a second, racing injection (P0-1).
   *
   * Failures are reported via notification but never throw — a wallpaper
   * activation failure must not roll back a successful theme apply.
   */
  activateThemeWallpaper: async (themeId, workshopId, appId, render) => {
    try {
      const list = await api.listWallpapers();
      set({ wallpapers: list });
      const targetId = workshopId ?? `theme:${themeId}`;
      if (list.some((w) => w.id === targetId)) {
        // F-11: forward the theme's wallpaper render options so per-agent
        // settings survive restart. Without this, themeRenderOptions(wp)
        // fields (speed/loop/scrimOpacity) exist only in memory.
        await get().setWallpaper(true, targetId, render);
        if (appId) {
          // Preference-only: the main-process background chain performs the
          // actual injection after the theme apply settles.
          await get().setAgentWallpaper(appId, true, targetId, render);
        }
      } else {
        // F-20: bundled wallpaper not in library (not subscribed / WE missing).
        // Previously silent skip — now notify the user.
        useNotificationStore
          .getState()
          .fail(new Error(`Theme wallpaper "${targetId}" not found in library`));
      }
    } catch (error) {
      // Best-effort: a theme apply shouldn't fail because the wallpaper
      // activation failed. Report and move on.
      useNotificationStore.getState().fail(error);
    }
  },
}));

/**
 * Pywal-style wallpaper → theme linkage: extract a matching theme, apply it,
 * then re-apply the wallpaper (theme apply clears per-agent wallpaper per
 * "last applied wins"). Extracted out of `setAndApplyAgentWallpaper` so the
 * re-apply step drives the underlying `applyAgentWallpaper` directly instead
 * of recursing into the full set-and-apply action. The module-level
 * `companionBusyByAgent` guard is managed explicitly here (set on entry,
 * cleared on exit) rather than relying on a re-entrancy check at a call
 * boundary.
 */
async function runWallpaperCompanion(appId: AgentId, nextId: string): Promise<void> {
  // Guarded per-agent so a re-apply (via applyAgentWallpaper) can't re-enter
  // this companion path, and concurrent agents don't steal each other's guard.
  if (companionBusyByAgent.has(appId)) return;
  companionBusyByAgent.add(appId);
  try {
    const theme = await api.extractThemeFromWallpaper(nextId);
    // Single-Injector (RFC 2026-08-19 R1): applying the extracted theme now
    // routes through the main-process apply flow, whose background chain
    // re-injects the theme's bundled wallpaper (theme-apply-flow.ts →
    // injectAgentWallpaperFromApply). The previous explicit re-apply here was
    // a third, racing CDP injection (P0-1 triple injection).
    await useThemeStore.getState().applyToApp(theme.id, theme.displayName, appId);
  } catch (error) {
    // Best-effort: failures inside never roll back the wallpaper apply, only
    // reported via notification.
    useNotificationStore.getState().fail(error);
  } finally {
    companionBusyByAgent.delete(appId);
  }
}

/** Selector: the currently active wallpaper (resolved from the list), or null. */
export const selectActiveWallpaper = (s: WallpaperState): WallpaperInfo | null =>
  s.enabled && s.selectedId ? (s.wallpapers.find((w) => w.id === s.selectedId) ?? null) : null;
