// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorLandmarks
 *
 * Right inspector "Landmarks" tab — search-filterable landmark list
 * with active/hover states. Clicking a landmark updates
 * studioStore.inspectingIdx which drives the Details tab.
 */

import { useMemo } from 'react';
import { Kicker } from '@/components/studio/kicker';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { useShallow } from 'zustand/react/shallow';

export function InspectorLandmarks({ t }: { t: UiMessages }) {
  const {
    snapshot,
    inspectingIdx,
    hoveredIdx,
    searchQuery,
    setInspectingIdx,
    setHoveredIdx,
    setSearchQuery,
  } = useStudioStore(
    useShallow((s) => ({
      snapshot: s.snapshot,
      inspectingIdx: s.inspectingIdx,
      hoveredIdx: s.hoveredIdx,
      searchQuery: s.searchQuery,
      setInspectingIdx: s.setInspectingIdx,
      setHoveredIdx: s.setHoveredIdx,
      setSearchQuery: s.setSearchQuery,
    })),
  );

  const allLandmarks = useMemo(() => snapshot?.landmarks ?? [], [snapshot]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allLandmarks;
    return allLandmarks.filter(
      (lm) => lm.selector.toLowerCase().includes(q) || lm.tag.toLowerCase().includes(q),
    );
  }, [allLandmarks, searchQuery]);

  if (!snapshot) {
    return (
      <p className="font-mono text-[10px] text-[var(--fg-2)] px-1">{t.studioInspectorEmpty}</p>
    );
  }

  return (
    <div className="space-y-[var(--space-2)]">
      {/* Search input */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={`Search (${allLandmarks.length})…`}
        className="h-7 w-full border border-[var(--border-subtle)] bg-[var(--bg-3)] px-2 font-mono text-[10px] text-[var(--fg-0)] outline-none"
        style={{ borderRadius: 'var(--r-xs)' }}
      />

      {/* Count */}
      <div className="flex items-baseline justify-between px-1">
        <Kicker count={filtered.length}>{t.studioNodeLandmarks}</Kicker>
        <span className="font-mono text-[10px] text-[var(--fg-3)]">
          {t.studioLandmarkCount(filtered.length, allLandmarks.length)}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="px-1 font-mono text-[10px] text-[var(--fg-2)]">{t.studioNoMatch}</p>
      ) : (
        <div className="space-y-[2px]">
          {filtered.map((lm, _idx) => {
            const realIdx = allLandmarks.indexOf(lm);
            const isActive = inspectingIdx === realIdx;
            const isHovered = hoveredIdx === realIdx;

            // Pick a representative color dot from background-color style
            const bgStyle = lm.styles.find((s) => s.property === 'background-color');
            const dotColor = bgStyle?.value ?? 'transparent';

            return (
              <button
                key={`${lm.selector}-${realIdx}`}
                type="button"
                className="ws-landmark-chip w-full"
                data-active={isActive ? 'true' : undefined}
                onClick={() => {
                  setInspectingIdx(realIdx);
                  setHoveredIdx(null);
                }}
                onMouseEnter={() => setHoveredIdx(realIdx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <span className="lm-dot" style={{ background: dotColor }} />
                <span
                  className="lm-sel"
                  style={{
                    color: isActive ? 'var(--accent)' : isHovered ? 'var(--fg-0)' : 'var(--fg-1)',
                  }}
                >
                  {lm.selector}
                </span>
                <span className="lm-dim">{lm.tag}</span>
                {lm.boxModel && (
                  <span className="lm-dim">
                    {lm.boxModel.width}×{lm.boxModel.height}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
