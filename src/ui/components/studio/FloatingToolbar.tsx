// SPDX-License-Identifier: MPL-2.0

/**
 * # FloatingToolbar
 *
 * Floating bottom-center toolbar on the Stage — zoom control and quick
 * actions (Snapshot · Baseline · Inspect Pick).
 *
 * Multi-window view-mode switching and window/agent selectors are removed.
 * Single-window Studio only renders one PreviewWindow.
 */

import { useState } from 'react';
import { captureAgentSnapshot } from '@/components/studio/actions/capturePipeline';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import { Eye, RefreshCw, Search } from 'lucide-react';

const ZOOM_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];

export function FloatingToolbar({ t }: { t: UiMessages }) {
  const { windows, activeWindowId, updateWindow } = useWorkspaceStore();

  const { snapshotLoading, inspectMode, toggleInspect } = useStudioStore();

  const [zoomOpen, setZoomOpen] = useState(false);

  // Resolved active window (single — always windows[0]).
  const activeWin = windows.find((w) => w.id === activeWindowId) ?? windows[0];
  const activeAgentId = activeWin?.agentId;

  // --- handlers ---

  const handleSnapshot = () => {
    if (!activeAgentId) return;
    void captureAgentSnapshot(activeAgentId, 'current');
  };

  const handleBaseline = () => {
    if (!activeAgentId) return;
    void captureAgentSnapshot(activeAgentId, 'baseline');
  };

  const handleAgentChange = (agentId: AgentId) => {
    if (!activeWin) return;
    updateWindow(activeWin.id, { agentId });
  };

  const handleZoom = (scale: number) => {
    if (!activeWin) return;
    updateWindow(activeWin.id, { scale });
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

      {/* Capture actions */}
      <button
        type="button"
        onClick={handleSnapshot}
        disabled={snapshotLoading}
        className="ws-btn ws-btn--sm ws-btn--primary"
      >
        <Eye className="size-3" />
        {t.studioSnapshotButton}
      </button>
      <button
        type="button"
        onClick={handleBaseline}
        className="ws-btn ws-btn--sm"
        title={t.studioBaselineTooltip}
      >
        <RefreshCw className="size-3" />
      </button>
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
          {activeWin ? `${activeWin.scale}×` : t.studioZoomFallback} ▾
        </button>
        {zoomOpen && (
          <div className="absolute bottom-full right-0 z-10 mb-[2px] flex flex-col gap-0 rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-0 shadow-[var(--shadow-float)]">
            {ZOOM_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleZoom(s)}
                className="whitespace-nowrap rounded-[var(--r-micro)] px-[var(--space-2)] py-0 text-left font-mono text-[length:10px] hover:bg-[var(--bg-3)]"
                style={{
                  background: activeWin?.scale === s ? 'var(--accent-ghost)' : 'transparent',
                  color: activeWin?.scale === s ? 'var(--accent)' : 'var(--fg-0)',
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
