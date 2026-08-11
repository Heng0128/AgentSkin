// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioInspector
 *
 * Right sidebar inspector — collapsible 240px panel with tab bar
 * (Landmarks · Computed · Cascade · Fingerprint), window indicator
 * chip for cross-window linkage, and content routing per tab.
 *
 * State:
 *   · workspaceStore: open / width / activeTab / collapsed
 *   · studioStore: activeProject (for window indicator chip)
 */

import { AppMark } from '@/components/app-mark';
import { CascadeView } from '@/components/studio/CascadeView';
import { InspectorDetails } from '@/components/studio/InspectorDetails';
import { InspectorFingerprint } from '@/components/studio/InspectorFingerprint';
import { InspectorLandmarks } from '@/components/studio/InspectorLandmarks';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { INSPECTOR_TABS, type InspectorTabId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META } from '@shared/types';

export function StudioInspector({ t }: { t: UiMessages }) {
  const { inspector, setInspectorTab, setInspectorOpen } = useWorkspaceStore();
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const snapshot = useStudioStore((s) => s.snapshot);

  const activeAgentMeta = activeProject ? AGENT_META[activeProject.agentId] : null;

  // Collapsed → 4px sliver, click to expand
  if (inspector.collapsed || !inspector.open) {
    return (
      <button
        type="button"
        className="ws-inspector cursor-pointer"
        data-collapsed="true"
        onClick={() => setInspectorOpen(true)}
        title="Click to expand inspector"
      >
        <span className="flex flex-col items-center justify-center h-full" style={{ width: 4 }}>
          <span
            className="font-mono text-[9px] uppercase tracking-widest text-[var(--fg-3)]"
            style={{ writingMode: 'vertical-rl' }}
          >
            Ins
          </span>
        </span>
      </button>
    );
  }

  return (
    <aside className="ws-inspector" data-collapsed="false" style={{ width: inspector.width }}>
      {/* Window indicator chip */}
      {activeProject && activeAgentMeta && (
        <div className="ws-inspector__win-bar">
          <AppMark appId={activeProject.agentId} size={10} />
          <span>{activeAgentMeta.displayName}</span>
          <span className="ml-auto opacity-60">{activeProject.name}</span>
        </div>
      )}

      {/* Tab bar */}
      <div className="ws-inspector__tabs">
        {INSPECTOR_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ws-inspector__tab"
            data-active={inspector.activeTab === tab.id ? 'true' : undefined}
            onClick={() => setInspectorTab(tab.id as InspectorTabId)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="ws-inspector__scroll">
        {inspector.activeTab === 'landmarks' && <InspectorLandmarks t={t} />}
        {inspector.activeTab === 'computed' && <InspectorDetails t={t} />}
        {inspector.activeTab === 'cascade' && <InspectorCascadeTab t={t} snapshot={snapshot} />}
        {inspector.activeTab === 'fingerprint' && <InspectorFingerprint t={t} />}
      </div>
    </aside>
  );
}

/** Cascade tab — renders a full cascade snapshot. */
function InspectorCascadeTab({
  t,
  snapshot,
}: {
  t: UiMessages;
  snapshot: ReturnType<typeof useStudioStore.getState>['snapshot'];
}) {
  if (!snapshot) {
    return (
      <p className="font-mono text-[10px] text-[var(--fg-2)] px-1">{t.studioInspectorEmpty}</p>
    );
  }

  // Aggregate matched rules from all visible landmarks
  const allMatchedRules = snapshot.landmarks
    .filter((lm) => lm.visible)
    .flatMap((lm) => lm.matchedRules ?? [])
    .filter((r, i, arr) => {
      // Deduplicate by selector origin
      const key = `${r.origin}:${r.selector}`;
      return arr.findIndex((x) => `${x.origin}:${x.selector}` === key) === i;
    })
    .slice(0, 12);

  // Collect platform fonts from all visible landmarks
  const allFonts = [
    ...new Set(
      snapshot.landmarks.filter((lm) => lm.visible).flatMap((lm) => lm.platformFonts ?? []),
    ),
  ].slice(0, 8);

  // Use root landmark box model
  const rootLandmark = snapshot.landmarks.find(
    (lm) => lm.selector === ':root' || lm.tag === 'html',
  );
  const boxModel = rootLandmark?.boxModel ?? null;

  return (
    <CascadeView
      cascade={{
        matchedRules: allMatchedRules,
        platformFonts: allFonts,
        boxModel,
      }}
      t={t}
    />
  );
}
