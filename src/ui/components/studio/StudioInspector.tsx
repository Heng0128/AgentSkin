// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioInspector
 *
 * Right sidebar inspector — collapsible 240px panel with Profile tab,
 * Element tab for picked element details, window indicator chip for
 * cross-window linkage, and content routing per tab.
 *
 * State:
 *   · workspaceStore: open / width / activeTab / collapsed
 *   · studioStore: activeProject (for window indicator chip)
 */

import { AppMark } from '@/components/app-mark';
import { InspectorProfile } from '@/components/studio/InspectorProfile';
import { InspectorElement } from '@/components/studio/inspector-element';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { InspectorTabId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META } from '@shared/types';
import { type DesktopResolution, RESOLUTION_PRESETS } from './device-frame';

/** Map inspector tab IDs to their i18n label keys. */
const TAB_LABEL: Record<InspectorTabId, (t: UiMessages) => string> = {
  profile: (t) => t.studioTabProfile,
  element: (t) => t.studioTabElement ?? 'Element',
};

export function StudioInspector({
  t,
  iframeRef,
  pickedPath,
  onClearPicked,
  resolution,
  onResolutionChange,
  showDeviceFrame,
  onToggleDeviceFrame,
}: {
  t: UiMessages;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  pickedPath?: string | null;
  onClearPicked?: () => void;
  /** Current resolution preset (controlled by parent). */
  resolution?: DesktopResolution;
  /** Callback when user changes resolution. */
  onResolutionChange?: (preset: DesktopResolution) => void;
  /** Whether to show device frame. */
  showDeviceFrame?: boolean;
  /** Toggle device frame. */
  onToggleDeviceFrame?: () => void;
}) {
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
            className="text-micro   text-muted-foreground"
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

      {/* Resolution preset control bar */}
      <div className="ws-inspector__resolution flex items-center gap-1 border-b border-border p-1">
        <div className="flex items-center gap-1">
          {(Object.keys(RESOLUTION_PRESETS) as DesktopResolution[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onResolutionChange?.(key)}
              className="ws-inspector__res-btn rounded-sm px-1 py-0 text-micro"
              data-active={resolution === key ? 'true' : undefined}
              title={RESOLUTION_PRESETS[key].label}
            >
              {RESOLUTION_PRESETS[key].width}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onToggleDeviceFrame?.()}
          className="ws-inspector__frame-toggle ml-auto text-micro"
          data-active={showDeviceFrame ? 'true' : undefined}
          title={t.studioToggleDeviceFrame ?? 'Toggle Frame'}
        >
          🖥
        </button>
      </div>

      {/* Tab bar */}
      <div className="ws-inspector__tabs">
        {(['profile', 'element'] as InspectorTabId[]).map((id) => (
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
        {inspector.activeTab === 'element' && (
          <InspectorElement
            iframeRef={iframeRef ?? { current: null }}
            pickedPath={pickedPath ?? null}
            onClose={() => onClearPicked?.()}
          />
        )}
      </div>
    </aside>
  );
}
