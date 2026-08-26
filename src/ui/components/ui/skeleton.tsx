// SPDX-License-Identifier: MPL-2.0
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shimmer rounded-lg', className)} {...props} />;
}

/**
 * SkeletonText — multi-line text placeholder with realistic line widths.
 * Renders `lines` shimmer bars with varying widths (100%, 85%, 70%…) to
 * mimic paragraph text. The last line is shorter (60%) for a natural look.
 */
export function SkeletonText({
  lines = 3,
  className,
  lineClassName,
}: {
  lines?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={`skeleton-line-${i}-${lines}`}
          className={cn(
            'shimmer h-3 rounded-md',
            i === lines - 1 ? 'w-3/5' : i % 3 === 1 ? 'w-4/5' : 'w-full',
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}

/**
 * SkeletonCard — full card placeholder with image area + text lines.
 * Used in grid loading states (themes, wallpaper, community).
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card',
        className,
      )}
    >
      {/* Preview area — 16:9 */}
      <div className="shimmer aspect-video w-full bg-muted/40" />
      {/* Text lines */}
      <div className="flex flex-col gap-2 p-3">
        <div className="shimmer h-4 w-3/4 rounded-md" />
        <div className="shimmer h-3 w-1/2 rounded-md" />
      </div>
    </div>
  );
}
