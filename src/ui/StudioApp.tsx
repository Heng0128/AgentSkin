// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioApp
 *
 * Trimmed application shell for the standalone Studio window. Unlike
 * the main `App`, it has:
 *   - no sidebar / workspace navigation (the studio is reached via its own
 *     dedicated {@link BrowserWindow}, opened from the main window's sidebar)
 *   - no dynamic wallpaper background (a neutral `bg-background` surface)
 *   - a custom title bar with window controls + theme-mode toggle
 *   - the full {@link ThemeStudioPage} (snapshot / inspect / export)
 *
 * It does NOT call `useAppController` — the Studio window consumes status
 * via a dedicated `onStatusChanged` subscription in this file, and uses
 * the shared `useStatusStore` as the single source of truth for status.
 * A fallback poll is intentionally omitted: all status mutations originate
 * from the main process (apply/restore/delete/tray), which already fans-out
 * STATUS_CHANGED to both windows via `notifyStatusChanged()`.
 */

import { useEffect, useRef } from 'react';
import { api } from '@/api/agentSkinClient';
import { ErrorBoundary } from '@/components/error-boundary';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useStudioStore } from '@/stores/studioStore';

export default function StudioApp() {
  const locale = useShellStore((s) => s.locale);
  const setRoute = useShellStore((s) => s.setRoute);

  // Pin the route to 'studio' so the title bar renders the right label.
  useEffect(() => {
    setRoute('studio');
  }, [setRoute]);

  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const refreshStatus = useStatusStore((s) => s.refreshStatus);

  // Subscribe to STATUS_CHANGED push from main process (cross-window fan-out).
  // Drops the legacy 5s poll — all status mutations originate from the main
  // process which broadcasts to both windows via notifyStatusChanged().
  // isPollingRef prevents overlap if a push fires mid-refresh; mirrors the
  // guard pattern used in useBoot (main window) to avoid IPC/ CDP stacking.
  const isPollingRef = useRef(false);
  useEffect(() => {
    const triggerRefresh = () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      void refreshStatus().finally(() => {
        isPollingRef.current = false;
      });
    };
    const offStatusChanged = api.onStatusChanged(triggerRefresh);
    const initRafId = requestAnimationFrame(triggerRefresh);
    return () => {
      offStatusChanged();
      cancelAnimationFrame(initRafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStatus]);

  // Visual analysis progress — wire IPC subscription once at Studio boot.
  useEffect(() => {
    useStudioStore.getState().initAnalysisProgressSubscription();
  }, []);

  // Undo/Redo shortcuts
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return (
    <ErrorBoundary locale={locale}>
      <WorkspacePage />
    </ErrorBoundary>
  );
}
