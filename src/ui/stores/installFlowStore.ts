// SPDX-License-Identifier: MPL-2.0

/**
 * # installFlowStore
 *
 * Drives a real install step sequence with full state machine:
 *
 *   idle → selecting → reading → validating → copying → registering → caching → completed
 *                                               ↘ failed (retry / cancel)
 *
 * Features:
 *   - Real step-by-step progress (no fake random progress)
 *   - Cancel and retry support
 *   - Persistent step state for error recovery
 *   - Cross-store wiring: refreshes the theme catalog (themeStore) on success
 *
 * Extracted from `useThemeInstallFlow` (Phase A3). Translation strings (`t`)
 * and module-level imperative handles (timers, epoch, source path) keep the
 * same semantics as the original hook.
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useThemeStore } from '@/stores/themeStore';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import { create } from 'zustand';
import { withImportLock } from './import-guard';

export type InstallStepStatus = 'pending' | 'active' | 'done' | 'error' | 'cancelled';

export interface InstallStep {
  id: string;
  label: string;
  status: InstallStepStatus;
  message?: string;
  timestamp: number;
  elapsed?: number;
}

export type InstallFlowState =
  | 'idle'
  | 'selecting'
  | 'installing'
  | 'completed'
  | 'failed'
  | 'cancelled';

const STEP_ORDER = ['select', 'read', 'validate', 'copy', 'register', 'cache', 'done'] as const;
type StepId = (typeof STEP_ORDER)[number];

/** Build the i18n dictionary for the current locale. */
function currentT(): UiMessages {
  const locale = useShellStore.getState().locale;
  return uiMessages[locale];
}

function makeSteps(t: UiMessages, activeId: StepId = 'read'): InstallStep[] {
  const map: Record<string, string> = {
    select: t.installAwaitingFile,
    read: t.installReadingManifest,
    validate: t.installValidating,
    copy: t.installCopying,
    register: t.installRegistering,
    cache: t.installUpdatingCache,
    done: t.installCompleted,
  };
  const activeIdx = STEP_ORDER.indexOf(activeId);
  return STEP_ORDER.map((id, i) => ({
    id,
    label: map[id],
    status:
      i < activeIdx
        ? ('done' as const)
        : i === activeIdx
          ? ('active' as const)
          : ('pending' as const),
    timestamp: i <= activeIdx ? Date.now() : 0,
  }));
}

function getProgress(steps: InstallStep[]): number {
  const total = steps.length;
  if (total === 0) return 0;
  const done = steps.filter((s) => s.status === 'done').length;
  const active = steps.some((s) => s.status === 'active') ? 0.5 : 0;
  return Math.round(((done + active) / total) * 100);
}

// --- Module-level imperative handles (mirrors the original hook's refs) ---
// Explicit `number` rather than Node's Timeout — renderer code runs in a
// browser env where setTimeout returns an id (and tsconfig has no DOM lib).
let clearingHandle: number | null = null;
let installEpoch = 0;
let lastSourcePath: string | null = null;

interface InstallFlowState_ {
  steps: InstallStep[];
  flowState: InstallFlowState;
  currentTheme: string | null;
  lastError: string | null;

  // Derived flags (kept on the store so consumers read them directly).
  isInstalling: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  progress: number;

  // --- Controls ---
  setSteps: (steps: InstallStep[]) => void;
  setFlowState: (state: InstallFlowState) => void;
  retryInstall: (sourcePath?: string) => Promise<void>;
  cancelInstall: () => void;
  /** User-driven import through the OS file dialog. */
  runImport: () => Promise<void>;
  /** Path-driven import (drag-drop, file-open IPC). */
  runImportFromPath: (sourcePath: string) => Promise<void>;
}

export const useInstallFlowStore = create<InstallFlowState_>((set, _get) => {
  /** Clear the wizard card after a terminal state — fire-and-forget. */
  const scheduleClear = () => {
    if (clearingHandle) window.clearTimeout(clearingHandle);
    clearingHandle = window.setTimeout(() => {
      clearingHandle = null;
      set({
        steps: [],
        currentTheme: null,
        lastError: null,
        flowState: 'idle',
      });
      lastSourcePath = null;
    }, 3000);
  };

  const markAllDone = () => {
    set((cur) => ({
      steps: cur.steps.map((s) => ({ ...s, status: 'done' as const, elapsed: s.elapsed ?? 0 })),
    }));
  };

  const markFailed = (message: string) => {
    set((cur) => {
      const activeIdx = cur.steps.findIndex((s) => s.status === 'active');
      return {
        steps: cur.steps.map((s, i) => {
          if (s.status === 'done') return s;
          if (i === activeIdx) {
            return { ...s, status: 'error' as const, message, elapsed: Date.now() - s.timestamp };
          }
          return { ...s, status: 'cancelled' as const };
        }),
      };
    });
  };

  /**
   * Shared import body for dialog + path-driven flows. `startSelecting` puts
   * the wizard in the "selecting" state with a "select" active step before
   * awaiting the OS dialog; `false` skips straight to "read" (path flows).
   */
  const runImportInternal = async (startSelecting: boolean, path?: string): Promise<void> => {
    if (clearingHandle) {
      window.clearTimeout(clearingHandle);
      clearingHandle = null;
    }
    const myEpoch = installEpoch + 1;
    installEpoch = myEpoch;

    if (startSelecting) {
      lastSourcePath = null;
      set({ flowState: 'selecting', currentTheme: null, lastError: null });
    } else {
      set({ flowState: 'installing', currentTheme: null, lastError: null });
      lastSourcePath = path ?? null;
    }

    const t = currentT();
    const list = makeSteps(t, startSelecting ? 'select' : 'read');
    if (!startSelecting) {
      list[0] = { ...list[0], status: 'done' as const, timestamp: Date.now() - 100 };
    }
    set({ steps: list });

    try {
      // Dialog flow (api.importTheme) → DialogResult (has canceled).
      // Path flow (api.importThemeFromPath) → FileImportResult.
      if (!path) {
        const dialogResult = await api.importTheme();
        if (dialogResult.canceled) {
          set({ flowState: 'idle', steps: [] });
          return;
        }
        if (myEpoch !== installEpoch) return;
        const themeName = dialogResult.theme?.displayName ?? '';
        set({ currentTheme: themeName });
        markAllDone();
        await useThemeStore.getState().refreshThemes();
        if (myEpoch !== installEpoch) return;
        useNotificationStore.getState().showToast(t.importedTheme(themeName));
        set({ flowState: 'completed' });
      } else {
        let fileResult: Awaited<ReturnType<typeof api.importThemeFromPath>> | undefined;
        const didAcquire = await withImportLock(path, async () => {
          fileResult = await api.importThemeFromPath(path);
        });
        if (!didAcquire) return;
        if (myEpoch !== installEpoch) return;
        if (!fileResult) return;
        const themeName = fileResult.theme.displayName;
        set({ currentTheme: themeName });
        markAllDone();
        await useThemeStore.getState().refreshThemes();
        if (myEpoch !== installEpoch) return;
        useNotificationStore.getState().showToast(t.importedTheme(themeName));
        set({ flowState: 'completed' });
      }
    } catch (error) {
      if (myEpoch !== installEpoch) return;
      const message = toMessage(error);
      markFailed(message);
      set({ lastError: message, flowState: 'failed' });
      useNotificationStore.getState().fail(error);
    } finally {
      if (myEpoch === installEpoch) scheduleClear();
    }
  };

  return {
    steps: [],
    flowState: 'idle',
    currentTheme: null,
    lastError: null,

    isInstalling: false,
    isComplete: false,
    isFailed: false,
    isCancelled: false,
    progress: 0,

    setSteps: (steps) => set({ steps }),
    setFlowState: (flowState) => set({ flowState }),

    cancelInstall: () => {
      installEpoch += 1;
      set((cur) => ({
        steps: cur.steps.map((s) =>
          s.status === 'active' || s.status === 'pending'
            ? { ...s, status: 'cancelled' as const }
            : s,
        ),
        flowState: 'cancelled',
      }));
      scheduleClear();
    },

    retryInstall: async (sourcePath) => {
      const t = currentT();
      const path = sourcePath ?? lastSourcePath;
      if (!path) {
        useNotificationStore
          .getState()
          .showToast(
            ((t as Record<string, unknown>).importRetryNoPath as string | undefined) ??
              '无法重试：原始文件路径未知，请重新选择文件导入。',
            'destructive',
          );
        return;
      }
      // Clear any pending auto-clear timer from a previous cancelled flow
      // to prevent the new import's completed state from being clobbered.
      if (clearingHandle) {
        window.clearTimeout(clearingHandle);
        clearingHandle = null;
      }
      const myEpoch = installEpoch + 1;
      installEpoch = myEpoch;
      set({ flowState: 'installing', lastError: null });
      const list = makeSteps(t, 'read');
      list[0] = { ...list[0], status: 'done' as const, timestamp: Date.now() - 100 };
      set({ steps: list });
      try {
        let result: Awaited<ReturnType<typeof api.importThemeFromPath>> | undefined;
        const didAcquire = await withImportLock(path, async () => {
          result = await api.importThemeFromPath(path);
        });
        if (!didAcquire) return;
        if (myEpoch !== installEpoch) return;
        if (!result) return;
        set({ currentTheme: result.theme.displayName });
        markAllDone();
        await useThemeStore.getState().refreshThemes();
        if (myEpoch !== installEpoch) return;
        useNotificationStore.getState().showToast(t.importedTheme(result.theme.displayName));
        set({ flowState: 'completed' });
      } catch (error) {
        if (myEpoch !== installEpoch) return;
        const message = toMessage(error);
        markFailed(message);
        set({ lastError: message, flowState: 'failed' });
        useNotificationStore.getState().fail(error);
      } finally {
        if (myEpoch === installEpoch) scheduleClear();
      }
    },

    runImport: () => runImportInternal(true),
    runImportFromPath: (sourcePath) => runImportInternal(false, sourcePath),
  };
});

/** Selector helpers — consumers compute these from the three state slices. */
export const selectInstallFlags = (s: InstallFlowState_) => ({
  isInstalling:
    s.flowState !== 'idle' &&
    s.flowState !== 'completed' &&
    s.flowState !== 'failed' &&
    s.flowState !== 'cancelled',
  isComplete: s.flowState === 'completed',
  isFailed: s.flowState === 'failed',
  isCancelled: s.flowState === 'cancelled',
  progress: getProgress(s.steps),
});

export { getProgress };
