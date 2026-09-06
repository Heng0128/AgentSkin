// SPDX-License-Identifier: MPL-2.0

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialogsHost } from '@/components/DialogsHost';
import { DynamicBackground } from '@/components/DynamicBackground';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InjectDock } from '@/components/InjectDock';
import { InstallWizard } from '@/components/InstallProgress';
import { PageSkeleton } from '@/components/PageSkeleton';
import { SidebarContent, SidebarProvider, SidebarRail } from '@/components/sidebar';
import { TitleBar } from '@/components/TitleBar';
import { SkeletonProvider } from '@/components/ui/SkeletonProvider';
import { useAppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useShellStore } from '@/stores/shellStore';

import type { Toast } from '@shared/types';

/**
 * RouteAwareSkeleton — selects the appropriate page-specific skeleton
 * based on the current route, so the Suspense fallback (shown while a
 * lazy-loaded page chunk is fetching) matches the page being navigated to.
 * Uses config-driven SkeletonProvider — no hardcoded per-page JSX.
 */
function RouteAwareSkeleton() {
  const route = useShellStore((s) => s.route);
  switch (route) {
    case 'themes':
      return (
        <SkeletonProvider
          loading
          config={{ header: true, toolbar: true, body: 'grid', count: 12, aspect: '16/9' }}
        />
      );
    case 'wallpaper':
      return (
        <SkeletonProvider
          loading
          config={{ header: true, toolbar: true, body: 'grid', count: 12, aspect: '16/9' }}
        />
      );
    case 'workspace':
      return (
        <SkeletonProvider
          loading
          config={{ header: true, toolbar: true, body: 'list', count: 6, rowAvatar: true }}
        />
      );
    case 'apps':
      return (
        <SkeletonProvider loading config={{ body: 'grid', count: 8, aspect: '1/1', columns: 8 }} />
      );
    case 'settings':
      return (
        <SkeletonProvider
          loading
          config={{ header: 'minimal', body: 'list', count: 12, rowAvatar: false, rowBadge: false }}
        />
      );
    case 'community':
      return null; // CommunityPage owns its skeleton — see CommunityPage.tsx
    default:
      // Community sub-routes own their skeleton (matched by the custom
      // placeholder inside CommunityPage). Avoid the generic page skeleton.
      if (typeof route === 'string' && route.startsWith('community.')) {
        return null;
      }
      return <PageSkeleton />;
  }
}

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
const CommunityPage = lazy(() =>
  import('@/pages/CommunityPage').then((m) => ({ default: m.CommunityPage })),
);
// Density scale map: maps user density preference to a CSS variable so
// spacing-aware components can scale proportionally (--dl-density-scale).
const DENSITY_SCALE: Record<string, string> = {
  compact: '0.85',
  comfortable: '1',
  cozy: '1.15',
};

// Motion multiplier map: maps user motion preference to a duration multiplier.
const MOTION_MULTIPLIER: Record<string, string> = {
  reduced: '0.5',
  normal: '1',
  none: '0',
};

/** Exit fallback: .as-toast-out runs at --duration-base (150ms), but if
 * animations are force-disabled (body.no-anim) animationend never fires —
 * this timer guarantees the toast still unmounts. */
const TOAST_EXIT_FALLBACK_MS = 500;

/**
 * ToastStack — bottom-center notification stack.
 *
 * Replaces the historical same-position overlapping toasts with ONE fixed
 * flex-column container: the newest toast sits at the bottom (closest to the
 * viewport edge, same visual anchor as before), older ones stack upward and
 * `gap-2` keeps them separated so multiple toasts never cover each other.
 *
 * The exit lifecycle is managed entirely in this component so
 * notificationStore keeps its simple add/timer-remove contract:
 * when a toast leaves the store it is parked in local `leaving` state,
 * re-rendered with .as-toast-exit, then unmounted on animation end
 * (with a timer fallback for forced no-anim environments).
 */
function ToastStack() {
  const toasts = useNotificationStore((s) => s.toasts);
  // Toasts removed from the store but still playing their exit animation.
  const [leaving, setLeaving] = useState<Toast[]>([]);
  const prevToastsRef = useRef(toasts);

  // Park store-departed toasts so their exit animation can play out.
  useEffect(() => {
    const prev = prevToastsRef.current;
    prevToastsRef.current = toasts;
    if (prev === toasts) return;
    const aliveIds = new Set(toasts.map((t) => t.id));
    const departed = prev.filter((t) => !aliveIds.has(t.id));
    if (departed.length > 0) {
      setLeaving((pending) => [...pending, ...departed]);
    }
  }, [toasts]);

  const releaseLeaving = useCallback((id: number) => {
    setLeaving((pending) => pending.filter((t) => t.id !== id));
  }, []);

  // Safety net in case animationend never fires.
  useEffect(() => {
    if (leaving.length === 0) return;
    const timers = leaving.map((t) =>
      window.setTimeout(() => releaseLeaving(t.id), TOAST_EXIT_FALLBACK_MS),
    );
    return () =>
      timers.forEach((id) => {
        window.clearTimeout(id);
      });
  }, [leaving, releaseLeaving]);

  const liveIds = useMemo(() => new Set(toasts.map((t) => t.id)), [toasts]);

  // Store order is already oldest-first; merging leaving back in and sorting
  // by id preserves each toast's original slot so survivors don't jump
  // around while a neighbour animates out.
  const ordered = useMemo(
    () => [...toasts, ...leaving].sort((a, b) => a.id - b.id),
    [toasts, leaving],
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-10 z-[var(--z-toast)] flex flex-col items-center gap-2"
    >
      {ordered.map((toast) => {
        const exiting = !liveIds.has(toast.id);
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-[6px] border px-4 py-2.5 text-[12px] font-medium shadow-sm',
              toast.tone === 'destructive'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-popover text-popover-foreground',
              exiting ? 'as-toast-exit' : 'as-toast-enter',
            )}
            onAnimationEnd={
              exiting
                ? (event) => {
                    if (event.animationName === 'as-toast-out') releaseLeaving(toast.id);
                  }
                : undefined
            }
          >
            {toast.message}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const controller = useAppController();
  const radiusScale = useSettingsStore((s) => s.radiusScale);
  const density = useSettingsStore((s) => s.density);
  const motion = useSettingsStore((s) => s.motion);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);

  // Sync the user-selected corner-radius scale to the CSS variable on
  // :root so every component using radius-aware tokens reacts.
  useEffect(() => {
    document.documentElement.style.setProperty('--dl-radius', `${radiusScale}px`);
  }, [radiusScale]);

  // Sync the user-selected density to a CSS variable so spacing-aware
  // components can scale proportionally (--dl-density-scale).
  useEffect(() => {
    const scale = DENSITY_SCALE[density] ?? '1';
    document.documentElement.style.setProperty('--dl-density-scale', scale);
  }, [density]);

  // Sync the user-selected motion intensity: reduce half, none = 0.
  // Also toggles data-motion on <html> for targeted selectors and honors
  // prefers-reduced-motion automatically via the 'none' branch.
  useEffect(() => {
    const multiplier = MOTION_MULTIPLIER[motion] ?? '1';
    document.documentElement.style.setProperty('--duration-multiplier', multiplier);
    document.documentElement.dataset.motion = motion;
  }, [motion]);

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
        style={{ '--sidebar-width': sidebarCollapsed ? '56px' : '192px' } as React.CSSProperties}
      >
        <div
          className={cn(
            'grid min-h-0 overflow-hidden transition-[grid-template-columns] duration-base ease-out',
            'grid-cols-[var(--sidebar-width)_1fr]',
          )}
        >
          {/* Left column: collapsible sidebar */}
          <div className="flex h-full min-h-0 flex-col">
            <SidebarProvider>
              {sidebarCollapsed ? <SidebarRail /> : <SidebarContent />}
            </SidebarProvider>
          </div>

          {/* Main column: title bar + scrollable content */}
          <main className="flex min-h-0 flex-col overflow-hidden">
            <TitleBar hasWallpaper={!!activeWallpaper} />

            <div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-behavior-contain">
              <div
                key={controller.route}
                className={cn('page-enter flex flex-col h-full')}
                style={{
                  padding: 'var(--space-page-y) var(--space-page-x)',
                }}
              >
                <Suspense fallback={<RouteAwareSkeleton />}>
                  <ErrorBoundary inline>
                    {controller.route === 'workspace' && <WorkspacePage />}
                    {controller.route === 'apps' && <AppsPage />}
                    {controller.route === 'themes' && <ThemesPage controller={controller} />}
                    {controller.route === 'wallpaper' && (
                      <WallpaperEnginePage controller={controller} />
                    )}
                    {controller.route === 'settings' && <SettingsPage controller={controller} />}
                    {typeof controller.route === 'string' &&
                      controller.route.startsWith('community') && (
                        <CommunityPage route={controller.route} />
                      )}
                  </ErrorBoundary>
                </Suspense>
              </div>
            </div>
          </main>
        </div>

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

        {/* Toast stack — see ToastStack above. Sonner remains deliberately
            disabled: this custom stack keeps the controller's tone model
            (destructive vs default) and now adds proper stacking + exit
            animations without sonner's portal machinery. */}
        <ToastStack />
      </section>
      {/* Sonner Toaster remains disabled — toasts render via <ToastStack />
          above. <Toaster position="top-right" richColors /> is available in
          ui/components/ui/sonner.tsx if a future migration is warranted. */}
    </ErrorBoundary>
  );
}
