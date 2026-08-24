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

const iconSizeMap: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-4',
  md: 'size-8',
  lg: 'size-12',
};

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  iconSize = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 text-center',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'text-muted-foreground',
            iconSizeMap[iconSize],
          )}
        >
          {icon}
        </span>
      )}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {hint && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
      {action}
    </div>
  );
}
