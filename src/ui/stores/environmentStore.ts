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

import {
  createPreset,
  loadPresets,
  removePreset,
  savePresets,
  updatePreset,
  upsertPreset,
} from '@/storage/environment-store';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useThemeStore } from '@/stores/themeStore';
import type { EnvironmentModel, EnvironmentPreset } from '@/types/environment';

import { toMessage } from '@shared/errors';
import { uiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
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
let switchEpoch = 0;

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
    name?: string,
    applyNow?: boolean,
  ) => Promise<{ preset: EnvironmentPreset | null; success: boolean }>;
  deleteEnvironment: (presetId: string) => boolean;
  duplicateEnvironment: (presetId: string, newName: string) => EnvironmentPreset | null;
  renameEnvironment: (presetId: string, newName: string) => boolean;

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

  loadPresets: () => {
    set({ presets: loadPresets() });
  },

  setSwitching: (switching) => set({ switching }),
  setError: (error) => set({ error }),

  // -------------------------------------------------------------------
  // switchEnvironment
  // -------------------------------------------------------------------

  switchEnvironment: async (env) => {
    const myEpoch = ++switchEpoch;
    set({ switching: true, error: null });

    try {
      // Auto-create preset if none exists for this agent+theme combo.
      const presets = get().presets;
      const hasPreset = presets.some(
        (p) => p.agentId === env.agent.id && p.themeId === env.theme?.id,
      );
      if (!hasPreset) {
        const newPreset = createPreset(env.agent.id, env.theme?.id ?? null, env.name);
        const saved = savePresets([...presets, newPreset], (error) => {
          useNotificationStore.getState().fail(error);
        });
        if (!saved) {
          // Continue with apply — the theme still takes effect, just without a
          // persisted preset. The user can retry saving later.
        }
        set({ presets: [...presets, newPreset] });
      }
      if (myEpoch !== switchEpoch) return false;

      // Apply the theme via themeStore.
      if (env.theme) {
        const ok = await useThemeStore
          .getState()
          .applyToApp(env.theme.id, env.theme.name, env.agent.id as AgentId);
        if (myEpoch !== switchEpoch) return false;
        if (ok) {
          useNotificationStore.getState().showToast(currentT().switchSuccess(env.name));
          return true;
        }
        return false;
      }

      // No theme = restore default.
      await useThemeStore.getState().restoreApp(env.agent.id as AgentId);
      if (myEpoch !== switchEpoch) return false;
      useNotificationStore.getState().showToast(currentT().nativeRestored(env.agent.displayName));
      return true;
    } catch (err) {
      const msg = toMessage(err) || currentT().switchFailure;
      set({ error: msg });
      useNotificationStore.getState().fail(err);
      return false;
    } finally {
      // Only the most recent switch may clear the busy state.
      if (myEpoch === switchEpoch) set({ switching: false });
    }
  },

  // -------------------------------------------------------------------
  // createEnvironment
  // -------------------------------------------------------------------

  createEnvironment: async (agentId, themeId, name, applyNow = false) => {
    try {
      const presets = get().presets;
      const preset = createPreset(agentId, themeId, name);
      const updated = upsertPreset(presets, agentId, themeId, name);
      const saved = savePresets(updated);
      if (!saved) {
        set({ error: currentT().environmentCreationFailed });
        return { preset: null, success: false };
      }
      set({ presets: updated });

      // Optionally apply the theme immediately through themeStore.
      if (applyNow && themeId) {
        const theme = useThemeStore.getState().installed.find((th) => th.id === themeId);
        if (theme) {
          const ok = await useThemeStore.getState().applyToApp(themeId, theme.name, agentId);
          if (!ok) return { preset, success: false };
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

  deleteEnvironment: (presetId) => {
    try {
      const presets = get().presets;
      const updated = removePreset(presets, presetId);
      const saved = savePresets(updated);
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

  duplicateEnvironment: (presetId, newName) => {
    try {
      const presets = get().presets;
      const source = presets.find((p) => p.id === presetId);
      if (!source) {
        set({ error: currentT().environmentNotFound });
        return null;
      }
      const newPreset = createPreset(source.agentId, source.themeId, newName);
      const updated = [...presets, newPreset];
      const saved = savePresets(updated);
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

  renameEnvironment: (presetId, newName) => {
    try {
      const presets = get().presets;
      const updated = updatePreset(presets, presetId, { name: newName });
      const saved = savePresets(updated);
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
