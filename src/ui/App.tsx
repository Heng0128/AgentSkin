// SPDX-License-Identifier: MPL-2.0

import { lazy, Suspense, useEffect, useRef } from 'react';
import { DetailPanel } from '@/components/DetailPanel';
import { DialogsHost } from '@/components/DialogsHost';
import { DynamicBackground } from '@/components/DynamicBackground';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InjectDock } from '@/components/InjectDock';
import { InstallWizard } from '@/components/InstallProgress';
import { PageSkeleton } from '@/components/PageSkeleton';
import { Sidebar } from '@/components/Sidebar';
import { StatusBar } from '@/components/StatusBar';
import { TitleBar } from '@/components/TitleBar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { type Selection, useAppController } from '@/hooks/useAppController';
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
  const lastSelection = useRef<Selection>(null);
  const radiusScale = useSettingsStore((s) => s.radiusScale);
  const density = useSettingsStore((s) => s.density);
  const motion = useSettingsStore((s) => s.motion);

  // Sync the user-selected corner-radius scale to the CSS variable on
  // :root so every component using radius-aware tokens reacts.
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

  useEffect(() => {
    if (controller.selection) lastSelection.current = controller.selection;
  }, [controller.selection]);

  const activeWallpaper = controller.wallpaper.active;

  return (
    <ErrorBoundary locale={controller.locale}>
      <DynamicBackground wallpaper={activeWallpaper} render={controller.wallpaper.render} />
      <section
        role="region"
        className={cn(
          'relative z-[var(--z-content)] grid h-full overflow-hidden font-sans text-foreground',
          controller.route === 'settings'
            ? 'grid-rows-[minmax(0,1fr)]'
            : 'grid-rows-[minmax(0,1fr)_auto]',
          activeWallpaper ? 'bg-transparent' : 'bg-background',
        )}
        lang={controller.locale === 'zh-CN' ? 'zh-CN' : 'en'}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          controller.dropThemeFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div
          className={cn(
            'grid min-h-0 overflow-hidden',
            controller.route === 'settings' ? 'grid-cols-[1fr]' : 'grid-cols-[52px_1fr]',
          )}
        >
          {/* Left column: narrow icon sidebar */}
          {controller.route !== 'settings' && (
            <div className="flex h-full min-h-0 flex-col">
              <Sidebar />
            </div>
          )}

          {/* Main column: title bar + scrollable content */}
          <main className="flex min-h-0 flex-col overflow-hidden">
            {controller.route !== 'settings' && <TitleBar hasWallpaper={!!activeWallpaper} />}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div
                key={controller.route}
                className={cn('page-enter h-full', controller.route !== 'settings' && 'p-3')}
              >
                <Suspense fallback={<PageSkeleton />}>
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
          </main>
        </div>

        {/* Full-width status bar — spans the whole window below the nav */}
        {controller.route !== 'settings' && <StatusBar />}

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
              'fixed bottom-14 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-md border px-4 py-2 text-[13px] shadow-md',
              toast.tone === 'destructive'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-popover text-popover-foreground',
            )}
          >
            {toast.message}
          </div>
        ))}
      </section>
      {/* Sonner Toaster disabled — custom toast divs rendered above.
          Deliberately kept: the hand-written <div> stack (fixed, bottom-center,
          no max-count off-by-default) matches the historical UX and the
          controller's toast tone model (destructive vs. default) without
          bringing sonner's portal/stacking/animation into the app shell.
          <Toaster position="top-right" richColors /> is available in
          ui/components/ui/sonner.tsx if a future migration is warranted. */}
    </ErrorBoundary>
  );
}
