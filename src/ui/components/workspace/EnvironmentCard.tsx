// SPDX-License-Identifier: MPL-2.0

import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HugeIcon } from '@/components/ui/huge-icon';
import type { AgentProgress, BootPhase } from '@/hooks/useBootProgress';
import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

import { Copy01Icon, Delete02Icon, Edit02Icon, MoreVerticalIcon } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { envToDotVariant } from './AgentStatusBar';
import { AgentStatusDot } from './AgentStatusDot';

/**
 * # EnvironmentCard
 *
 * A single environment card shown in the workspace grid.
 *
 * Visual features:
 *   - Theme preview color strip at top (gradient from theme preview)
 *   - Status-based accent ring (active=emerald, available=blue, offline=neutral)
 *   - Hover: lift + shadow + preview reveal
 *   - Agent icon with gradient backdrop
 *   - Dropdown menu (…) for rename/duplicate/delete
 */

/** Status → accent color mapping */
const statusAccent: Record<EnvironmentModel['status'], { ring: string }> = {
  active: {
    ring: 'ring-emerald-500/30 hover:ring-emerald-500/50',
  },
  available: {
    ring: 'ring-sky-500/20 hover:ring-sky-500/40',
  },
  offline: {
    ring: 'ring-border/50 hover:ring-border',
  },
  detecting: {
    ring: 'ring-amber-500/25 hover:ring-amber-500/40',
  },
};

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

export function EnvironmentCard({
  env,
  isActive,
  onClick,
  onRename,
  onDuplicate,
  onDelete,
  t,
  progress,
}: {
  env: EnvironmentModel;
  isActive: boolean;
  onClick?: () => void;
  onRename?: (presetId: string) => void;
  onDuplicate?: (presetId: string) => void;
  onDelete?: (presetId: string) => void;
  t: UiMessages;
  progress?: AgentProgress | null;
}) {
  const hasActions = env.presetId && (onRename || onDuplicate || onDelete);
  const accent = statusAccent[env.status];

  const statusLabel = (() => {
    switch (env.status) {
      case 'active':
        return t.environmentActive;
      case 'available':
        return t.statusDebugReady;
      case 'offline':
        return t.statusUnknown;
      case 'detecting':
        return t.statusDetecting;
    }
  })();

  return (
    <div
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs',
        'transition-all duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-md',
        isActive ? `ring-2 ${accent.ring}` : `ring-1 ${accent.ring}`,
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={env.name}
    >
      {/* === Theme preview hover reveal === */}
      {env.theme?.preview && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100">
          <img
            src={env.theme.preview}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-card/80 backdrop-blur-[2px] dark:bg-card/85" />
        </div>
      )}

      {/* === Card content === */}
      <div className="relative z-10 flex flex-1 flex-col p-3">
        {/* Top row: icon + title + menu */}
        <div className="flex items-start gap-2.5">
          {/* Agent icon with gradient backdrop */}
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover/card:scale-105',
              'bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/10',
            )}
          >
            <AppMark appId={env.agent.id} size={28} />
          </div>

          {/* Name + info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold tracking-tight">{env.name}</p>
              {isActive && (
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {t.activeBadge}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {env.agent.displayName}
              {' · '}
              {env.theme ? env.theme.name : t.statusNoTheme}
            </p>
          </div>

          {/* Dropdown menu */}
          {hasActions && (
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.environmentDelete}
                      className="opacity-0 transition-opacity group-hover/card:opacity-100"
                    />
                  }
                >
                  <HugeIcon icon={MoreVerticalIcon} className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  {onRename && env.presetId && (
                    <DropdownMenuItem onClick={() => onRename(env.presetId!)}>
                      <HugeIcon icon={Edit02Icon} className="size-4" />
                      {t.environmentRename}
                    </DropdownMenuItem>
                  )}
                  {onDuplicate && env.presetId && (
                    <DropdownMenuItem onClick={() => onDuplicate(env.presetId!)}>
                      <HugeIcon icon={Copy01Icon} className="size-4" />
                      {t.environmentDuplicate}
                    </DropdownMenuItem>
                  )}
                  {onDelete && env.presetId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(env.presetId!)}
                      >
                        <HugeIcon icon={Delete02Icon} className="size-4" />
                        {t.environmentDelete}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Bottom: status */}
        <div className="mt-2.5 flex items-center gap-2 border-t border-border/50 pt-2">
          <AgentStatusDot
            size="xs"
            variant={
              progress && isPhaseActive(progress.phase)
                ? 'detecting'
                : progress &&
                    (progress.phase === 'failed' ||
                      progress.phase === 'cdp_timeout' ||
                      progress.phase === 'cdp_spawn_failed' ||
                      progress.phase === 'inject_failed')
                  ? 'error'
                  : progress?.phase === 'done'
                    ? 'active'
                    : envToDotVariant(env)
            }
          />
          <span className="text-[11px] font-medium text-muted-foreground">
            {progress ? phaseLabel(progress.phase, t) : statusLabel}
          </span>
          {progress && isPhaseActive(progress.phase) ? (
            <span className="ml-auto truncate text-[11px] text-muted-foreground/60">
              {progress.progress}%
            </span>
          ) : env.status === 'detecting' ? (
            <span className="ml-auto truncate text-[11px] text-muted-foreground/60">
              {t.statusDetecting}
            </span>
          ) : env.agentInstalled ? (
            <span className="ml-auto truncate text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {t.statusInstalled}
              {env.detectedVersion ? ` ${t.versionLabel(env.detectedVersion)}` : ''}
            </span>
          ) : (
            <span className="ml-auto truncate text-[11px] text-muted-foreground/60">
              {t.statusNotInstalled}
            </span>
          )}
        </div>
        {progress && isPhaseActive(progress.phase) && (
          <div className="px-3 pb-2">
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
