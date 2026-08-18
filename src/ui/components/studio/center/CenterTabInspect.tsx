// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabInspect
 *
 * Compliance inspection panel for the Studio center tab.
 * Reads the current snapshot from studioStore and displays
 * an overview of landmarks, CSS variables, and DOM node count.
 */

import { useMemo } from 'react';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import type { DomTreeNode } from '@shared/types/ipc';

const MAX_LANDMARKS = 50;
const MAX_ROOT_VARS = 30;

function countDomNodes(node: DomTreeNode | undefined): number {
  if (!node) return 0;
  let count = 0;
  const stack: DomTreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    count++;
    for (let i = current.children.length - 1; i >= 0; i--) {
      const child = current.children[i];
      if (child) stack.push(child);
    }
  }
  return count;
}

export function CenterTabInspect({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
  const domNodeCount = useMemo(() => countDomNodes(snapshot?.domTree), [snapshot]);

  if (!snapshot) {
    return (
      <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
        <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabInspect}</h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioInspectPanelDesc}
        </p>
        <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
          <p className="font-mono text-xs font-bold text-[var(--fg-0)]">
            {t.studioInspectEmptyTitle}
          </p>
          <p className="mt-2 font-mono text-[10px] text-[var(--fg-3)]">
            {t.studioInspectEmptyHint}
          </p>
        </div>
      </div>
    );
  }

  const landmarkCount = snapshot.landmarks.length;
  const rootVarCount = Object.keys(snapshot.rootVars ?? {}).length;

  const visibleLandmarks = snapshot.landmarks.slice(0, MAX_LANDMARKS);
  const rootVarEntries = Object.entries(snapshot.rootVars ?? {}).slice(0, MAX_ROOT_VARS);

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabInspect}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
        {t.studioInspectPanelDesc}
      </p>

      {/* Overview cards */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectOverview}
        </h4>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectLandmarks}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {landmarkCount}
            </p>
          </div>
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectRootVars}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {rootVarCount}
            </p>
          </div>
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectDomNodes}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {domNodeCount}
            </p>
          </div>
        </div>
      </div>

      {/* Landmark list */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectLandmarkList}
        </h4>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
          {visibleLandmarks.map((lm) => (
            <div
              key={lm.selector}
              className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--fg-1)] last:border-b-0"
            >
              <span className="text-[var(--primary)]">{lm.tag}</span>
              <span className="ml-2 text-[var(--fg-3)]">{lm.selector}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Root variables list */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectRootVarsList}
        </h4>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
          {rootVarEntries.map(([name, value]) => (
            <div
              key={name}
              className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] last:border-b-0"
            >
              <span className="text-[var(--fg-1)]">{name}</span>
              <span className="ml-2 text-[var(--fg-3)]">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
