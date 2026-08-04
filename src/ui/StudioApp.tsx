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
import { BootScreen } from '@/components/boot-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { TitleBar } from '@/components/title-bar';
import { useAppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import { ThemeStudioPage } from '@/pages/ThemeStudioPage';

export default function StudioApp() {
  const controller = useAppController();

  // Pin the route to 'studio' so the title bar renders the right label.
  useEffect(() => {
    controller.setRoute('studio');
  }, [controller]);

  return (
    <ErrorBoundary locale={controller.locale}>
      <main
        className={cn(
          'relative z-10 flex h-svh flex-col overflow-hidden font-sans text-foreground bg-background',
        )}
      >
        <TitleBar controller={controller} />

        <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ThemeStudioPage controller={controller} />
        </section>

        {/* Opening/bootstrap overlay — covers the shell until boot completes. */}
        {controller.booting && <BootScreen hint={controller.t.bootLoading} leaving={false} />}
      </main>
    </ErrorBoundary>
  );
}
