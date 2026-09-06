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
import { useDialogStore } from '@/stores/dialogStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useThemeStore } from '@/stores/themeStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';

import { toMessage } from '@shared/errors';
import { getCurrentT } from '@shared/i18n/runtime-t';
import type { EnvironmentModel, EnvironmentPreset } from '@shared/types/environment';
import { create } from 'zustand';

function currentT() {
  // RC-6: Delegates to the shared accessor (single source of truth).
  return getCurrentT();
}

// ---------------------------------------------------------------------------
// SwitchEpochGuard — encapsulates module-level epoch state (P1-2 fix)
// ---------------------------------------------------------------------------

/**
 * ## SwitchEpochGuard
 *
 * Owns the per-agent epoch counters used by `switchEnvironment` to guard
 * against stale `finally` blocks clearing a newer flow's busy state.
 * Previously a bare module-level `Map` that leaked across test runs.
 */
class SwitchEpochGuard {
  private readonly epochs = new Map<string, number>();

  /** Get the next epoch for an agent (increments the counter). */
  next(appId: string): number {
    const current = this.epochs.get(appId) ?? 0;
    // No reset needed — the epochs map is bounded by the number of unique
    // agents (one entry per agent that has ever called switchEnvironment),
    // not by total call count. Each agent's epoch increments monotonically,
    // so a stale finally block's `myEpoch === current` check always works.
    // Number.MAX_SAFE_INTEGER is ~9e15 — effectively unreachable.
    const next = current + 1;
    this.epochs.set(appId, next);
    return next;
  }

  /** Peek at the current epoch for an agent (without incrementing). */
  current(appId: string): number {
    return this.epochs.get(appId) ?? 0;
  }

  /** Remove an agent's epoch entry (called when a switch completes). */
  delete(appId: string): void {
    this.epochs.delete(appId);
  }

  /** Current size of the epoch map — for diagnostics. */
  get size(): number {
    return this.epochs.size;
  }

  /** Reset all epoch state — for test isolation. */
  reset(): void {
    this.epochs.clear();
  }
}

const switchEpochGuard = new SwitchEpochGuard();

/** Current size of the switch-epoch guard map — used by the concurrency
 *  reporter to push live diagnostics to the main process. */
export function getSwitchEpochSize(): number {
  return switchEpochGuard.size;
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
  /** REQ-I-010: Remove presets referencing a deleted theme. */
  purgeTheme: (themeId: string) => void;
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
    const myEpoch = switchEpochGuard.next(appId);
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
        const pending = [...presets, newPreset];
        const saved = await savePresets(pending, (error) => {
          useNotificationStore.getState().fail(error);
        });
        // Only update in-memory state on successful persist — otherwise
        // the UI would show a preset that doesn't survive a reload.
        if (saved) {
          set({ presets: pending });
        }
      }
      if (myEpoch !== switchEpochGuard.current(appId)) return false;

      // --- Theme half ---
      if (env.theme) {
        const ok = await useThemeStore
          .getState()
          .applyToApp(env.theme.id, env.theme.name, env.agent.id);
        if (myEpoch !== switchEpochGuard.current(appId)) return false;
        if (!ok) return false;
      } else {
        // No theme = restore native theme.
        await useThemeStore.getState().restoreApp(env.agent.id);
        if (myEpoch !== switchEpochGuard.current(appId)) return false;
      }

      // --- Wallpaper half (REQ-I-008: delegate to wallpaperStore for single source of truth) ---
      // Wallpaper failure is non-blocking: report via notification but do not
      // roll back the switch. Theme restoration already happened above.
      if (wallpaperId) {
        const wp = await useWallpaperStore
          .getState()
          .setAndApplyAgentWallpaper(env.agent.id, true, wallpaperId);
        if (myEpoch !== switchEpochGuard.current(appId)) return false;
        if (!wp.ok) {
          useNotificationStore
            .getState()
            .fail(new Error(wp.detail ?? wp.reason ?? 'wallpaper apply failed'));
        }
      } else {
        // No wallpaper bound — clear any previously injected wallpaper via wallpaperStore.
        const result = await useWallpaperStore
          .getState()
          .setAndApplyAgentWallpaper(env.agent.id, false, null);
        if (myEpoch !== switchEpochGuard.current(appId)) return false;
        if (!result.ok) {
          useNotificationStore
            .getState()
            .fail(new Error(result.detail ?? result.reason ?? 'wallpaper remove failed'));
        }
      }

      // Clear any stale restart prompts from a superseded switch. Guarded
      // by epoch so we never wipe a newer switch's prompt mid-flight.
      if (myEpoch === switchEpochGuard.current(appId)) {
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
      // Do NOT delete the epoch here: deleting causes a race where a later
      // concurrent call's finally block sees current()=0 (after delete) and
      // skips the clear, leaving switching permanently stuck at true.
      // The epoch map is overwritten by the next call's next() and cleared
      // by reset() for test isolation.
      if (myEpoch === switchEpochGuard.current(appId)) {
        set({ switching: false });
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
      const saved = await savePresets(updated, (error) => {
        useNotificationStore.getState().fail(error);
      });
      if (!saved) {
        set({ error: currentT().environmentCreationFailed });
        return { preset: null, success: false };
      }
      set({ presets: updated });

      // Optionally apply the full environment immediately (REQ-I-008: delegate to wallpaperStore).
      if (applyNow && themeId) {
        const theme = useThemeStore.getState().installed.find((th) => th.id === themeId);
        if (theme) {
          const ok = await useThemeStore.getState().applyToApp(themeId, theme.name, agentId);
          if (!ok) {
            // Roll back the preset from store — the user asked to create+apply
            // as one atomic operation; a failed apply means the whole op failed.
            set({ presets });
            return { preset: null, success: false };
          }
        }
        if (wallpaperId) {
          await useWallpaperStore.getState().setAndApplyAgentWallpaper(agentId, true, wallpaperId);
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
      const saved = await savePresets(updated, (error) => {
        useNotificationStore.getState().fail(error);
      });
      if (saved) {
        set({ presets: updated });
        useNotificationStore.getState().showToast(currentT().environmentDeleted);
        return true;
      }
      return false;
    } catch (err) {
      set({ error: currentT().environmentDeletionFailed });
      useNotificationStore.getState().fail(err);
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
      const saved = await savePresets(updated, (error) => {
        useNotificationStore.getState().fail(error);
      });
      if (!saved) {
        set({ error: currentT().environmentSaveFailed });
        return null;
      }
      set({ presets: updated });
      useNotificationStore.getState().showToast(`${currentT().environmentDuplicated} ${newName}`);
      return newPreset;
    } catch (err) {
      set({ error: currentT().environmentDuplicationFailed });
      useNotificationStore.getState().fail(err);
      return null;
    }
  },

  // -------------------------------------------------------------------
  // renameEnvironment
  // -------------------------------------------------------------------

  renameEnvironment: async (presetId, newName) => {
    try {
      // Validate name length before attempting persist — the main process
      // rejects names > 512 chars (isValidPreset), so failing fast here
      // avoids a confusing round-trip failure.
      if (newName.length > 512) {
        set({ error: currentT().environmentRenameFailed });
        return false;
      }
      const presets = get().presets;
      const updated = updatePreset(presets, presetId, { name: newName });
      const saved = await savePresets(updated, (error) => {
        useNotificationStore.getState().fail(error);
      });
      if (saved) {
        set({ presets: updated });
        useNotificationStore.getState().showToast(currentT().environmentRenamed);
        return true;
      }
      return false;
    } catch (err) {
      set({ error: currentT().environmentRenameFailed });
      useNotificationStore.getState().fail(err);
      return false;
    }
  },

  // -------------------------------------------------------------------
  // REQ-I-010: purgeTheme — remove presets referencing a deleted theme
  // -------------------------------------------------------------------
  purgeTheme: (themeId) => {
    const presets = get().presets;
    const filtered = presets.filter((p) => p.themeId !== themeId);
    if (filtered.length !== presets.length) {
      set({ presets: filtered });
      // Best-effort persist; swallow errors to avoid blocking the caller.
      void savePresets(filtered).catch((err) => {
        useNotificationStore.getState().fail(err);
      });
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all module-level epoch guard state.
 * Call this in test `beforeEach` to prevent state leakage across tests.
 */
export function resetSwitchEpochGuard(): void {
  switchEpochGuard.reset();
}
