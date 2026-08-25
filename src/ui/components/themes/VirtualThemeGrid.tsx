// SPDX-License-Identifier: MPL-2.0

/**
 * VirtualThemeGrid — windowed grid for the Theme Center.
 *
 * Renders only the rows currently visible in the scroll viewport (+overscan),
 * so a library of hundreds of themes costs the same as a handful. Column count
 * is derived from the live container width (responsive), and each row's height
 * is computed deterministically from the card width (preview is a fixed
 * 1.6:1 aspect + a fixed info-section budget), so no per-element measurement
 * is needed and scrolling stays jank-free.
 *
 * No external dependency: windowing is implemented with a spacer div whose
 * height equals the full virtual grid, and absolutely-positioned row lanes.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { UiMessages } from '@shared/i18n';
import type { ThemeCenterCardModel } from '@/types/theme-center';
import type { AgentId } from '@shared/types';
import { ThemeCard } from './ThemeCard';

const GAP = 12; // comfortable grid gap between cards
const INFO_BUDGET = 88; // px reserved for the card info section (fixed, tight card)
const OVERSCAN = 2; // extra rows rendered above/below the viewport

export interface VirtualThemeGridProps {
  themes: ThemeCenterCardModel[];
  activeAgentsByTheme: Map<string, AgentId[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  t: UiMessages;
  /** Minimum card width before dropping a column. */
  minCardWidth?: number;
}

export function VirtualThemeGrid({
  themes,
  activeAgentsByTheme,
  selectedId,
  onSelect,
  t,
  minCardWidth = 240,
}: VirtualThemeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // rAF batching for scroll events: coalesces multiple scroll events in the
  // same frame into a single setState call, avoiding redundant re-renders.
  // Stored in useRef (not module-level) so each grid instance has its own
  // pending state — multiple mounted grids don't interfere with each other.
  const rafPendingRef = useRef(false);
  const rafCallbacksRef = useRef(new Set<() => void>());

  // Measure the available content width and the scroller viewport height.
  // useLayoutEffect runs before paint so the first frame already has correct
  // column count (no flash of a wrong layout).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    const measure = () => {
      setWidth(inner.clientWidth);
      setViewportH(scroller.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const cols = width > 0 ? Math.max(1, Math.floor((width + GAP) / (minCardWidth + GAP))) : 4;
  const cardWidth = width > 0 ? (width - (cols - 1) * GAP) / cols : 240;
  const previewH = cardWidth * 9 / 16; // matches `aspect-[16/9]`
  const rowH = previewH + INFO_BUDGET + GAP;

  const rowCount = Math.ceil(themes.length / cols);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    // Read once per frame via rAF — scroll events can fire at 60-120Hz but
    // React only needs the latest value once per frame.
    rafCallbacksRef.current.add(() => {
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
    if (!rafPendingRef.current) {
      rafPendingRef.current = true;
      requestAnimationFrame(() => {
        rafPendingRef.current = false;
        const cbs = new Set(rafCallbacksRef.current);
        rafCallbacksRef.current.clear();
        cbs.forEach((cb) => cb());
      });
    }
  };

  const startRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const endRow = Math.min(
    rowCount - 1,
    Math.floor((scrollTop + viewportH) / rowH) + OVERSCAN,
  );

  const visibleRows = [];
  for (let r = startRow; r <= endRow && r >= 0; r++) {
    const start = r * cols;
    const items = themes.slice(start, start + cols);
    visibleRows.push({ r, items });
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto p-3"
    >
      {/* Full-height spacer keeps the native scrollbar proportional to the
          entire (virtual) grid; only the visible lanes are actually in the DOM.
          R6-23: spacer 高度修正 — 原实现 `rowCount * rowH` 多算 GAP(12px)，
          滚动到底部时出现 12px 空白。修正为减去多余的 GAP。 */}
      <div ref={innerRef} style={{ position: 'relative', height: Math.max(0, rowCount * rowH - GAP), width: '100%' }}>
        {visibleRows.map(({ r, items }) => (
          <div
            key={r}
            style={{
              position: 'absolute',
              top: r * rowH,
              left: 0,
              right: 0,
              height: rowH - GAP,
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: GAP,
              alignItems: 'stretch',
            }}
          >
            {items.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={selectedId === theme.id}
                activeAgentIds={activeAgentsByTheme.get(theme.id) ?? []}
                onSelect={() => onSelect(theme.id)}
                t={t}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
