// SPDX-License-Identifier: MPL-2.0

import { APP_META } from '@/components/app-mark';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { AgentStatusDot, envToDotVariant } from './AgentStatusDot';

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
    ring: 'ring-cr-success/30 hover:ring-cr-success/50',
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
        return <b className="text-[10.5px] font-semibold text-cr-success">{t.envStatusActive}</b>;
      case 'available':
        return <b className="text-[10.5px] font-semibold text-sky-500">{t.envStatusAvailable}</b>;
      case 'offline':
        return (
          <b className="text-[10.5px] font-semibold text-muted-foreground">{t.envStatusOffline}</b>
        );
      case 'detecting':
        return <b className="text-[10.5px] font-semibold text-cr-warning">{t.statusDetecting}</b>;
    }
  })();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: conditional interactive card — when onClick is present, role="button", tabIndex, and onKeyDown are all set for full keyboard accessibility.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is conditionally set only when role="button" is active (i.e., when onClick is present).
    <div
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-[2px] border border-border bg-card text-card-foreground',
        'transition-all duration-base ease-out',
        'hover:-translate-y-[3px] hover:shadow-md',
        isActive
          ? `ring-2 ring-primary/40 shadow-sm shadow-primary/10 ${accent.ring}`
          : `ring-1 ${accent.ring}`,
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
      aria-label={onClick ? env.name : undefined}
    >
      {/* === Top accent edge line (Swiss) === */}
      <div
        className={cn(
          'absolute top-0 left-0 h-[2px] w-full transition-all duration-slow',
          env.status === 'active'
            ? 'bg-cr-success'
            : env.status === 'detecting'
              ? 'bg-cr-warning'
              : env.status === 'available'
                ? 'bg-cr-info'
                : 'bg-transparent',
        )}
      />

      {/* === Card content === */}
      <div className="relative z-10 flex flex-1 flex-col p-3.5">
        {/* Top row: icon + title + menu */}
        <div className="flex items-start gap-2.5">
          {/* Agent icon — shadcn Avatar (image + fallback) */}
          <Avatar
            size="default"
            className={cn(
              'size-10 shrink-0 transition-transform duration-base group-hover/card:scale-105',
              'ring-1 ring-border-strong/50',
            )}
          >
            <AvatarImage
              src={APP_META[env.agent.id]?.icon}
              alt={env.agent.displayName}
              className="object-contain"
            />
            <AvatarFallback className="bg-card2 rounded-[2px] text-[13px] font-semibold text-muted-foreground">
              {(env.agent.displayName || env.agent.id).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Name + info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-display text-sm font-bold">{env.name}</p>
              {isActive && (
                <span className="shrink-0 rounded-full bg-cr-success/15 px-1.5 py-px text-[10px] font-semibold text-cr-success">
                  {t.activeBadge}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {env.agent.displayName}
              {' · '}
              {env.theme?.name || t.statusNoTheme}
            </p>
          </div>

          {/* Dropdown menu */}
          {hasActions && (
            // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — prevents card click when interacting with the dropdown menu.
            // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only — no keyboard action needed.
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={t.environmentDelete} />
                  }
                >
                  <HugeIcon icon={MoreVerticalIcon} className="size-3.5 text-muted-foreground" />
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

        {/* Meta grid: version / status / theme */}
        <div className="mt-2.5 font-mono">
          <div className="grid grid-cols-3 gap-1.5 rounded-[2px] bg-secondary px-2.5 py-[10px]">
            <div>
              <i className="mb-0.5 block text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground/60 not-italic">
                {t.detailVersion}
              </i>
              <b className="block text-[10.5px] font-semibold text-foreground/80">
                {env.detectedVersion || '—'}
              </b>
            </div>
            <div>
              <i className="mb-0.5 block text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground/60 not-italic">
                {t.agentDetailStatus}
              </i>
              {statusLabel}
            </div>
            <div>
              <i className="mb-0.5 block text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground/60 not-italic">
                {t.capTheme}
              </i>
              <b className="block truncate text-[10.5px] font-semibold text-foreground/80">
                {env.theme?.name || '—'}
              </b>
            </div>
          </div>
        </div>

        {/* Bottom: status row (Swiss label) */}
        <div className="mt-2.5 flex items-center gap-2 border-t border-dashed border-border/60 pt-2">
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
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
            <span className="ml-auto truncate text-[11px] font-medium text-cr-success">
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
                className="h-full rounded-full bg-primary transition-all duration-slow"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
