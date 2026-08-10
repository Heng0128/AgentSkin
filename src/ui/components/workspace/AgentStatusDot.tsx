// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

/**
 * # AgentStatusDot
 *
 * Unified animated status dot used across all agent status displays.
 * Eliminates the 7+ copies of "pick a dot color + animation based on status"
 * that were scattered across AgentStatusBar, EnvironmentCard, EnvironmentHero,
 * DetailPanel, and WallpaperEnginePage.
 *
 * Variants:
 *   - refreshing: amber, fast ping (refresh in flight)
 *   - active:     emerald, breathing pulse (agent running + themed)
 *   - available:  sky, pulse (agent running, no theme)
 *   - detecting:  amber, pulse (probing)
 *   - offline:    muted, static (not running / not installed)
 *   - error:      destructive, static (failure)
 */

export type AgentDotVariant =
  | 'refreshing'
  | 'active'
  | 'available'
  | 'detecting'
  | 'offline'
  | 'error';

const DOT_STYLES: Record<AgentDotVariant, { dot: string; ping?: string }> = {
  refreshing: {
    dot: 'bg-cr-warning',
    ping: 'bg-cr-warning',
  },
  active: {
    dot: 'bg-cr-success',
  },
  available: {
    dot: 'bg-muted-foreground/50',
  },
  detecting: {
    dot: 'bg-cr-warning',
  },
  offline: {
    dot: 'bg-muted-foreground/25',
  },
  error: {
    dot: 'bg-destructive',
  },
};

/**
 * Map an {@link EnvironmentModel}'s runtime status to a dot variant.
 *
 * Mirrors the precedence used by {@link AgentStatusBar}: active > running
 * (available) > detecting > installed-but-stopped (offline) > unknown
 * (offline). Callers that also have live boot/apply phase information
 * should layer that on top of this baseline — see {@link EnvironmentCard}
 * for the canonical layered variant resolution.
 */
export function envToDotVariant(env: EnvironmentModel): AgentDotVariant {
  if (env.status === 'active') return 'active';
  if (env.agentRunning) return 'available';
  if (env.status === 'detecting') return 'detecting';
  return 'offline';
}

export function AgentStatusDot({
  variant,
  size = 'sm',
  className,
}: {
  variant: AgentDotVariant;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  const styles = DOT_STYLES[variant];
  const dotSize = size === 'xs' ? 'size-1.5' : 'size-2';

  return (
    <span className={cn('relative inline-flex items-center justify-center', dotSize, className)}>
      {styles.ping && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-75',
            styles.ping,
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex size-full rounded-full transition-colors duration-slower',
          styles.dot,
        )}
      />
    </span>
  );
}
