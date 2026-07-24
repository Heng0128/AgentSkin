// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';

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
    dot: 'bg-amber-400',
    ping: 'bg-amber-400',
  },
  active: {
    dot: 'bg-emerald-500',
    // No ping — uses animate-breathe on the dot itself for a calmer feel.
  },
  available: {
    dot: 'bg-sky-400 animate-pulse',
  },
  detecting: {
    dot: 'bg-amber-400 animate-pulse',
  },
  offline: {
    dot: 'bg-muted-foreground/25',
  },
  error: {
    dot: 'bg-destructive',
  },
};

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
          'relative inline-flex size-full rounded-full transition-colors duration-500',
          styles.dot,
        )}
      />
    </span>
  );
}
