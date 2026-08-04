// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

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
 * No IPC calls — derives everything from the AppController snapshot.
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

function useCdpState(controller: AppController): LedState {
  const { status } = controller;
  const variant = deriveCdpState(status);
  return {
    variant,
    label:
      variant === 'running'
        ? controller.t.swissLedRunning
        : variant === 'standby'
          ? controller.t.swissLedStandby
          : controller.t.swissLedOffline,
  };
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

const LED_STYLE: Record<LedState['variant'], { dot: string; glow: string; keyframe: string }> = {
  running: {
    dot: 'bg-cr-success',
    glow: 'shadow-[0_0_7px_var(--cr-success)]',
    keyframe: 'animate-[agentskin-led-pulse_2s_ease-in-out_infinite]',
  },
  standby: {
    dot: 'bg-cr-warning',
    glow: 'shadow-[0_0_7px_var(--cr-warning)]',
    keyframe: 'animate-[agentskin-led-pulse_2.5s_ease-in-out_infinite]',
  },
  offline: {
    dot: 'bg-muted-foreground/30',
    glow: '',
    keyframe: '',
  },
};

export function StatusBar({ controller }: { controller: AppController }) {
  const { t, status, appVersion } = controller;
  const cdp = useCdpState(controller);
  const clock = useTick();

  const led = LED_STYLE[cdp.variant];

  // Aggregate counts from the live status snapshot.
  const totalPlatforms = status?.apps.length ?? 0;
  const onlineCount = status?.apps.filter((app) => app.running).length ?? 0;
  const injectedCount = status?.apps.filter((app) => app.activeThemeId !== null).length ?? 0;

  return (
    <footer className="flex h-[28px] shrink-0 items-center justify-between gap-[14px] border-t border-border bg-[var(--surface)] px-3 [-webkit-app-region:drag] transition-[background] duration-400">
      {/* Left cluster: LED + CDP status. */}
      <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
        <span
          className={cn('size-[7px] shrink-0 rounded-full', led.dot, led.glow, led.keyframe)}
          aria-hidden
        />
        <span className="font-mono text-[10px] font-medium text-muted-foreground">{cdp.label}</span>
      </div>

      {/* Center cluster: platform count · injected — visible only on lg+. */}
      <div className="hidden items-center gap-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:flex">
        <span>
          平台{' '}
          <span className="font-medium text-foreground">
            {onlineCount}/{totalPlatforms}
          </span>{' '}
          在线
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          已注入 <span className="font-medium text-foreground">{injectedCount}</span>
        </span>
      </div>

      {/* Right cluster: inject dock · local · no upload · clock · version. */}
      <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        {/* Inject dock — icon button (⏏ symbol, 27x2px rounded-[2px]). */}
        <button
          type="button"
          title={t.injectDockTitle}
          aria-label={t.injectDockTitle}
          aria-pressed={controller.injectDockOpen}
          onClick={() => controller.setInjectDockOpen((open) => !open)}
          className={cn(
            'inline-grid place-items-center size-[27px] rounded-[2px] border bg-transparent text-[12px] transition-[background,border-color] duration-400 active:translate-y-[1px]',
            controller.injectDockOpen
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
        <span className="font-mono text-[10px] font-medium text-muted-foreground/50">
          v{appVersion}
        </span>
      </div>
    </footer>
  );
}
