// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarTooltip
 *
 * Lightweight collapsed-only tooltip primitive. Uses `role="tooltip"` +
 * `aria-describedby` so screen readers can announce the label when the
 * sidebar is collapsed and the user hovers an icon.
 *
 * Swiss/International styling: 6px radius (matches `--radius-base`),
 * `shadow-elev2` (no frosted glass), `--font-size-body` (11px).
 */

import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

interface SidebarTooltipProps {
  label: string;
  visible: boolean;
  children: ReactNode;
}

export function SidebarTooltip({ label, visible, children }: SidebarTooltipProps) {
  // Stable tooltip ID per-describedby.
  const id = useId();

  return (
    <span className="relative inline-flex">
      {children}
      <span
        id={id}
        role="tooltip"
        aria-hidden={!visible}
        className={cn(
          'pointer-events-none absolute left-full z-[var(--z-overlay)] ml-2 whitespace-nowrap',
          'rounded-[6px] border border-border bg-popover px-2.5 py-1.5',
          'text-[11px] font-medium text-popover-foreground shadow-elev2',
          'transition-[opacity,transform] duration-fast',
          visible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-1 opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
