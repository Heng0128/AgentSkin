// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { CloseButton } from '@/components/ui/close-button';
import { Spinner } from '@/components/ui/spinner';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import { useThemeUsageStore } from '@/stores/theme-usage-store';

import type { AgentId } from '@shared/types';
import { AGENT_META } from '@shared/types';
import { RotateCcw, Upload } from 'lucide-react';

/** Maximum number of quick-switch themes shown per agent in the dock. */
const QUICK_SWITCH_LIMIT = 4;

/**
 * # InjectDock
 *
 * Floating bottom-center capsule that surfaces the current theme-injection
 * state and quick actions, mirroring A.html's `#dock`. Includes a quick-switch
 * strip showing the most frequently used themes for each active agent, sorted
 * by usage frequency (count desc, lastUsed desc).
 *
 * Rendered once in App.tsx; visibility is controlled by AppController's
 * `injectDockOpen` state.
 */
export function InjectDock({ controller }: { controller: AppController }) {
  const {
    t,
    status,
    injectDockOpen,
    setInjectDockOpen,
    setRestoreAllPrompt,
    applyToApp,
    installed,
    installedById,
  } = controller;
  const [dimmed, setDimmed] = useState(false);

  const loadSortedThemes = useThemeUsageStore((s) => s.loadSortedThemes);
  const sortedByAgent = useThemeUsageStore((s) => s.sortedByAgent);

  // Restore in progress when the aggregated busy key is a per-agent restore.
  // Derived from controller.busy (reactive) so the dock button reflects the
  // actual operation state without duplicating the store's async lifecycle.
  const restoring = controller.busy !== null && String(controller.busy).startsWith('restore:');

  // Load frequently-used themes for each active agent when the dock opens.
  // This drives the quick-switch strip below. Only agents with active
  // injections are queried; deleted/incompatible themes are filtered by
  // loadSortedThemes itself (it cross-references the installed list).
  useEffect(() => {
    if (!injectDockOpen) return;
    const allThemeIds = installed.map((theme) => theme.id);
    const activeAppIds = (status?.apps ?? [])
      .filter((app) => app.activeThemeId !== null)
      .map((app) => app.appId);
    for (const appId of activeAppIds) {
      void loadSortedThemes(appId as AgentId, allThemeIds, QUICK_SWITCH_LIMIT);
    }
  }, [injectDockOpen, installed, status?.apps, loadSortedThemes]);

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

  // Build quick-switch entries: one strip per active agent, listing the
  // most frequently used themes sorted by usage frequency. Themes that are
  // no longer installed are filtered out by loadSortedThemes.
  const quickSwitchEntries = activeApps
    .map((app) => {
      const appId = app.appId as AgentId;
      const themeIds = sortedByAgent[appId] ?? [];
      if (themeIds.length === 0) return null;
      return {
        appId,
        agentName: AGENT_META[appId]?.displayName ?? appId,
        activeThemeId: app.activeThemeId,
        themeIds,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <div
      className={cn(
        'fixed bottom-12 left-1/2 z-[var(--z-dock)] -translate-x-1/2',
        // Glass capsule — the dock floats over the page content / wallpaper,
        // so it always renders as a frosted surface (as-glass). When themes
        // are actively injected the capsule lights up with the brand glow;
        // idle it keeps a plain elevation shadow. as-glow and shadow-sm both
        // set box-shadow, hence the exclusive branches.
        'flex items-center gap-3 rounded-lg border px-4 py-2.5 as-glass',
        activeApps.length > 0 ? 'as-glow border-border/60' : 'border-border/60 shadow-sm',
        'transition-[opacity,filter] duration-slow',
        dimmed && 'opacity-40 saturate-50',
      )}
      role="dialog"
      aria-label={t.injectDockTitle}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <Upload className="size-3.5 text-primary" />
        {t.injectDockTitle}
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span className="text-[11px] text-muted-foreground">{label}</span>

      {/* Quick-switch theme strip — per-agent, frequency-ranked */}
      {quickSwitchEntries.length > 0 && <span className="h-3.5 w-px bg-border" />}
      {quickSwitchEntries.map((entry) =>
        entry.themeIds.map((themeId) => {
          const theme = installedById(themeId);
          const themeName = theme?.name ?? themeId;
          const isActive = entry.activeThemeId === themeId;
          return (
            <button
              key={`${entry.appId}:${themeId}`}
              type="button"
              onClick={() => {
                void applyToApp(themeId, themeName, entry.appId);
              }}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-transparent bg-card2 text-foreground hover:border-primary hover:text-primary',
              )}
              title={entry.agentName}
            >
              {themeName}
            </button>
          );
        }),
      )}

      <button
        type="button"
        onClick={() => {
          // Show confirmation dialog with active injection count
          setRestoreAllPrompt(activeApps.length);
        }}
        disabled={activeApps.length === 0 || restoring}
        className="flex items-center gap-1 rounded-md border border-transparent bg-card2 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-45"
      >
        {restoring ? <Spinner className="size-3" /> : <RotateCcw className="size-3" />}
        {t.restoreAllAction}
      </button>
      <CloseButton
        onClick={() => setInjectDockOpen(false)}
        aria-label={t.close}
        className="size-5 hover:bg-muted"
      />
    </div>
  );
}
