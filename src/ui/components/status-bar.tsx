// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { SystemStatus } from '@shared/types';

/**
 * # StatusBar — Swiss Edition
 *
 * Fixed 28px strip pinned to the bottom of the window. Inspired by the Swiss
 * / International Typographic Style — minimal, mono-spaced, grid-aligned.
 *
 *   Left   → LED + CDP status (running / standby / offline)
 *   Center → platform count · injected count
 *   Right  → inject dock · local · clock · version
 *
 * No controller dependency — reads directly from shellStore + statusStore.
 */

/** Derive CDP/aggregate status from live system snapshot. */
function deriveCdpState(status: SystemStatus | null): 'running' | 'standby' | 'offline' {
  if (!status || status.apps.length === 0) return 'offline';
  const allReady = status.apps.every((app) => app.debugReady);
  if (allReady) return 'running';
  const anyRunning = status.apps.some((app) => app.running);
  return anyRunning ? 'standby' : 'offline';
}

interface LedState {
  variant: 'running' | 'standby' | 'offline';
  label: string;
}

/** Local HH:mm:ss tick — re-renders only once a second. */
function useTick(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const LED_STYLE: Record<LedState['variant'], { dot: string }> = {
  running: {
    dot: 'bg-cr-success',
  },
  standby: {
    dot: 'bg-cr-warning',
  },
  offline: {
    dot: 'bg-muted-foreground/30',
  },
};

export function StatusBar() {
  const locale = useShellStore((s) => s.locale);
  const appVersion = useShellStore((s) => s.appVersion);
  const injectDockOpen = useShellStore((s) => s.injectDockOpen);
  const setInjectDockOpen = useShellStore((s) => s.setInjectDockOpen);
  const status = useStatusStore((s) => s.status);
  const statusError = useStatusStore((s) => s.error);
  const statusRefreshing = useStatusStore((s) => s.isRefreshing);
  const t: UiMessages = uiMessages[locale];

  const variant = deriveCdpState(status);
  const cdpLabel =
    variant === 'running'
      ? t.swissLedRunning
      : variant === 'standby'
        ? t.swissLedStandby
        : t.swissLedOffline;

  const clock = useTick();
  const led = LED_STYLE[variant];

  // Aggregate counts from the live status snapshot.
  const totalPlatforms = status?.apps.length ?? 0;
  const onlineCount = status?.apps.filter((app) => app.running).length ?? 0;
  const injectedCount = status?.apps.filter((app) => app.activeThemeId !== null).length ?? 0;

  return (
    <footer className="flex h-[28px] shrink-0 items-center justify-between gap-4 border-t border-border bg-[var(--surface)] px-3 [-webkit-app-region:drag] transition-[background] duration-400">
      {/* Left cluster: LED + CDP status. */}
      <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
        <span className={cn('size-[7px] shrink-0 rounded-full', led.dot)} aria-hidden />
        <span className="font-mono text-[10px] font-medium text-muted-foreground">{cdpLabel}</span>
      </div>

      {/* Center cluster: platform count · injected · status error (if any). */}
      <div className="hidden items-center gap-1.5 font-mono text-[10px] font-medium lg:flex">
        <span className="text-muted-foreground">
          {t.swissPlatformOnline(onlineCount, totalPlatforms)}
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground">{t.swissInjected(injectedCount)}</span>
        {statusError ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-cr-warning" title={statusError}>
              {statusRefreshing ? '···' : 'ERR'}
            </span>
          </>
        ) : null}
      </div>

      {/* Right cluster: inject dock · local · no upload · clock · version. */}
      <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        {/* Inject dock — icon button (⏏ symbol, 27x2px rounded-[2px]). */}
        <button
          type="button"
          title={t.injectDockTitle}
          aria-label={t.injectDockTitle}
          aria-pressed={injectDockOpen}
          onClick={() => setInjectDockOpen((open) => !open)}
          className={cn(
            'inline-grid place-items-center size-[27px] rounded-[2px] border bg-transparent text-[12px] transition-[background,border-color] duration-400 active:translate-y-[1px]',
            injectDockOpen
              ? 'border-primary bg-card2 text-primary'
              : 'border-border-strong text-muted-foreground hover:bg-card2 hover:text-foreground hover:border-border',
          )}
        >
          ⏏
        </button>
        <span className="font-mono text-[10px] font-medium text-muted-foreground/60">
          {t.swissLocal}
        </span>
        <span className="font-mono tabular-nums text-[10px] font-medium text-muted-foreground/70">
          {clock}
        </span>
        <button
          type="button"
          title={t.swissVersionTip}
          aria-label={t.swissVersionTip}
          onClick={() => void navigator.clipboard?.writeText(appVersion)}
          className="font-mono text-[10px] font-medium text-muted-foreground/50 transition-colors duration-fast hover:text-foreground"
        >
          v{appVersion}
        </button>
      </div>
    </footer>
  );
}
