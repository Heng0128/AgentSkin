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

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

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
  sm: { container: 'size-8', icon: 'size-4' },
  md: { container: 'size-12', icon: 'size-6' },
  lg: { container: 'size-16', icon: 'size-8' },
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
    <div
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-muted/40 text-muted-foreground ring-1 ring-border/50',
            sizes.container,
          )}
        >
          <span className={sizes.icon}>{icon}</span>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {hint && (
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
      {action}
    </div>
  );
}
