// SPDX-License-Identifier: MPL-2.0

/**
 * # environmentStore
 *
 * Environment preset state + mutations. Replaces the old `useEnvironmentActions`
 * / `useEnvironments` hook pair which communicated through a module-level
 * `refreshCounter` hack. Now:
 *
 *   - Presets are store state — zustand's selector model drives re-derivation
 *     in `useEnvironments` without a counter.
 *   - Mutations (create/rename/duplicate/delete/switch) live here as actions
 *     that call themeStore for apply/restore and notificationStore for toasts.
 *   - `switching` / `error` live in the store so any component can subscribe.
 *
 * Persistence goes through `environment-store.ts` (localStorage envelope) — the
 * store wraps it with React reactivity.
 */

import { api } from '@/api/agentSkinClient';
import {
  createPreset,
  loadPresets,
  removePreset,
  savePresets,
  updatePreset,
  upsertPreset,
} from '@/storage/environment-store';
import { useDialogStore } from '@/stores/dialogStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useThemeStore } from '@/stores/themeStore';

import { toMessage } from '@shared/errors';
import { uiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import type { EnvironmentModel, EnvironmentPreset } from '@shared/types/environment';
import { create } from 'zustand';

function currentT() {
  const locale = useShellStore.getState().locale;
  return uiMessages[locale];
}

// ---------------------------------------------------------------------------
// Module-level guards
// ---------------------------------------------------------------------------

/**
 * Epoch guard for switchEnvironment: rapid consecutive switches must not let
 * an older (slower) flow's `finally` clear the busy state while a newer flow
 * is still in flight, nor let the older apply after a newer supersedes it.
 */
const switchEpochByAgent = new Map<string, number>();

/** Current size of the switch-epoch guard map — used by the concurrency
 *  reporter to push live diagnostics to the main process. */
export function getSwitchEpochSize(): number {
  return switchEpochByAgent.size;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface EnvironmentState {
  presets: EnvironmentPreset[];
  switching: boolean;
  error: string | null;

  // --- lifecycle ---
  loadPresets: () => void;

  // --- mutations ---
  switchEnvironment: (env: EnvironmentModel) => Promise<boolean>;
  createEnvironment: (
    agentId: EnvironmentPreset['agentId'],
    themeId: EnvironmentPreset['themeId'],
    wallpaperId?: EnvironmentPreset['wallpaperId'],
    name?: string,
    applyNow?: boolean,
  ) => Promise<{ preset: EnvironmentPreset | null; success: boolean }>;
  deleteEnvironment: (presetId: string) => Promise<boolean>;
  duplicateEnvironment: (presetId: string, newName: string) => Promise<EnvironmentPreset | null>;
  renameEnvironment: (presetId: string, newName: string) => Promise<boolean>;

  // --- internal ---
  setSwitching: (value: boolean) => void;
  setError: (msg: string | null) => void;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  presets: [],
  switching: false,
  error: null,

  loadPresets: async () => {
    try {
      set({ presets: await loadPresets() });
    } catch (error) {
      // Underlying storage may fail (unreadable/corrupt). Report and fall
      // back to an empty list so the UI can still render.
      useNotificationStore.getState().fail(error);
      set({ presets: [] });
    }
  },

  setSwitching: (switching) => set({ switching }),
  setError: (error) => set({ error }),

  // -------------------------------------------------------------------
  // switchEnvironment
  //
  // Applies the FULL environment in one shot: the bound theme AND the bound
  // wallpaper. With no theme the agent is restored to native; with no
  // wallpaper any previously-injected wallpaper is removed. Together this is
  // a true "apply/restore the whole environment" (strategic audit P0-3).
  // -------------------------------------------------------------------

  switchEnvironment: async (env) => {
    const appId = env.agent.id;
    const myEpoch = (switchEpochByAgent.get(appId) ?? 0) + 1;
    switchEpochByAgent.set(appId, myEpoch);
    set({ switching: true, error: null });

    try {
      const wallpaperId = env.wallpaperId ?? null;

      // Auto-create preset if none exists for this agent+theme combo.
      // Use `?? null` so that no-theme environments (env.theme === null)
      // compare against `null` rather than `undefined` — otherwise
      // `null === undefined` is false and a duplicate preset is created.
      const presets = get().presets;
      const hasPreset = presets.some(
        (p) => p.agentId === env.agent.id && p.themeId === (env.theme?.id ?? null),
      );
      if (!hasPreset) {
        const newPreset = createPreset(env.agent.id, env.theme?.id ?? null, wallpaperId, env.name);
        const saved = await savePresets([...presets, newPreset], (error) => {
          useNotificationStore.getState().fail(error);
        });
        if (!saved) {
          // Continue with apply — the environment still takes effect, just
          // without a persisted preset. The user can retry saving later.
        }
        set({ presets: [...presets, newPreset] });
      }
      if (myEpoch !== (switchEpochByAgent.get(appId) ?? 0)) return false;

      // --- Theme half ---
      if (env.theme) {
        const ok = await useThemeStore
          .getState()
          .applyToApp(env.theme.id, env.theme.name, env.agent.id as AgentId);
        if (myEpoch !== (switchEpochByAgent.get(appId) ?? 0)) return false;
        if (!ok) return false;
      } else {
        // No theme = restore native theme.
        await useThemeStore.getState().restoreApp(env.agent.id as AgentId);
        if (myEpoch !== (switchEpochByAgent.get(appId) ?? 0)) return false;
      }

      // --- Wallpaper half ---
      if (wallpaperId) {
        const wp = await api.applyWallpaperToAgent(wallpaperId, env.agent.id as AgentId);
        if (myEpoch !== (switchEpochByAgent.get(appId) ?? 0)) return false;
        if (!wp.ok) {
          useNotificationStore
            .getState()
            .fail(new Error(wp.detail ?? wp.reason ?? 'wallpaper apply failed'));
        }
      } else {
        // No wallpaper bound — clear any previously injected wallpaper.
        await api.removeWallpaperFromAgent(env.agent.id as AgentId);
        if (myEpoch !== (switchEpochByAgent.get(appId) ?? 0)) return false;
      }

      // Clear any stale restart prompts from a superseded switch. Guarded
      // by epoch so we never wipe a newer switch's prompt mid-flight.
      if (myEpoch === (switchEpochByAgent.get(appId) ?? 0)) {
        const { setRestartPrompt, setWallpaperRestartPrompt } = useDialogStore.getState();
        setRestartPrompt(null);
        setWallpaperRestartPrompt(null);
      }

      useNotificationStore.getState().showToast(currentT().switchSuccess(env.name));
      return true;
    } catch (err) {
      const msg = toMessage(err) || currentT().switchFailure;
      set({ error: msg });
      useNotificationStore.getState().fail(err);
      return false;
    } finally {
      // Only the most recent switch may clear the busy state.
      if (myEpoch === (switchEpochByAgent.get(appId) ?? 0)) {
        set({ switching: false });
        switchEpochByAgent.delete(appId);
      }
    }
  },

  // -------------------------------------------------------------------
  // createEnvironment
  // -------------------------------------------------------------------

  createEnvironment: async (agentId, themeId, wallpaperId = null, name, applyNow = false) => {
    try {
      const presets = get().presets;
      const preset = createPreset(agentId, themeId, wallpaperId, name);
      const updated = upsertPreset(presets, agentId, themeId, wallpaperId, name);
      const saved = await savePresets(updated);
      if (!saved) {
        set({ error: currentT().environmentCreationFailed });
        return { preset: null, success: false };
      }
      set({ presets: updated });

      // Optionally apply the full environment immediately.
      if (applyNow && themeId) {
        const theme = useThemeStore.getState().installed.find((th) => th.id === themeId);
        if (theme) {
          const ok = await useThemeStore.getState().applyToApp(themeId, theme.name, agentId);
          if (!ok) return { preset, success: false };
        }
        if (wallpaperId) {
          await api.applyWallpaperToAgent(wallpaperId, agentId);
        }
      }

      useNotificationStore
        .getState()
        .showToast(
          name ? `${currentT().environmentCreated} ${name}` : currentT().environmentCreated,
        );
      return { preset, success: true };
    } catch (err) {
      const msg = toMessage(err) || currentT().environmentCreationFailed;
      set({ error: msg });
      useNotificationStore.getState().fail(err);
      return { preset: null, success: false };
    }
  },

  // -------------------------------------------------------------------
  // deleteEnvironment
  // -------------------------------------------------------------------

  deleteEnvironment: async (presetId) => {
    try {
      const presets = get().presets;
      const updated = removePreset(presets, presetId);
      const saved = await savePresets(updated);
      if (saved) {
        set({ presets: updated });
        useNotificationStore.getState().showToast(currentT().environmentDeleted);
        return true;
      }
      return false;
    } catch {
      set({ error: currentT().environmentDeletionFailed });
      return false;
    }
  },

  // -------------------------------------------------------------------
  // duplicateEnvironment
  // -------------------------------------------------------------------

  duplicateEnvironment: async (presetId, newName) => {
    try {
      const presets = get().presets;
      const source = presets.find((p) => p.id === presetId);
      if (!source) {
        set({ error: currentT().environmentNotFound });
        return null;
      }
      const newPreset = createPreset(
        source.agentId,
        source.themeId,
        source.wallpaperId ?? null,
        newName,
      );
      const updated = [...presets, newPreset];
      const saved = await savePresets(updated);
      if (!saved) {
        set({ error: currentT().environmentSaveFailed });
        return null;
      }
      set({ presets: updated });
      useNotificationStore.getState().showToast(`${currentT().environmentDuplicated} ${newName}`);
      return newPreset;
    } catch {
      set({ error: currentT().environmentDuplicationFailed });
      return null;
    }
  },

  // -------------------------------------------------------------------
  // renameEnvironment
  // -------------------------------------------------------------------

  renameEnvironment: async (presetId, newName) => {
    try {
      const presets = get().presets;
      const updated = updatePreset(presets, presetId, { name: newName });
      const saved = await savePresets(updated);
      if (saved) {
        set({ presets: updated });
        useNotificationStore.getState().showToast(currentT().environmentRenamed);
        return true;
      }
      return false;
    } catch {
      set({ error: currentT().environmentRenameFailed });
      return false;
    }
  },
}));

// ---------------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------------

/** Look up a preset by id. */
export function selectPresetById(state: EnvironmentState, id: string): EnvironmentPreset | null {
  return state.presets.find((p) => p.id === id) ?? null;
}
