// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

import { RotateCcw, Upload, X } from 'lucide-react';

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
  const { t, status, injectDockOpen, setInjectDockOpen, setRestoreAllPrompt } = controller;
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
        'fixed bottom-12 left-1/2 z-[var(--z-dock)] -translate-x-1/2',
        'flex items-center gap-2 rounded-md  bg-popover px-4 py-2 shadow-float backdrop-blur-none',
        'transition-[opacity,filter] duration-slow',
        dimmed && 'opacity-40 saturate-[0.6]',
      )}
      role="dialog"
      aria-label={t.injectDockTitle}
    >
      <span className="flex items-center gap-1 text-[11px] text-foreground">
        <Upload className="size-3.5" />
        {t.injectDockTitle}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => {
          // Show confirmation dialog with active injection count
          controller.setRestoreAllPrompt(activeApps.length);
        }}
        className="flex items-center gap-1 rounded-md bg-card2 px-2 py-1 text-[10px] text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <RotateCcw className="size-3" />
        {t.restoreAllAction}
      </button>
      <button
        type="button"
        onClick={() => setInjectDockOpen(false)}
        aria-label={t.close}
        className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
