// SPDX-License-Identifier: MPL-2.0

/**
 * # EmptyState
 *
 * Unified empty-state placeholder for pages with no content.
 *
 * Provides a consistent layout: optional icon, title, optional hint text,
 * and an optional action button. Used across dashboard, workspace, themes,
 * wallpaper, settings, and studio pages.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Optional icon element (e.g. Lucide icon). */
  icon?: ReactNode;
  /** Primary title text. */
  title: string;
  /** Secondary hint / description text. */
  hint?: string;
  /** Optional action button or link. */
  action?: ReactNode;
  /** Additional className for the container. */
  className?: string;
  /** Icon size preset — defaults to 'md'. */
  iconSize?: 'sm' | 'md' | 'lg';
}

const iconSizeMap: Record<'sm' | 'md' | 'lg', { container: string; icon: string }> = {
  sm: { container: 'size-10', icon: 'size-5' },
  md: { container: 'size-14', icon: 'size-7' },
  lg: { container: 'size-18', icon: 'size-9' },
};

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  iconSize = 'md',
}: EmptyStateProps) {
  const sizes = iconSizeMap[iconSize];
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 text-center', className)}>
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border',
            sizes.container,
          )}
        >
          <span className={sizes.icon}>{icon}</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {hint && (
          <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      {action}
    </div>
  );
}
