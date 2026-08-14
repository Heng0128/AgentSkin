// SPDX-License-Identifier: MPL-2.0

/**
 * # FloatingToolbar
 *
 * Floating bottom-center toolbar on the Stage — view-mode switcher,
 * per-window agent dropdown, zoom control, and quick actions
 * (Snapshot · Baseline · Inspect Pick).
 *
 * Snapshot / Baseline delegate to `captureAgentSnapshot` from
 * actions/capturePipeline which handles toasts and landmark-count feedback.
 */

import { useState } from 'react';
import { captureAgentSnapshot } from '@/components/studio/actions/capturePipeline';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ViewMode } from '@/types/workspace';
import { VIEW_MODE_LABELS } from '@/types/workspace';

import type { AgentId } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import { Eye, RefreshCw, Search } from 'lucide-react';

const VIEW_MODE_GROUPS: { id: ViewMode; label: string }[] = [
  { id: 'single', label: '×1' },
  { id: 'dual', label: '×2' },
  { id: 'triple', label: '×3' },
  { id: 'quad', label: '×4' },
  { id: 'focus', label: '⊞' },
];

const ZOOM_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];

export function FloatingToolbar() {
  const { viewMode, setViewMode, windows, activeWindowId, setActiveWindow, updateWindow } =
    useWorkspaceStore();

  const { snapshotLoading, inspectMode, toggleInspect } = useStudioStore();

  const [zoomOpen, setZoomOpen] = useState(false);

  const multiWindow = windows.length > 1;

  // Resolve the active window (for per-window agent + zoom controls).
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
      {/* View-mode chips */}
      <div
        className="flex items-center gap-0 rounded-[var(--r-md)] p-0"
        style={{ background: 'var(--bg-3)' }}
      >
        {VIEW_MODE_GROUPS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setViewMode(id)}
            data-active={viewMode === id}
            className="ws-btn ws-btn--sm"
            title={VIEW_MODE_LABELS[id]}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Per-window selectors (only when multi-window) */}
      {multiWindow && (
        <>
          {/* Window selector chips */}
          <div className="flex items-center gap-0">
            {windows.map((win, idx) => (
              <button
                key={win.id}
                type="button"
                data-active={activeWindowId === win.id}
                onClick={() => setActiveWindow(win.id)}
                className="ws-chip"
                title={`Window ${idx + 1}`}
              >
                W{idx + 1}
              </button>
            ))}
          </div>

          {/* Agent switcher */}
          <select
            value={activeAgentId ?? ''}
            onChange={(e) => handleAgentChange(e.target.value as AgentId)}
            className="h-5 rounded-[var(--r-micro)] border border-[var(--border-subtle)] bg-[var(--bg-3)] px-1 font-mono text-[length:10px] text-[var(--fg-0)] outline-none"
            title="Active window agent"
          >
            {AGENT_IDS.map((id) => (
              <option key={id} value={id}>
                {AGENT_META[id]?.displayName ?? id}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="h-5 w-px bg-[var(--border-default)]" />

      {/* Capture actions */}
      <button
        type="button"
        onClick={handleSnapshot}
        disabled={snapshotLoading}
        className="ws-btn ws-btn--sm ws-btn--primary"
      >
        <Eye className="size-3" />
        Snapshot
      </button>
      <button
        type="button"
        onClick={handleBaseline}
        className="ws-btn ws-btn--sm"
        title="Capture baseline (restore agent to vanilla state)"
      >
        <RefreshCw className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => void toggleInspect()}
        data-active={inspectMode}
        className="ws-btn ws-btn--sm"
        title={inspectMode ? 'Stop inspect' : 'Inspect pick mode'}
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
          title="Zoom"
        >
          {activeWin ? `${activeWin.scale}×` : 'zoom'} ▾
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
