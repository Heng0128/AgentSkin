// SPDX-License-Identifier: MPL-2.0

/**
 * # useEnvironmentActions
 *
 * Environment workflow actions — the bridge between UI interactions
 * and the underlying controller + preset store.
 *
 * This hook owns:
 *   - switchEnvironment()  : load preset → apply theme via controller
 *   - createEnvironment()  : save preset + optionally apply
 *   - deleteEnvironment()  : remove preset (does NOT affect runtime)
 *   - duplicateEnvironment(): clone a preset with a new name
 *   - renameEnvironment()  : rename an existing preset in-place
 *
 * Design:
 *   - All mutations go through EnvironmentStore (localStorage).
 *   - Runtime changes (apply theme) go through controller.
 *   - No direct controller calls from UI components.
 *   - Returns { switching, error, refresh } for UI feedback.
 *   - refresh() is called after mutations so the caller can re-derive environments.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createPreset,
  loadPresets,
  removePreset,
  savePresets,
  updatePreset,
  upsertPreset,
} from '@/storage/environment-store';
import type { EnvironmentModel, EnvironmentPreset } from '@/types/environment';

import { toMessage } from '@shared/errors';
import type { AppController } from './useAppController';
import { useNotifications } from './useNotifications';

export interface EnvironmentActionsResult {
  /** Currently switching environment (shows busy state). */
  switching: boolean;
  /** Last error message, or null. */
  error: string | null;

  /**
   * Switch to an environment by its EnvironmentModel id.
   * Loads the matching preset, then applies its theme via controller.
   * Auto-creates a preset if none exists for this agent+theme combo.
   */
  switchEnvironment: (env: EnvironmentModel) => Promise<boolean>;

  /**
   * Create a new environment preset.
   * If applyNow is true, also applies the theme via controller.
   */
  createEnvironment: (
    agentId: EnvironmentPreset['agentId'],
    themeId: EnvironmentPreset['themeId'],
    name?: string,
    applyNow?: boolean,
  ) => Promise<{ preset: EnvironmentPreset | null; success: boolean }>;

  /**
   * Delete an environment preset by id.
   * Does NOT affect runtime state — the theme stays applied until switched.
   */
  deleteEnvironment: (presetId: string) => boolean;

  /**
   * Duplicate an existing preset with a new name.
   */
  duplicateEnvironment: (presetId: string, newName: string) => EnvironmentPreset | null;

  /**
   * Rename an existing preset in-place.
   */
  renameEnvironment: (presetId: string, newName: string) => boolean;

  /**
   * Call after mutations to signal the UI to re-derive environments.
   * The caller manages the actual refresh mechanism (e.g., incrementing a key).
   */
  refresh: () => void;
}

/** Mutable counter shared between useEnvironmentActions and useEnvironments. */
let refreshCounter = 0;

export function useEnvironmentActions(controller: AppController): EnvironmentActionsResult {
  const { applyToApp, restoreApp, installed, t } = controller;
  const { showToast, fail } = useNotifications(t);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P0#3: use a local state tick in addition to the module counter so
  // incrementing refresh actually triggers a re-render in the caller.
  // The module counter remains for useEnvironments (a separate consumer
  // that reads via getRefreshCounter()).
  const [, setTick] = useState(0);

  // Signal that a mutation occurred
  const refresh = useCallback(() => {
    refreshCounter++;
    setTick((prev) => prev + 1);
  }, []);

  // --- switchEnvironment ---

  // Epoch guard: rapid consecutive switches must not let an earlier (slower)
  // flow's `finally { setSwitching(false) }` clear the busy state while a
  // newer flow is still in flight, nor let the older flow apply after a newer
  // one has superseded it.
  const switchEpochRef = useRef(0);

  const switchEnvironment = useCallback(
    async (env: EnvironmentModel): Promise<boolean> => {
      const myEpoch = ++switchEpochRef.current;
      setSwitching(true);
      setError(null);

      try {
        // Auto-create preset if none exists for this agent+theme combo
        const presets = loadPresets();
        const hasPreset = presets.some(
          (p) => p.agentId === env.agent.id && p.themeId === env.theme?.id,
        );
        if (!hasPreset) {
          const newPreset = createPreset(env.agent.id, env.theme?.id ?? null, env.name);
          // P1 audit #20: check the return value so a full localStorage
          // doesn't silently drop the preset while still applying the theme.
          // The user sees an error instead of a phantom preset.
          const saved = savePresets([...presets, newPreset]);
          if (!saved) {
            setError(t.environmentSaveFailed);
            // Continue with the apply — the theme still takes effect, just
            // without a persisted preset. The user can retry saving later.
          }
        }
        if (myEpoch !== switchEpochRef.current) return false;

        // Apply the theme via controller
        if (env.theme) {
          const ok = await applyToApp(env.theme.id, env.theme.name, env.agent.id);
          if (myEpoch !== switchEpochRef.current) return false;
          if (ok) {
            showToast(t.switchSuccess(env.name));
            refresh();
            return true;
          }
          return false;
        } else {
          // No theme = restore default
          await restoreApp(env.agent.id);
          if (myEpoch !== switchEpochRef.current) return false;
          showToast(t.nativeRestored(env.agent.displayName));
          refresh();
          return true;
        }
      } catch (err) {
        const msg = toMessage(err) || t.switchFailure;
        setError(msg);
        fail(err);
        return false;
      } finally {
        // Only the most recent switch may clear the busy state.
        if (myEpoch === switchEpochRef.current) setSwitching(false);
      }
    },
    [applyToApp, restoreApp, showToast, fail, refresh, t],
  );

  // --- createEnvironment ---

  const createEnvironment = useCallback(
    async (
      agentId: EnvironmentPreset['agentId'],
      themeId: EnvironmentPreset['themeId'],
      name?: string,
      applyNow = false,
    ): Promise<{ preset: EnvironmentPreset | null; success: boolean }> => {
      try {
        const presets = loadPresets();
        const preset = createPreset(agentId, themeId, name);
        const updated = upsertPreset(presets, agentId, themeId, name);
        const saved = savePresets(updated);
        if (!saved) {
          setError(t.environmentCreationFailed);
          return { preset: null, success: false };
        }

        // Optionally apply the theme immediately
        if (applyNow && themeId) {
          const theme = installed.find((th) => th.id === themeId);
          if (theme) {
            const ok = await applyToApp(themeId, theme.name, agentId);
            if (!ok) return { preset, success: false };
          }
        }

        showToast(name ? `${t.environmentCreated} ${name}` : t.environmentCreated);
        refresh();
        return { preset, success: true };
      } catch (err) {
        const msg = toMessage(err) || t.environmentCreationFailed;
        setError(msg);
        fail(err);
        return { preset: null, success: false };
      }
    },
    [applyToApp, installed, showToast, fail, refresh, t],
  );

  // --- deleteEnvironment ---

  const deleteEnvironment = useCallback(
    (presetId: string): boolean => {
      try {
        const presets = loadPresets();
        const updated = removePreset(presets, presetId);
        const saved = savePresets(updated);
        if (saved) {
          showToast(t.environmentDeleted);
          refresh();
          return true;
        }
        return false;
      } catch {
        setError(t.environmentDeletionFailed);
        return false;
      }
    },
    [showToast, refresh, t],
  );

  // --- duplicateEnvironment ---

  const duplicateEnvironment = useCallback(
    (presetId: string, newName: string): EnvironmentPreset | null => {
      try {
        const presets = loadPresets();
        const source = presets.find((p) => p.id === presetId);
        if (!source) {
          setError(t.environmentNotFound);
          return null;
        }
        const newPreset = createPreset(source.agentId, source.themeId, newName);
        const updated = [...presets, newPreset];
        // P1 audit #20: check the return value so a full localStorage doesn't
        // silently drop the duplicate while showing a success toast.
        const saved = savePresets(updated);
        if (!saved) {
          setError(t.environmentSaveFailed);
          return null;
        }
        showToast(`${t.environmentDuplicated} ${newName}`);
        refresh();
        return newPreset;
      } catch {
        setError(t.environmentDuplicationFailed);
        return null;
      }
    },
    [showToast, refresh, t],
  );

  // --- renameEnvironment ---

  const renameEnvironment = useCallback(
    (presetId: string, newName: string): boolean => {
      try {
        const presets = loadPresets();
        const updated = updatePreset(presets, presetId, { name: newName });
        const saved = savePresets(updated);
        if (saved) {
          showToast(t.environmentRenamed);
          refresh();
          return true;
        }
        return false;
      } catch {
        setError(t.environmentRenameFailed);
        return false;
      }
    },
    [showToast, refresh, t],
  );

  return {
    switching,
    error,
    switchEnvironment,
    createEnvironment,
    deleteEnvironment,
    duplicateEnvironment,
    renameEnvironment,
    refresh,
  };
}

// Expose the counter for useEnvironments to read
export function getRefreshCounter(): number {
  return refreshCounter;
}
