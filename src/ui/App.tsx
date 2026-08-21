// SPDX-License-Identifier: MPL-2.0

import { lazy, Suspense, useEffect, useRef } from 'react';
import CommandPalette from '@/components/CommandPalette';
import { DetailPanel } from '@/components/detail-panel';
import { DialogsHost } from '@/components/dialogs-host';
import { DynamicBackground } from '@/components/dynamic-background';
import { ErrorBoundary } from '@/components/error-boundary';
import { InjectDock } from '@/components/inject-dock';
import { InstallWizard } from '@/components/install-progress';
import { Sidebar } from '@/components/sidebar';
import { StatusBar } from '@/components/status-bar';
import { TitleBar } from '@/components/title-bar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { type Selection, useAppController } from '@/hooks/useAppController';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

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
const AppsPage = lazy(() => import('@/pages/AppsPage').then((m) => ({ default: m.AppsPage })));

export default function App() {
  const controller = useAppController();
  const palette = useCommandPalette();
  const lastSelection = useRef<Selection>(null);
  const radiusScale = useSettingsStore((s) => s.radiusScale);
  const density = useSettingsStore((s) => s.density);
  const motion = useSettingsStore((s) => s.motion);

  // Sync the user-selected corner-radius scale to the CSS variable on
  // :root so every component using rounded-[var(--dl-radius,2px)] reacts.
  useEffect(() => {
    document.documentElement.style.setProperty('--dl-radius', `${radiusScale}px`);
  }, [radiusScale]);

  // Sync the user-selected density to a CSS variable so spacing-aware
  // components can scale proportionally (--dl-density-scale).
  useEffect(() => {
    const scale = density === 'compact' ? '0.85' : density === 'cozy' ? '1.15' : '1';
    document.documentElement.style.setProperty('--dl-density-scale', scale);
  }, [density]);

  // Sync the user-selected motion intensity: reduce half, none = 0.
  // Also toggles data-motion on <html> for targeted selectors and honors
  // prefers-reduced-motion automatically via the 'none' branch.
  useEffect(() => {
    const multiplier = motion === 'reduced' ? '0.5' : motion === 'none' ? '0' : '1';
    document.documentElement.style.setProperty('--duration-multiplier', multiplier);
    document.documentElement.dataset.motion = motion;
  }, [motion]);
  // P2-6: Previously this assignment ran inside the render function body,
  // violating React's purity requirement (writing to a ref during render is a
  // side-effect visible outside the render). In Strict Mode renders can run
  // twice, so the ref's value would unpredictably clobber the "last" value.
  // Moving it into a useEffect guarantees it only runs once per actual
  // committed selection change.
  useEffect(() => {
    if (controller.selection) lastSelection.current = controller.selection;
  }, [controller.selection]);

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
        <TitleBar hasWallpaper={!!activeWallpaper} />

        <div
          className={cn(
            'grid min-h-0 transition-[grid-template-columns] duration-slow ease-out',
            controller.route === 'settings'
              ? 'grid-cols-[1fr]'
              : controller.sidebarCollapsed
                ? 'grid-cols-[62px_minmax(0,1fr)]'
                : 'grid-cols-[224px_minmax(0,1fr)]',
          )}
        >
          {controller.route !== 'settings' && <Sidebar />}

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* h-full (not min-h-full): the chain below relies on the parent
                  having a definite height — `height:100%` (h-full) in the pages
                  resolves against it. With min-height the resolved height stays
                  auto, so every page's h-full container collapsed to content
                  height and the inner scroll regions never engaged.
                  Padding kept minimal (8 top / 16 sides / 16 bottom) so pages
                  use nearly the full viewport — the sidebar/title/status bars
                  already frame the edges, and the inject dock floats above. */}
              <div
                className={cn(
                  'mx-auto h-full w-full p-[8px_16px_16px]',
                  controller.route !== 'settings' && 'max-w-[1240px]',
                )}
              >
                <div className="h-full animate-page-enter">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Spinner className="size-6" />
                      </div>
                    }
                  >
                    <ErrorBoundary inline>
                      {controller.route === 'workspace' && <WorkspacePage />}
                      {controller.route === 'apps' && <AppsPage />}
                      {controller.route === 'themes' && <ThemesPage controller={controller} />}
                      {controller.route === 'wallpaper' && (
                        <WallpaperEnginePage controller={controller} />
                      )}
                      {controller.route === 'settings' && <SettingsPage controller={controller} />}
                    </ErrorBoundary>
                  </Suspense>
                </div>
              </div>
            </div>
          </section>
        </div>

        <StatusBar />

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
              'fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-float',
              toast.tone === 'destructive'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-popover text-popover-foreground',
            )}
          >
            {toast.message}
          </div>
        ))}
      </main>
      {/* Sonner Toaster disabled — custom toast divs rendered above.
          Deliberately kept: the hand-written <div> stack (fixed, bottom-center,
          no max-count off-by-default) matches the historical UX and the
          controller's toast tone model (destructive vs. default) without
          bringing sonner's portal/stacking/animation into the app shell.
          <Toaster position="top-right" richColors /> is available in
          ui/components/ui/sonner.tsx if a future migration is warranted. */}

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} controller={controller} />
    </ErrorBoundary>
  );
}
