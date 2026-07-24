// SPDX-License-Identifier: MPL-2.0

import { AppMark } from '@/components/app-mark';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

import type { UiMessages } from '@shared/i18n';
import { type AgentDotVariant, AgentStatusDot } from './AgentStatusDot';

/**
 * # LiveBadge
 *
 * "Real-time" indicator for the status strip header. Uses the shared
 * useRelativeTime hook (single 1s ticker for the whole app) and the shared
 * AgentStatusDot for the pulsing dot.
 */
function LiveBadge({
  t,
  lastStatusAt,
  isRefreshing,
}: {
  t: UiMessages;
  lastStatusAt: number | null;
  isRefreshing: boolean;
}) {
  const relative = useRelativeTime(lastStatusAt, isRefreshing, t);

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2 py-0.5">
      <AgentStatusDot variant={isRefreshing ? 'refreshing' : 'active'} size="xs" />
      <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        {t.statusLive}
      </span>
      <span className="text-[9px] tabular-nums text-muted-foreground">{relative}</span>
    </span>
  );
}

/**
 * Map an environment's runtime state to a unified dot variant.
 * Single source of truth for "which dot color for which state" — previously
 * duplicated in 7+ places.
 */
export function envToDotVariant(env: EnvironmentModel): AgentDotVariant {
  if (env.status === 'active') return 'active';
  if (env.agentRunning) return 'available';
  if (env.status === 'detecting') return 'detecting';
  if (env.agentInstalled) return 'offline';
  return 'offline';
}

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
 *
 * Clicking a pill switches the route to the themes center so users can
 * quickly apply a theme to that agent.
 */
export function AgentStatusBar({
  environments,
  t,
  onSelectAgent,
  lastStatusAt,
  isRefreshing,
}: {
  environments: EnvironmentModel[];
  t: UiMessages;
  onSelectAgent?: (env: EnvironmentModel) => void;
  lastStatusAt: number | null;
  isRefreshing: boolean;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="text-xs font-semibold tracking-tight text-muted-foreground uppercase">
          {t.workspaceAgentStrip}
        </h2>
        <span className="inline-flex size-4 items-center justify-center rounded-md bg-secondary text-[9px] font-semibold text-muted-foreground">
          {environments.length}
        </span>
        <span className="ml-auto">
          <LiveBadge t={t} lastStatusAt={lastStatusAt} isRefreshing={isRefreshing} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {environments.map((env) => {
          const isActive = env.status === 'active';

          return (
            <button
              key={env.id}
              type="button"
              onClick={() => onSelectAgent?.(env)}
              className={cn(
                'group/pill flex items-center gap-2 rounded-lg border bg-card p-2 text-left',
                'transition-all duration-200 ease-out',
                'hover:-translate-y-0.5 hover:shadow-sm hover:border-border/80',
                isActive && 'border-emerald-500/30 ring-1 ring-emerald-500/15',
              )}
            >
              {/* App icon */}
              <div
                className={cn(
                  'relative flex size-8 shrink-0 items-center justify-center rounded-md',
                  'bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/10',
                  'transition-transform duration-200 group-hover/pill:scale-105',
                )}
              >
                <AppMark appId={env.agent.id} size={20} />
                {/* Status dot overlay */}
                <span className="absolute -right-0.5 -top-0.5 ring-2 ring-card" aria-hidden>
                  <AgentStatusDot variant={envToDotVariant(env)} size="xs" />
                </span>
              </div>

              {/* Name + theme */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold leading-tight">
                  {env.agent.displayName}
                </p>
                <p
                  className={cn(
                    'mt-0.5 truncate text-[10px] leading-tight',
                    env.theme ? 'text-muted-foreground' : 'text-muted-foreground/50',
                  )}
                >
                  {env.theme ? env.theme.name : t.statusNoTheme}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
