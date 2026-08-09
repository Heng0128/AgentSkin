// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioApp
 *
 * Trimmed application shell for the standalone Theme Studio window. Unlike
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

import { useEffect } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { TitleBar } from '@/components/title-bar';
import { cn } from '@/lib/utils';
import { ThemeStudioPage } from '@/pages/ThemeStudioPage';
import { useShellStore } from '@/stores/shellStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';

export default function StudioApp() {
  const locale = useShellStore((s) => s.locale);
  const setRoute = useShellStore((s) => s.setRoute);

  // Pin the route to 'studio' so the title bar renders the right label.
  useEffect(() => {
    setRoute('studio');
  }, [setRoute]);

  const t: UiMessages = uiMessages[locale];

  // 全局 Undo/Redo 快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做。
  // 输入框/文本域/下拉聚焦时跳过，避免与输入框原生撤销冲突。
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
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
      <main
        className={cn(
          'relative z-10 flex h-svh flex-col overflow-hidden font-sans text-foreground bg-background',
        )}
      >
        <TitleBar />

        <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ThemeStudioPage t={t} />
        </section>
      </main>
    </ErrorBoundary>
  );
}
