// SPDX-License-Identifier: MPL-2.0

import { HugeIcon } from '@/components/ui/huge-icon';
import { cn } from '@/lib/utils';

import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import type { HugeiconsIconProps } from '@hugeicons/react';

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
export function WorkspaceQuickActions({ items }: { items: WorkspaceQuickActionItem[] }) {
  return (
    <div className="mt-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            className={cn(
              'group/action flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left',
              'transition-[border-color] duration-base ease-out',
              !item.disabled && 'hover:border-border-strong',
              item.disabled && 'cursor-not-allowed opacity-50',
              item.primary && !item.disabled && 'border-primary/25 hover:border-primary/40',
            )}
          >
            {/* Icon container */}
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-base group-hover/action:scale-[1.02]',
                item.primary
                  ? 'bg-accent text-primary'
                  : 'bg-accent text-muted-foreground group-hover/action:text-foreground',
              )}
            >
              <HugeIcon icon={item.icon} size={16} />
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
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>

            {/* Arrow indicator */}
            <HugeIcon
              icon={ArrowRight01Icon}
              className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-all duration-base group-hover/action:translate-x-0.5 group-hover/action:text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
