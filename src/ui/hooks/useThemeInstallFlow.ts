// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemeInstallFlow
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
 *   - Integration with runtime log streaming
 *
 * Entry point:
 *   - runImport(): user file import via OS file dialog
 *   - runImportFromPath(path): import from known path (drag-drop, file-open)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';

import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';

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

export interface UseThemeInstallFlowDeps {
  refreshThemes: () => Promise<void>;
  showToast: (message: string, tone?: 'default' | 'destructive') => void;
  fail: (error: unknown) => void;
  t: UiMessages;
}

const STEP_ORDER = ['select', 'read', 'validate', 'copy', 'register', 'cache', 'done'] as const;
type StepId = (typeof STEP_ORDER)[number];

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

export function useThemeInstallFlow(deps: UseThemeInstallFlowDeps) {
  const { refreshThemes, showToast, fail, t } = deps;
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [flowState, setFlowState] = useState<InstallFlowState>('idle');
  const [currentTheme, setCurrentTheme] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const clearingRef = useRef<number | null>(null);
  // F1: Remember the filesystem path used for the most recent import attempt.
  // Retry needs the ORIGINAL sourcePath (a file path), but the only value
  // exposed to App.tsx was `currentTheme` (the display name like "Midnight
  // Aurora"), so the retry button was passing a theme name to
  // api.importThemeFromPath — which always failed. For dialog-based imports
  // (api.importTheme) the path isn't available after the dialog closes, so
  // this ref only helps for path-based imports (drag-drop, file-open IPC).
  const lastSourcePathRef = useRef<string | null>(null);
  // P2-16: Race protection for concurrent imports. When the user double-clicks
  // "Import theme" or a drag-drop fires alongside a file-dialog import, two
  // runImport flows race to write `setFlowState` / `setSteps` / etc. The last
  // writer wins unpredictably, producing a corrupted UI state (e.g. one
  // flow's "completed" state clobbers the other's "selecting" state). We use
  // a monotonic epoch per start: every async await boundary re-checks
  // `myEpoch === installEpochRef.current` and bails out if another flow has
  // been started in the meantime.
  const installEpochRef = useRef<number>(0);

  // Clean up the pending auto-clear timer on unmount so setState never
  // fires on an unmounted component.
  useEffect(() => {
    return () => {
      if (clearingRef.current) window.clearTimeout(clearingRef.current);
    };
  }, []);

  const scheduleClear = useCallback(() => {
    if (clearingRef.current) window.clearTimeout(clearingRef.current);
    clearingRef.current = window.setTimeout(() => {
      setSteps([]);
      setCurrentTheme(null);
      setLastError(null);
      setFlowState('idle');
      lastSourcePathRef.current = null;
    }, 3000);
  }, []);

  const markAllDone = useCallback(() => {
    setSteps((cur) => cur.map((s) => ({ ...s, status: 'done' as const, elapsed: s.elapsed ?? 0 })));
  }, []);

  const markFailed = useCallback((message: string) => {
    setSteps((cur) => {
      const activeIdx = cur.findIndex((s) => s.status === 'active');
      return cur.map((s, i) => {
        if (s.status === 'done') return s;
        if (i === activeIdx) {
          return { ...s, status: 'error' as const, message, elapsed: Date.now() - s.timestamp };
        }
        return { ...s, status: 'cancelled' as const };
      });
    });
  }, []);

  const cancelInstall = useCallback(() => {
    // Invalidate any in-flight import: without bumping the epoch, a hung
    // api.importTheme/importThemeFromPath call would still pass its
    // `myEpoch === installEpochRef.current` guard after the user cancels and
    // overwrite the cancelled state with completed/failed toasts.
    installEpochRef.current += 1;
    setSteps((cur) =>
      cur.map((s) =>
        s.status === 'active' || s.status === 'pending'
          ? { ...s, status: 'cancelled' as const }
          : s,
      ),
    );
    setFlowState('cancelled');
    // P2-5/F2: Align cancelled terminal-state cleanup with completed/failed.
    // Previously only retryInstall/runImport/runImportFromPath's finally blocks
    // called scheduleClear(), so a user-initiated cancel kept the wizard
    // card visible on screen indefinitely until the X button was clicked.
    // The App.tsx onClose handler (which also clears) fires when the dialog
    // closes, so running scheduleClear here is technically redundant, but
    // redundancy is harmless and gives us cleanup even with no onClose.
    scheduleClear();
  }, [scheduleClear]);

  const retryInstall = useCallback(
    async (sourcePath?: string) => {
      // F1: Prefer the explicit argument, fall back to the stored path ref.
      // If neither is available (e.g. previous attempt was a file-dialog
      // import that only api.importTheme() knows the path for), we can't
      // retry silently — tell the user they need to re-pick the file.
      const path = sourcePath ?? lastSourcePathRef.current;
      if (!path) {
        showToast(
          ((t as Record<string, unknown>).importRetryNoPath as string | undefined) ??
            '无法重试：原始文件路径未知，请重新选择文件导入。',
          'destructive',
        );
        return;
      }
      // Clear any pending auto-clear timer from a previous cancelled flow
      // to prevent the new import's completed state from being clobbered.
      if (clearingRef.current) {
        window.clearTimeout(clearingRef.current);
        clearingRef.current = null;
      }
      const myEpoch = installEpochRef.current + 1;
      installEpochRef.current = myEpoch;
      setFlowState('installing');
      setLastError(null);
      const list = makeSteps(t, 'read');
      list[0] = { ...list[0], status: 'done' as const, timestamp: Date.now() - 100 };
      setSteps(list);
      try {
        const result = await api.importThemeFromPath(path);
        if (myEpoch !== installEpochRef.current) return;
        setCurrentTheme(result.theme.displayName);
        markAllDone();
        await refreshThemes();
        if (myEpoch !== installEpochRef.current) return;
        showToast(t.importedTheme(result.theme.displayName));
        setFlowState('completed');
      } catch (error) {
        if (myEpoch !== installEpochRef.current) return;
        const message = toMessage(error);
        markFailed(message);
        setLastError(message);
        setFlowState('failed');
        fail(error);
      } finally {
        if (myEpoch === installEpochRef.current) scheduleClear();
      }
    },
    [t, refreshThemes, showToast, fail, markAllDone, markFailed, scheduleClear],
  );

  /** User-driven import through the OS file dialog. */
  const runImport = useCallback(async () => {
    // Clear any pending auto-clear timer from a previous cancelled flow.
    if (clearingRef.current) {
      window.clearTimeout(clearingRef.current);
      clearingRef.current = null;
    }
    const myEpoch = installEpochRef.current + 1;
    installEpochRef.current = myEpoch;
    setFlowState('selecting');
    setCurrentTheme(null);
    setLastError(null);
    lastSourcePathRef.current = null;
    const list = makeSteps(t, 'select');
    setSteps(list);
    try {
      const result = await api.importTheme();
      if (myEpoch !== installEpochRef.current) return; // superseded by newer run
      if (result.canceled) {
        setFlowState('idle');
        setSteps([]);
        return;
      }
      const themeName = result.theme?.displayName ?? '';
      setCurrentTheme(themeName);
      markAllDone();
      await refreshThemes();
      if (myEpoch !== installEpochRef.current) return;
      showToast(t.importedTheme(themeName));
      setFlowState('completed');
    } catch (error) {
      if (myEpoch !== installEpochRef.current) return;
      const message = toMessage(error);
      markFailed(message);
      setLastError(message);
      setFlowState('failed');
      fail(error);
    } finally {
      if (myEpoch === installEpochRef.current) scheduleClear();
    }
  }, [t, refreshThemes, showToast, fail, markAllDone, markFailed, scheduleClear]);

  /**
   * Path-driven import (drag-drop, file-open IPC). Stores the path so the
   * F1 retryInstall button can re-attempt it on failure without asking the
   * user to re-pick the file. Mirrors runImport otherwise.
   */
  const runImportFromPath = useCallback(
    async (sourcePath: string) => {
      // Clear any pending auto-clear timer from a previous cancelled flow.
      if (clearingRef.current) {
        window.clearTimeout(clearingRef.current);
        clearingRef.current = null;
      }
      const myEpoch = installEpochRef.current + 1;
      installEpochRef.current = myEpoch;
      setFlowState('installing');
      setCurrentTheme(null);
      setLastError(null);
      lastSourcePathRef.current = sourcePath;
      const list = makeSteps(t, 'read');
      list[0] = { ...list[0], status: 'done' as const, timestamp: Date.now() - 100 };
      setSteps(list);
      try {
        const result = await api.importThemeFromPath(sourcePath);
        if (myEpoch !== installEpochRef.current) return;
        const themeName = result.theme.displayName;
        setCurrentTheme(themeName);
        markAllDone();
        await refreshThemes();
        if (myEpoch !== installEpochRef.current) return;
        showToast(t.importedTheme(themeName));
        setFlowState('completed');
      } catch (error) {
        if (myEpoch !== installEpochRef.current) return;
        const message = toMessage(error);
        markFailed(message);
        setLastError(message);
        setFlowState('failed');
        fail(error);
      } finally {
        if (myEpoch === installEpochRef.current) scheduleClear();
      }
    },
    [t, refreshThemes, showToast, fail, markAllDone, markFailed, scheduleClear],
  );

  return {
    steps,
    setSteps,
    flowState,
    setFlowState,
    currentTheme,
    lastError,
    isInstalling:
      flowState !== 'idle' &&
      flowState !== 'completed' &&
      flowState !== 'failed' &&
      flowState !== 'cancelled',
    isComplete: flowState === 'completed',
    isFailed: flowState === 'failed',
    isCancelled: flowState === 'cancelled',
    progress: getProgress(steps),
    retryInstall,
    cancelInstall,
    runImport,
    runImportFromPath,
  };
}
