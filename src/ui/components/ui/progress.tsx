// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  /** Class for the outer track (sizing / margin). */
  className?: string;
  /** Class for the inner fill bar (color overrides, e.g. 'bg-destructive'). */
  fillClassName?: string;
}

export function Progress({ value, className, fillClassName }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('relative h-2 w-full overflow-hidden rounded-md bg-muted', className)}
    >
      <div
        className={cn('h-full bg-primary transition-all duration-slower ease-out', fillClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
