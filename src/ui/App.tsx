// SPDX-License-Identifier: MPL-2.0

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BootScreen } from '@/components/boot-screen';
import { DetailPanel } from '@/components/detail-panel';
import { DialogsHost } from '@/components/dialogs-host';
import { DynamicBackground } from '@/components/dynamic-background';
import { ErrorBoundary } from '@/components/error-boundary';
import { InjectDock } from '@/components/inject-dock';
import { InstallWizard } from '@/components/install-progress';
import { LogDrawer } from '@/components/log-drawer';
import { Sidebar } from '@/components/sidebar';
import { StatusBar } from '@/components/status-bar';
import { TitleBar } from '@/components/title-bar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { type Selection, useAppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

// Lazy-load page components so each route is a separate chunk. On first
// navigation, only the requested page's JS is fetched — the initial bundle
// shrinks by the combined size of all 4 pages (~40% of business code), so
// the main window paints faster and the user reaches the first interactive
// state sooner. Subsequent route switches are instant (chunk already cached).
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const ThemesPage = lazy(() =>
  import('@/pages/ThemesPage').then((m) => ({ default: m.ThemesPage })),
);
const WallpaperEnginePage = lazy(() =>
  import('@/pages/WallpaperEnginePage').then((m) => ({ default: m.WallpaperEnginePage })),
);
const WorkspacePage = lazy(() =>
  import('@/pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);

export default function App() {
  const controller = useAppController();
  const lastSelection = useRef<Selection>(null);
  // P2-6: Previously this assignment ran inside the render function body,
  // violating React's purity requirement (writing to a ref during render is a
  // side-effect visible outside the render). In Strict Mode renders can run
  // twice, so the ref's value would unpredictably clobber the "last" value.
  // Moving it into a useEffect guarantees it only runs once per actual
  // committed selection change.
  useEffect(() => {
    if (controller.selection) lastSelection.current = controller.selection;
  }, [controller.selection]);

  // Unmount the boot overlay as soon as bootstrap finishes — the perceived
  // opening duration should match the real bootstrap time, not a fixed delay.
  const [showBoot, setShowBoot] = useState(true);
  useEffect(() => {
    if (controller.booting) return;
    const timer = window.setTimeout(() => setShowBoot(false), 200);
    return () => window.clearTimeout(timer);
  }, [controller.booting]);

  const activeWallpaper = controller.wallpaper.active;

  return (
    <ErrorBoundary locale={controller.locale}>
      <DynamicBackground wallpaper={activeWallpaper} render={controller.wallpaper.render} />
      <main
        className={cn(
          'relative z-10 grid h-full overflow-hidden font-sans text-foreground',
          // minmax(0,1fr) — plain `1fr` has an implicit min of auto (content
          // height): content taller than the viewport blows the row past the
          // window edge (clipped by overflow-hidden → black bands / lost
          // content), and shorter content leaves the row at content height
          // (inconsistent panel sizes across pages). minmax(0,1fr) locks the
          // middle row to the available space so every page fills identically.
          'grid-rows-[38px_minmax(0,1fr)_28px]',
          activeWallpaper ? 'bg-transparent' : 'bg-background',
        )}
        lang={controller.locale === 'zh-CN' ? 'zh-CN' : 'en'}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          controller.dropThemeFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <TitleBar controller={controller} hasWallpaper={!!activeWallpaper} />

        <div
          className={cn(
            'grid min-h-0 transition-[grid-template-columns] duration-slow ease-out',
            controller.sidebarCollapsed
              ? 'grid-cols-[62px_minmax(0,1fr)]'
              : 'grid-cols-[224px_minmax(0,1fr)]',
          )}
        >
          <Sidebar controller={controller} />

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* h-full (not min-h-full): the chain below relies on the parent
                  having a definite height — `height:100%` (h-full) in the pages
                  resolves against it. With min-height the resolved height stays
                  auto, so every page's h-full container collapsed to content
                  height and the inner scroll regions never engaged.
                  Padding: top 16 / bottom 28 — the old 64px bottom was reserved
                  for the inject dock, but that's a fixed overlay (default
                  closed), so a permanent 64px left big vertical whitespace at
                  the bottom of every page (wallpaper grid especially). */}
              <div className="mx-auto h-full w-full max-w-[1240px] p-[16px_24px_28px]">
                <div key={controller.route} className="h-full animate-page-enter">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Spinner className="size-6" />
                      </div>
                    }
                  >
                    {controller.route === 'workspace' && <WorkspacePage controller={controller} />}
                    {controller.route === 'themes' && <ThemesPage controller={controller} />}
                    {controller.route === 'wallpaper' && (
                      <WallpaperEnginePage controller={controller} />
                    )}
                    {controller.route === 'settings' && <SettingsPage controller={controller} />}
                  </Suspense>
                </div>
              </div>
            </div>
          </section>
        </div>

        <StatusBar controller={controller} />

        <Dialog
          open={controller.selection !== null}
          onOpenChange={(open) => {
            if (!open) controller.setSelection(null);
          }}
        >
          <DialogContent className="w-[calc(100vw-3rem)] max-w-3xl gap-0 overflow-hidden p-0">
            <DialogTitle className="sr-only">
              {(controller.selection ?? lastSelection.current)?.theme.name ?? ''}
            </DialogTitle>
            <DetailPanel
              controller={controller}
              selection={controller.selection ?? lastSelection.current}
            />
          </DialogContent>
        </Dialog>

        <DialogsHost controller={controller} />
        <LogDrawer controller={controller} />
        <InjectDock controller={controller} />

        {/* Install wizard — replaces the old InstallProgress */}
        <InstallWizard
          steps={controller.installSteps}
          currentTheme={controller.currentTheme}
          lastError={controller.lastError}
          progress={controller.progress}
          isInstalling={controller.isInstalling}
          isComplete={controller.isComplete}
          isFailed={controller.isFailed}
          isCancelled={controller.isCancelled}
          onRetry={() => void controller.retryInstall()}
          onCancel={controller.cancelInstall}
          onClose={() => {
            controller.setSteps([]);
            controller.setFlowState('idle');
          }}
          logs={controller.logs}
          t={controller.t}
        />

        {controller.toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'animate-page-enter fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-lg',
              toast.tone === 'destructive'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-popover text-popover-foreground',
            )}
          >
            {toast.message}
          </div>
        ))}
      </main>

      {/* Opening sequence overlay — covers the app during bootstrap, then
        zooms-and-fades out (leaving) once the UI underneath is ready. */}
      {showBoot && <BootScreen hint={controller.t.bootLoading} leaving={!controller.booting} />}
    </ErrorBoundary>
  );
}
