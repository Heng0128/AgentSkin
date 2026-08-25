// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { formatTime } from '@shared/intl';
import type { SystemStatus } from '@shared/types';

/**
 * # StatusBar
 *
 * Minimal inline status element for the Sidebar bottom area.
 *
 * Shows: status LED (6px dot) + status label + clock.
 *
 * No fixed height — content-driven. No drag region — lives inside Sidebar.
 *
 * Reads directly from shellStore + statusStore.
 */

/** Derive CDP/aggregate status from live system snapshot. */
function deriveCdpState(status: SystemStatus | null): 'running' | 'standby' | 'offline' {
  if (!status || status.apps.length === 0) return 'offline';
  const allReady = status.apps.every((app) => app.debugReady);
  if (allReady) return 'running';
  const anyRunning = status.apps.some((app) => app.running);
  return anyRunning ? 'standby' : 'offline';
}

/** Map status variant to LED dot class. */
function ledClass(variant: 'running' | 'standby' | 'offline'): string {
  if (variant === 'running') return 'bg-cr-success';
  if (variant === 'standby') return 'bg-cr-warning';
  return 'bg-muted-foreground/30';
}

/** Local HH:mm:ss tick — re-renders only once a second, uses app locale. */
function useTick(): string {
  const [now, setNow] = useState(() => new Date());
  const locale = useShellStore((s) => s.locale);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatTime(now, locale);
}

/**
 * Clock — isolated into its own component so the 1s ticker re-renders only
 * this <span>, not the whole StatusBar (which holds store subscriptions that
 * would otherwise re-read on every second).
 */
function Clock() {
  return (
    <span className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">
      {useTick()}
    </span>
  );
}

export function StatusBar() {
  const locale = useShellStore((s) => s.locale);
  const status = useStatusStore((s) => s.status);
  const appVersion = useShellStore((s) => s.appVersion);
  const t: UiMessages = uiMessages[locale];

  const variant = deriveCdpState(status);
  const cdpLabel =
    variant === 'running'
      ? t.statusLedRunning
      : variant === 'standby'
        ? t.statusLedStandby
        : t.statusLedOffline;

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-[var(--surface)] px-3 py-1">
      {/* Status — LED + label */}
      <span className="flex items-center gap-1.5">
        <span className={cn('status-dot shrink-0', ledClass(variant))} aria-hidden />
        <span className="text-[11px] text-secondary-foreground">{cdpLabel}</span>
      </span>

      <span className="h-3.5 w-px bg-border" aria-hidden />

      {/* Version */}
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {appVersion ? `v${appVersion}` : 'v—'}
      </span>

      <Clock />
    </div>
  );
}
