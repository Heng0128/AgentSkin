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
 * It reuses `useAppController` so the studio window gets the same bootstrap
 * (locale, system status, studio projects) and the same `agentSkin` IPC
 * surface as the main window — the studio's CDP snapshot/inspect handlers in
 * the main process push events back to this window's webContents.
 */

import { useEffect, useRef } from 'react';
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
  const isRefreshing = useStatusStore((s) => s.isRefreshing);

  // Poll system status
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const triggerPoll = () => {
      if (isRefreshing) return;
      void refreshStatus();
    };
    const initRafId = requestAnimationFrame(triggerPoll);
    pollRef.current = setInterval(triggerPoll, 5000);
    return () => {
      cancelAnimationFrame(initRafId);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshStatus, isRefreshing]);

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
