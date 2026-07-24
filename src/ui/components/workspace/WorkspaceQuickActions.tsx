// SPDX-License-Identifier: MPL-2.0

import type { HugeiconsIconProps } from '@hugeicons/react';
import { HugeIcon } from '@/components/ui/huge-icon';
import { cn } from '@/lib/utils';

export interface WorkspaceQuickActionItem {
  id: string;
  label: string;
  description?: string;
  icon: HugeiconsIconProps['icon'];
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * # WorkspaceQuickActions
 *
 * Visual action cards with icon, label, and optional description.
 * Replaces the old plain button row with richer, more inviting cards.
 */
export function WorkspaceQuickActions({
  items,
}: {
  items: WorkspaceQuickActionItem[];
}) {
  return (
    <div className="mt-5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            className={cn(
              'group/action flex items-center gap-3 rounded-lg border p-3 text-left',
              'transition-all duration-200 ease-out',
              !item.disabled && 'hover:-translate-y-0.5 hover:shadow-sm',
              item.disabled && 'cursor-not-allowed opacity-50',
              item.primary
                ? 'border-primary/25 bg-primary/[0.06] hover:bg-primary/[0.10] hover:border-primary/40 dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]'
                : 'border-border bg-card hover:bg-secondary/60 hover:border-border/80',
            )}
          >
            {/* Icon container */}
            <div className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover/action:scale-105',
              item.primary
                ? 'bg-primary/15 text-primary ring-1 ring-primary/20'
                : 'bg-secondary text-muted-foreground ring-1 ring-border/50 group-hover/action:text-foreground',
            )}>
              <HugeIcon icon={item.icon} size={16} />
            </div>

            {/* Text */}
            <div className="min-w-0">
              <p className={cn(
                'text-sm font-semibold tracking-tight',
                item.primary ? 'text-primary' : 'text-foreground',
              )}>
                {item.label}
              </p>
              {item.description && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>

            {/* Arrow indicator */}
            <svg
              className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover/action:translate-x-0.5 group-hover/action:text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
