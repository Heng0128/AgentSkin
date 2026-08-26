// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { AppMark } from '@/components/AppMark';
import type { AgentProgress, BootPhase } from '@/hooks/useBootProgress';
import { cn } from '@/lib/utils';

import type { UiMessages } from '@shared/i18n';
import type { EnvironmentModel } from '@shared/types/environment';

/**
 * # AgentStatusBar
 *
 * Compact horizontal strip showing real-time status of every supported agent.
 *
 * Each pill shows:
 *   - App icon
 *   - Agent display name
 *   - Status dot (active=emerald, available=sky, detecting=amber, offline=muted)
 *   - Active theme name (truncated, muted) or "no theme"
 *   - Live operation phase + progress bar when bootProgress has an entry
 *
 * The live phase comes from structured log events pushed by the main process
 * (via runtime:log IPC) — NOT from the 3s status poll — so the strip reflects
 * apply/restore/boot operations in real time without waiting for the next
 * poll cycle.
 *
 * Clicking a pill switches the route to the themes center so users can
 * quickly apply a theme to that agent.
 */

/** True for phases that represent ongoing work (progress bar should show). */
function isPhaseActive(phase: BootPhase): boolean {
  return (
    phase !== 'done' &&
    phase !== 'failed' &&
    phase !== 'cdp_timeout' &&
    phase !== 'cdp_spawn_failed' &&
    phase !== 'inject_failed' &&
    phase !== 'inject_done'
  );
}

/** Map a boot phase to its localized label. */
function phaseLabel(phase: BootPhase, t: UiMessages): string {
  switch (phase) {
    case 'boot_start':
      return t.phaseBootStart;
    case 'cdp_resolving':
      return t.phaseCdpResolving;
    case 'cdp_killing':
      return t.phaseCdpKilling;
    case 'cdp_spawning':
      return t.phaseCdpSpawning;
    case 'cdp_ready':
      return t.phaseCdpReady;
    case 'cdp_timeout':
      return t.phaseCdpTimeout;
    case 'cdp_spawn_failed':
      return t.phaseCdpSpawnFailed;
    case 'inject_start':
      return t.phaseInjectStart;
    case 'inject_done':
      return t.phaseInjectDone;
    case 'inject_failed':
      return t.phaseInjectFailed;
    case 'scheme_sync':
      return t.phaseSchemeSync;
    case 'done':
      return t.phaseDone;
    case 'failed':
      return t.phaseFailed;
  }
}

/**
 * Format a "x s ago" / "x m ago" label for the last status refresh timestamp.
 * Returns null for >10 minutes (stale enough that a precise label is noise).
 */
function relativeAgo(at: number, now: number): string | null {
  const diff = Math.max(0, Math.floor((now - at) / 1000));
  if (diff < 1) return 'now';
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 10) return `${m}m ago`;
  return null;
}

/**
 * Re-render once per second so the "x s ago" label stays accurate without
 * waiting for the 3s status poll. Cheap: the component is small and the
 * only consumer of this tick is the header label.
 */
function useTick(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return 0;
}

/**
 * Real-time "x s ago" / refresh indicator. Owns the 1s ticker so only this
 * label re-renders on each tick — the agent pills (and the rest of the bar)
 * stay idle until their actual data changes.
 */
function StatusRefreshLabel({
  lastStatusAt,
  isRefreshing,
  t,
}: {
  lastStatusAt?: number | null;
  isRefreshing?: boolean;
  t: UiMessages;
}) {
  useTick();
  const agoLabel = lastStatusAt ? relativeAgo(lastStatusAt, Date.now()) : null;
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
      {isRefreshing ? (
        <>
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/30 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-muted-foreground/50" />
          </span>
          <span className="text-muted-foreground">{t.statusDetecting}</span>
        </>
      ) : agoLabel ? (
        <>
          <span className="size-1.5 rounded-full bg-cr-success/60" />
          <span>{agoLabel}</span>
        </>
      ) : null}
    </span>
  );
}

export function AgentStatusBar({
  environments,
  progress,
  lastStatusAt,
  isRefreshing,
  t,
  onSelectAgent,
}: {
  environments: EnvironmentModel[];
  /** Live per-agent operation progress (from structured log events). */
  progress?: Map<string, AgentProgress> | null;
  /** Timestamp (epoch ms) of the last successful status refresh. */
  lastStatusAt?: number | null;
  /** True while a status refresh is in flight (drives the live pulse). */
  isRefreshing?: boolean;
  t: UiMessages;
  onSelectAgent?: (env: EnvironmentModel) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="text-[11px] font-normal tracking-tight text-muted-foreground">
          {t.workspaceAgentStrip}
        </h2>
        <span className="inline-flex size-4 items-center justify-center rounded-md bg-secondary text-[11px] font-normal text-muted-foreground">
          {environments.length}
        </span>
        {/* Live refresh indicator — owned by StatusRefreshLabel so its 1s
            ticker never re-renders the pill grid. */}
        <StatusRefreshLabel lastStatusAt={lastStatusAt} isRefreshing={isRefreshing} t={t} />
      </div>

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {environments.map((env) => {
          const agentProgress = progress?.get(env.agent.id) ?? null;
          const hasLivePhase = agentProgress && isPhaseActive(agentProgress.phase);
          const isFailed =
            agentProgress &&
            (agentProgress.phase === 'failed' ||
              agentProgress.phase === 'cdp_timeout' ||
              agentProgress.phase === 'cdp_spawn_failed' ||
              agentProgress.phase === 'inject_failed');
          const isDone = agentProgress?.phase === 'done';

          const isRunning = env.agentRunning;
          const isInstalled = env.agentInstalled;
          const isActive = env.status === 'active';
          const isDetecting = env.status === 'detecting';

          // Status dot — prefers live phase over static status
          const dotClass = hasLivePhase
            ? 'bg-cr-warning animate-pulse'
            : isFailed
              ? 'bg-destructive'
              : isDone
                ? 'bg-cr-success'
                : isActive
                  ? 'bg-cr-success'
                  : isRunning
                    ? 'bg-muted-foreground/50'
                    : isDetecting
                      ? 'bg-cr-warning animate-pulse'
                      : isInstalled
                        ? 'bg-muted-foreground/40'
                        : 'bg-muted-foreground/20';

          // Label — prefers live phase label over static status
          const statusText = agentProgress
            ? phaseLabel(agentProgress.phase, t)
            : env.theme
              ? env.theme.name
              : t.statusNoTheme;

          return (
            <button
              key={env.id}
              type="button"
              onClick={() => onSelectAgent?.(env)}
              className={cn(
                'group/pill relative flex items-center gap-2 overflow-hidden rounded-md border bg-card p-2 text-left',
                'transition-[border-color] duration-base ease-out',
                '',
                hasLivePhase && 'border-cr-warning/30',
                isFailed && 'border-destructive/30',
                isActive && !hasLivePhase && 'border-cr-success/30',
              )}
            >
              {/* App icon */}
              <div
                className={cn(
                  'relative flex size-8 shrink-0 items-center justify-center rounded-md',
                  'bg-accent',
                  'transition-colors duration-base group-hover/pill:bg-accent',
                )}
              >
                <AppMark appId={env.agent.id} size={20} />
                {/* Status dot overlay */}
                <span
                  className={cn(
                    'absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-card',
                    dotClass,
                  )}
                  aria-hidden
                />
              </div>

              {/* Name + live status */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-normal leading-tight">
                  {env.agent.displayName}
                </p>
                <p
                  className={cn(
                    'mt-0.5 truncate text-[11px] leading-tight',
                    hasLivePhase
                      ? 'font-normal text-cr-warning'
                      : isFailed
                        ? 'font-normal text-destructive'
                        : env.theme
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/50',
                  )}
                >
                  {statusText}
                  {hasLivePhase && agentProgress && agentProgress.progress > 0 && (
                    <span className="ml-1 tabular-nums text-muted-foreground/60">
                      {agentProgress.progress}%
                    </span>
                  )}
                </p>
              </div>

              {/* Live progress bar — bottom edge */}
              {hasLivePhase && agentProgress && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
                  <div
                    className={cn(
                      'h-full transition-all duration-slow ease-out',
                      isFailed ? 'bg-destructive' : 'bg-cr-warning',
                    )}
                    style={{ width: `${Math.max(3, agentProgress.progress)}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
