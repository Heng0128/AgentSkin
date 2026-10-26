// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarTooltip
 *
 * Collapsed-only tooltip. Renders through a **React portal** anchored to the
 * trigger's bounding rect (fixed positioning, appended to <body>).
 *
 * ## Why a portal (2026-09-07 regression fix)
 *
 * The previous implementation rendered the tooltip inline as
 * `absolute left-full` inside the nav — which is an `overflow-y-auto` scroll
 * container. Two compounding bugs:
 *   1. An always-mounted (opacity-0) absolutely-positioned tooltip extending
 *      ~100px past the nav's right edge creates **permanent horizontal
 *      overflow**, so the nav grows a horizontal scrollbar.
 *   2. `overflow-y: auto` forces the computed `overflow-x` to `auto` as well,
 *      and the global `*:hover { scrollbar-color }` rule then reveals that
 *      scrollbar whenever the pointer rests on the sidebar — the "mystery
 *      scrollbar" that also allowed the menu items to be panned away.
 *
 * Portaling the tooltip out of the scroll container removes the overflow at
 * the source. `display:none`-style toggles were rejected because they kill
 * the entry transition; the portal mounts fresh with a short keyframe.
 *
 * A11y: the collapsed trigger already carries `aria-label={label}`, so the
 * visible tooltip is a purely redundant visual affordance and is marked
 * `aria-hidden`. It deliberately does NOT keep `role="tooltip"`: nothing
 * referenced it via `aria-describedby` (the portal wraps a span, not the
 * button), so that role was inert for assistive tech while risking a double
 * announcement if it were ever wired up.
 */

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

import { createPortal } from 'react-dom';

interface SidebarTooltipProps {
  label: string;
  visible: boolean;
  children: ReactNode;
}

/** Vertical half-height of the tooltip (≈ py-1.5 + 11px text line) for centering. */
const TOOLTIP_HALF_HEIGHT = 15;
/** Gap between the rail edge and the tooltip. */
const TOOLTIP_GAP = 10;

export function SidebarTooltip({ label, visible, children }: SidebarTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute the fixed position from the trigger's rect whenever visibility
  // flips on. Tooltips are transient hover artifacts — no scroll/resize
  // tracking needed: any scroll under the pointer fires mouseleave and hides.
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = Math.max(
      8,
      Math.min(rect.top + rect.height / 2 - TOOLTIP_HALF_HEIGHT, window.innerHeight - 40),
    );
    setPos({ top, left: rect.right + TOOLTIP_GAP });
  }, [visible]);

  return (
    <span ref={anchorRef} className="relative inline-flex">
      {children}
      {visible &&
        pos &&
        createPortal(
          <span
            aria-hidden="true"
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              // pointer-events-none is load-bearing: the bubble is portaled into
              // <body>, so as a hover target of its own it lets the pointer cross
              // from the trigger into the tooltip, fire mouseleave on the item,
              // unmount the bubble under the cursor and re-enter it — cycling the
              // label forever.
              'pointer-events-none fixed z-[var(--z-overlay)] whitespace-nowrap',
              'rounded-md border border-sidebar-border bg-popover px-2.5 py-1.5',
              'text-[11px] font-medium text-popover-foreground shadow-elev2',
              'animate-[tooltip-in_120ms_ease-out]',
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
