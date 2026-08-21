// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioInspector
 *
 * Right sidebar inspector — collapsible 240px panel with Profile tab,
 * window indicator chip for cross-window linkage, and content routing per tab.
 *
 * State:
 *   · workspaceStore: open / width / activeTab / collapsed
 *   · studioStore: activeProject (for window indicator chip)
 */

import { AppMark } from '@/components/app-mark';
import { InspectorProfile } from '@/components/studio/InspectorProfile';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { InspectorTabId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META } from '@shared/types';

/** Map inspector tab IDs to their i18n label keys. */
const TAB_LABEL: Record<InspectorTabId, (t: UiMessages) => string> = {
  profile: (t) => t.studioTabProfile,
};

export function StudioInspector({ t }: { t: UiMessages }) {
  const { inspector, setInspectorTab, setInspectorOpen } = useWorkspaceStore();
  const activeProject = useStudioStore((s) => s.getActiveProject());

  const activeAgentMeta = activeProject ? AGENT_META[activeProject.agentId] : null;

  // Collapsed → 4px sliver, click to expand
  if (inspector.collapsed || !inspector.open) {
    return (
      <button
        type="button"
        className="ws-inspector cursor-pointer"
        data-collapsed="true"
        onClick={() => setInspectorOpen(true)}
        title={t.studioExpandInspector}
      >
        <span className="flex flex-col items-center justify-center h-full" style={{ width: 4 }}>
          <span
            className="font-mono text-[10px]   text-[var(--fg-3)]"
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
        {(['profile'] as InspectorTabId[]).map((id) => (
          <button
            key={id}
            type="button"
            className="ws-inspector__tab"
            data-active={inspector.activeTab === id ? 'true' : undefined}
            onClick={() => setInspectorTab(id)}
          >
            {TAB_LABEL[id](t)}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="ws-inspector__scroll">
        {inspector.activeTab === 'profile' && <InspectorProfile t={t} />}
      </div>
    </aside>
  );
}
