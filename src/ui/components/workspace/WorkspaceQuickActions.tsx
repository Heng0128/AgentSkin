// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';

export interface WorkspaceQuickActionItem {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
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
export function WorkspaceQuickActions({ items }: { items: WorkspaceQuickActionItem[] }) {
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
              'group/action flex items-center gap-3 rounded-[2px] border border-border bg-card p-3 text-left',
              'transition-[border-color] duration-base ease-out',
              !item.disabled && 'hover:border-border-strong',
              item.disabled && 'cursor-not-allowed opacity-50',
              item.primary && !item.disabled && 'border-primary/25 hover:border-primary/40',
            )}
          >
            {/* Icon container */}
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-base group-hover/action:scale-105',
                item.primary
                  ? 'bg-accent text-primary'
                  : 'bg-accent text-muted-foreground group-hover/action:text-foreground',
              )}
            >
              <item.icon size={16} />
            </div>

            {/* Text */}
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-semibold tracking-tight',
                  item.primary ? 'text-primary' : 'text-foreground',
                )}
              >
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
              className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-all duration-base group-hover/action:translate-x-0.5 group-hover/action:text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              role="img"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
