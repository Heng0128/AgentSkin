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
import { useStatusStore } from '@/stores/statusStore';
import { registerWallpaperHandler } from '@/stores/wallpaper-handler-registry';

import { toMessage } from '@shared/errors';
import { isOkError, isWallpaperInfo } from '@shared/ipc-type-guards';
import {
  AGENT_IDS,
  type AgentId,
  type ApplyAgentWallpaperResult,
  type InstalledTheme,
  type WallpaperAgentSetting,
  type WallpaperInfo,
  type WallpaperRenderOptions,
} from '@shared/types';
import { create } from 'zustand';

/**
 * Normalize the three possible return shapes from the importWallpaper IPC
 * into a single WallpaperInfo[] array. Returns an empty array for any
 * unrecognized shape so callers always get a safe iterable.
 *
 * RC-3: Uses the shared `isWallpaperInfo` from `@shared/ipc-type-guards`.
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

// ---------------------------------------------------------------------------
// CompanionBusyGuard — encapsulates recursion guard state (P1-3 fix)
// ---------------------------------------------------------------------------

/**
 * ## CompanionBusyGuard
 *
 * Owns the per-agent recursion guard for the wallpaper → theme → wallpaper
 * companion loop. Previously a bare module-level `Set` that leaked across
 * test runs.
 */
class CompanionBusyGuard {
  private readonly busy = new Set<AgentId>();

  /** Check if a companion operation is in-flight for this agent. */
  has(appId: AgentId): boolean {
    return this.busy.has(appId);
  }

  /** Mark a companion operation as in-flight for this agent. */
  add(appId: AgentId): void {
    this.busy.add(appId);
  }

  /** Clear the in-flight marker for this agent. */
  delete(appId: AgentId): void {
    this.busy.delete(appId);
  }

  /** Current size of the guard set — for diagnostics. */
  get size(): number {
    return this.busy.size;
  }

  /** Reset all guard state — for test isolation. */
  reset(): void {
    this.busy.clear();
  }
}

const companionGuard = new CompanionBusyGuard();

/** Current size of the companion-busy guard set — used by the concurrency
 *  reporter to push live diagnostics to the main process. */
export function getCompanionBusySize(): number {
  return companionGuard.size;
}

/** True while the wallpaper→theme→wallpaper companion is running for this
 *  agent (RFC 2026-08-19 R4): remove flows must not race the companion's
 *  apply chain, or the removal would be re-injected by the in-flight apply. */
export function isCompanionBusy(appId: AgentId): boolean {
  return companionGuard.has(appId);
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
  /**
   * 显式「导出为主题包」：取色生成主题包并加入主题库（不自动 apply、不注入）。
   * 返回已安装主题（null = 失败，已通知）。
   */
  exportThemeToLibrary: (wallpaperId: string) => Promise<InstalledTheme | null>;
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
      } else if (isOkError(result)) {
        // ok=false 路径：报告具体错误给用户
        useNotificationStore.getState().fail(new Error(result.error));
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
      for (const agentId of AGENT_IDS) {
        if (prev[agentId].id === id) {
          next[agentId] = { enabled: false, id: null };
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
      return await api.applyAgentWallpaper(appId, options);
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

    // 2026-09-03 (壁纸范围定稿): 替换 = 纯背景交换，不再自动取色生成并应用主题
    // （旧的 runWallpaperCompanion "pywal 联动" 把主题化混入注入流程，违反
    // "壁纸库只做替换" 的产品定位。主题生成只保留在显式的「导出为主题包」动作）。

    return result;
  },

  exportThemeToLibrary: async (wallpaperId: string): Promise<InstalledTheme | null> => {
    try {
      // 导出 = 取色生成主题包 + 加入主题库；绝不自动 apply / 注入。
      return await api.extractThemeFromWallpaper(wallpaperId);
    } catch (error) {
      useNotificationStore.getState().fail(error);
      return null;
    }
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

// RC-1: Register handler via the shared wallpaper-handler-registry — this
// breaks the (themeStore ↔ wallpaperStore) circular import, since neither
// store imports the other for this handshake. Placed after store creation so
// useWallpaperStore is fully initialized.
registerWallpaperHandler((appId, restore, wallpaper) => {
  void useWallpaperStore.getState().setAgentWallpaper(appId, !restore, wallpaper?.id ?? null);
});

/**
 * 2026-09-03: wallpaper→theme 伴生自动联动已退役（替换 = 纯背景交换，见
 * setAndApplyAgentWallpaper）。guard 基础设施保留供并发诊断（size 恒 0）与
 * remove-flow 兼容，不再有写入方。
 */

/** Selector: the currently active wallpaper (resolved from the list), or null. */
export const selectActiveWallpaper = (s: WallpaperState): WallpaperInfo | null =>
  s.enabled && s.selectedId ? (s.wallpapers.find((w) => w.id === s.selectedId) ?? null) : null;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all module-level companion-busy guard state.
 * Call this in test `beforeEach` to prevent state leakage across tests.
 */
export function resetCompanionBusyGuard(): void {
  companionGuard.reset();
}
