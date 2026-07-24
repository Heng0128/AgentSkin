// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react';
import { useAppController, type Selection } from '@/hooks/useAppController';
import { DetailPanel } from '@/components/detail-panel';
import { DialogsHost } from '@/components/dialogs-host';
import { ErrorBoundary } from '@/components/error-boundary';
import { LogDrawer } from '@/components/log-drawer';
import { Sidebar } from '@/components/sidebar';
import { TitleBar } from '@/components/title-bar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BootScreen } from '@/components/boot-screen';
import { DynamicBackground } from '@/components/dynamic-background';
import { cn } from '@/lib/utils';
import { ThemesPage } from '@/pages/ThemesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { InstallWizard } from '@/components/install-progress';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { WallpaperEnginePage } from '@/pages/WallpaperEnginePage';

export default function App() {
  const controller = useAppController();
  const lastSelection = useRef<Selection>(null);
  if (controller.selection) lastSelection.current = controller.selection;

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
    <DynamicBackground wallpaper={activeWallpaper} />
    <main
      className={cn(
        'relative z-10 flex h-svh flex-col overflow-hidden font-sans text-foreground',
        activeWallpaper ? 'bg-transparent' : 'bg-background',
      )}
      lang={controller.locale === 'zh-CN' ? 'zh-CN' : 'en'}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        controller.dropThemeFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <TitleBar controller={controller} />

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <Sidebar controller={controller} />

        <section className="min-h-0 min-w-0 overflow-hidden">
          <div key={controller.route} className="h-full animate-page-enter">
            {controller.route === 'workspace' && <WorkspacePage controller={controller} />}
            {controller.route === 'themes' && <ThemesPage controller={controller} />}
            {controller.route === 'wallpaper' && <WallpaperEnginePage controller={controller} />}
            {controller.route === 'settings' && <SettingsPage controller={controller} />}
          </div>
        </section>
      </div>

      <Dialog
        open={controller.selection !== null}
        onOpenChange={(open) => { if (!open) controller.setSelection(null); }}
      >
        <DialogContent className="w-[calc(100vw-3rem)] max-w-3xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">
            {(controller.selection ?? lastSelection.current)?.theme.name ?? ''}
          </DialogTitle>
          <DetailPanel controller={controller} selection={controller.selection ?? lastSelection.current} />
        </DialogContent>
      </Dialog>

      <DialogsHost controller={controller} />
      <LogDrawer controller={controller} />

      {/* Install wizard — replaces the old InstallProgress */}
      <InstallWizard
        steps={controller.installSteps}
        flowState={controller.flowState ?? 'idle'}
        currentTheme={controller.currentTheme}
        lastError={controller.lastError}
        progress={controller.progress}
        isInstalling={controller.isInstalling}
        isComplete={controller.isComplete}
        isFailed={controller.isFailed}
        isCancelled={controller.isCancelled}
        onRetry={() => void controller.retryInstall(controller.currentTheme ?? '')}
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
    {showBoot && (
      <BootScreen
        hint={controller.t.bootLoading}
        leaving={!controller.booting}
      />
    )}
    </ErrorBoundary>
  );
}
