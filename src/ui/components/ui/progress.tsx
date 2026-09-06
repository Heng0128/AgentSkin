// SPDX-License-Identifier: MPL-2.0
import { cn } from '@/lib/utils';

interface ProgressProps {
  /** Deterministic progress (0-100). Ignored when `indeterminate` is true. */
  value?: number;
  /** Indeterminate mode — shows an animated marquee when progress is unknown. */
  indeterminate?: boolean;
  /** Class for the outer track (sizing / margin). */
  className?: string;
  /** Class for the inner fill bar (color overrides, e.g. 'bg-destructive'). */
  fillClassName?: string;
  /** Show a shimmer sweep on the fill bar (determinate mode only). */
  shimmer?: boolean;
  /** Size preset — 'sm' (h-1.5), 'md' (h-2, default), 'lg' (h-3). */
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
} as const;

export function Progress({
  value = 0,
  indeterminate = false,
  className,
  fillClassName,
  shimmer = false,
  size = 'md',
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'relative w-full overflow-hidden rounded-md bg-muted',
        SIZE_MAP[size],
        className,
      )}
    >
      {indeterminate ? (
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-1/3 animate-indeterminate bg-primary/50',
            fillClassName,
          )}
        />
      ) : (
        <div
          className={cn(
            'h-full rounded-md bg-primary transition-all duration-slower ease-out',
            shimmer && 'shimmer',
            fillClassName,
          )}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}
