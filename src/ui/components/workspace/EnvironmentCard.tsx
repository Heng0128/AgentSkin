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
import type { AgentProgress, BootPhase } from '@/hooks/useBootProgress';
import { cn } from '@/lib/utils';

import type { UiMessages } from '@shared/i18n';
import type { EnvironmentModel } from '@shared/types/environment';
import { Copy, Edit, Image, MoreVertical, Trash2 } from 'lucide-react';
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

/** Status → accent ring mapping (minimal ring, no colored glow) */
const statusAccent: Record<EnvironmentModel['status'], { ring: string }> = {
  active: {
    ring: '',
  },
  available: {
    ring: '',
  },
  offline: {
    ring: '',
  },
  detecting: {
    ring: '',
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
  const _accent = statusAccent[env.status];

  const statusLabel = (() => {
    switch (env.status) {
      case 'active':
        return <b className="text-[10px] font-normal text-cr-success">{t.envStatusActive}</b>;
      case 'available':
        return (
          <b className="text-[10px] font-normal text-muted-foreground">{t.envStatusAvailable}</b>
        );
      case 'offline':
        return (
          <b className="text-[10px] font-normal text-muted-foreground">{t.envStatusOffline}</b>
        );
      case 'detecting':
        return <b className="text-[10px] font-normal text-cr-warning">{t.statusDetecting}</b>;
    }
  })();

  return (
    <article
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-md  bg-card text-card-foreground',
        'transition-[background-color,border-color,box-shadow] duration-base ease-out',
        '',
        isActive ? 'border-2 border-primary' : '',
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
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
    >
      {/* === Top accent edge line  === */}
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
      <div className="relative z-[var(--z-content)] flex flex-1 flex-col p-4">
        {/* Top row: icon + title + menu */}
        <div className="flex items-start gap-2">
          {/* Agent icon — shadcn Avatar (image + fallback) */}
          <Avatar
            size="default"
            className={cn(
              'size-10 shrink-0 transition-[border-color] duration-base group-hover/card:border-primary/40',
              'ring-1 ring-border-strong/50',
            )}
          >
            <AvatarImage
              src={APP_META[env.agent.id]?.icon}
              alt={env.agent.displayName}
              className="object-contain"
            />
            <AvatarFallback className="bg-card2 rounded-md text-[13px] font-normal text-muted-foreground">
              {(env.agent.displayName || env.agent.id).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Name + info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate font-display text-[16px] font-medium">{env.name}</p>
              {isActive && (
                <span className="shrink-0 rounded-md bg-cr-success/15 px-1 py-0 text-[10px] font-normal text-cr-success">
                  {t.activeBadge}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate as-micro">
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
                  <MoreVertical className="size-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  {onRename && env.presetId && (
                    <DropdownMenuItem onClick={() => onRename(env.presetId!)}>
                      <Edit className="size-4" />
                      {t.environmentRename}
                    </DropdownMenuItem>
                  )}
                  {onDuplicate && env.presetId && (
                    <DropdownMenuItem onClick={() => onDuplicate(env.presetId!)}>
                      <Copy className="size-4" />
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
                        <Trash2 className="size-4" />
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
        <div className="mt-2 font-mono">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-secondary px-2 py-2">
            <div>
              <i className="mb-0.5 block text-[10px] opacity-70 not-italic">
                {t.detailVersion}
              </i>
              <b className="block text-[11px] font-normal tabular-nums text-foreground/80">
                {env.detectedVersion || '—'}
              </b>
            </div>
            <div>
              <i className="mb-0.5 block text-[10px] opacity-70 not-italic">
                {t.agentDetailStatus}
              </i>
              {statusLabel}
            </div>
            <div>
              <i className="mb-0.5 block text-[10px] opacity-70 not-italic">
                {t.capTheme}
              </i>
              <b className="block truncate text-[11px] tabular-nums text-foreground/80">
                {env.theme?.name || '—'}
              </b>
            </div>
          </div>
        </div>

        {/* Wallpaper binding indicator (P0-3: environment = theme + wallpaper) */}
        {env.wallpaperId && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Image className="size-3" />
            <span>{t.envWallpaperBound}</span>
          </div>
        )}

        {/* Bottom: status row (label) */}
        <div className="mt-2 flex items-center gap-2  pt-2">
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
          <span className="text-[11px] font-normal   text-muted-foreground">
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
            <span className="ml-auto truncate text-[11px] font-normal text-cr-success">
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
            <div className="h-0.5 w-full overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md bg-primary transition-all duration-slow"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
