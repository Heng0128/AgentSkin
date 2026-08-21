// SPDX-License-Identifier: MPL-2.0

/**
 * # FloatingToolbar
 *
 * Floating bottom-center toolbar on the Stage — zoom control and
 * inspect toggle.
 *
 * Multi-window view-mode switching and window/agent selectors are removed.
 * Single-window Studio only renders one PreviewWindow.
 */

import { useState } from 'react';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import { Search } from 'lucide-react';

const ZOOM_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];

export function FloatingToolbar({ t }: { t: UiMessages }) {
  const window = useWorkspaceStore((s) => s.window);
  const setWindowScale = useWorkspaceStore((s) => s.setWindowScale);

  const { inspectMode, toggleInspect } = useStudioStore();

  const [zoomOpen, setZoomOpen] = useState(false);

  // Single window — always the same one.
  const activeAgentId = window?.agentId;

  // --- handlers ---

  const handleAgentChange = (_agentId: AgentId) => {
    // Single-window: agent change handled by parent via selectAgent.
    // This is a no-op placeholder — agent switching is done through the drawer.
  };

  const handleZoom = (scale: number) => {
    setWindowScale(scale);
    setZoomOpen(false);
  };

  return (
    <div className="ws-float-toolbar">
      {/* Agent switcher (single window still supports agent change) */}
      <select
        value={activeAgentId ?? ''}
        onChange={(e) => handleAgentChange(e.target.value as AgentId)}
        className="h-5 rounded-[var(--r-micro)] border border-[var(--border-subtle)] bg-[var(--bg-3)] px-1 font-mono text-[length:10px] text-[var(--fg-0)] outline-none"
        title={t.studioActiveWindowAgent}
      >
        {(['codex', 'traework', 'qoderwork', 'workbuddy', 'doubao', 'zcode'] as AgentId[]).map(
          (id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ),
        )}
      </select>

      <div className="h-5 w-px bg-[var(--border-default)]" />

      {/* Inspect toggle */}
      <button
        type="button"
        onClick={() => void toggleInspect()}
        data-active={inspectMode}
        className="ws-btn ws-btn--sm"
        title={inspectMode ? t.studioInspectStop : t.studioInspectStart}
      >
        <Search className="size-3" />
      </button>

      <div className="h-5 w-px bg-[var(--border-default)]" />

      {/* Zoom control */}
      <div className="relative">
        <button
          type="button"
          className="ws-btn ws-btn--sm"
          onClick={() => setZoomOpen((v) => !v)}
          title={t.studioZoom}
        >
          {window ? `${window.scale}×` : t.studioZoomFallback} ▾
        </button>
        {zoomOpen && (
          <div className="absolute bottom-full right-0 z-10 mb-1 flex flex-col gap-0 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-0 shadow-[var(--shadow-float)]">
            {ZOOM_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleZoom(s)}
                className="whitespace-nowrap rounded-[var(--r-micro)] px-[var(--space-2)] py-0 text-left font-mono text-[length:10px] hover:bg-[var(--bg-3)]"
                style={{
                  background: window?.scale === s ? 'var(--accent-ghost)' : 'transparent',
                  color: window?.scale === s ? 'var(--accent)' : 'var(--fg-0)',
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
