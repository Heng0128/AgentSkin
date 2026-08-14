// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

/**
 * # InjectDock
 *
 * Floating bottom-center capsule that surfaces the current theme-injection
 * state and quick actions, mirroring A.html's `#dock`. Unlike the old demo
 * (which only printed to console), the "restore all" action actually runs
 * `controller.restoreAll()` and closes the dock.
 *
 * Rendered once in App.tsx; visibility is controlled by AppController's
 * `injectDockOpen` state.
 */
export function InjectDock({ controller }: { controller: AppController }) {
  const { t, status, injectDockOpen, setInjectDockOpen, restoreAll } = controller;
  const [dimmed, setDimmed] = useState(false);

  // Auto-dim when the pointer leaves the dock for a while — the dock stays
  // open but recedes so it doesn't fight the wallpaper for attention.
  useEffect(() => {
    if (!injectDockOpen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      setDimmed(false);
      timer = setTimeout(() => setDimmed(true), 5000);
    };
    arm();
    const onMove = () => arm();
    window.addEventListener('mousemove', onMove);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', onMove);
    };
  }, [injectDockOpen]);

  // ESC closes the dock (matches the A.html dock UX).
  useEffect(() => {
    if (!injectDockOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInjectDockOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [injectDockOpen, setInjectDockOpen]);

  if (!injectDockOpen) return null;

  // Active injections: agents with a theme applied right now.
  const activeApps = status?.apps.filter((app) => app.activeThemeId !== null) ?? [];
  const label =
    activeApps.length > 0 ? `${activeApps.length} ${t.injectDockActive}` : t.injectDockIdle;

  return (
    <div
      className={cn(
        'fixed bottom-11 left-1/2 z-[90] -translate-x-1/2',
        'flex items-center gap-2 rounded-md  bg-[var(--pop)] px-4 py-2 shadow-float backdrop-blur-none',
        'transition-[opacity,filter] duration-300',
        dimmed && 'opacity-40 saturate-[0.6]',
      )}
      role="dialog"
      aria-label={t.injectDockTitle}
    >
      <span className="font-mono text-[11px] font-semibold  text-foreground">
        ⏏ {t.injectDockTitle}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => {
          void restoreAll();
          setInjectDockOpen(false);
        }}
        className="rounded-md  bg-card2 px-2 py-1 font-mono text-[10px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        ↺ {t.restoreAllAction}
      </button>
      <button
        type="button"
        onClick={() => setInjectDockOpen(false)}
        aria-label={t.close}
        className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
