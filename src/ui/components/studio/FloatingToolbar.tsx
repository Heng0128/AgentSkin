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
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import { Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const ZOOM_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];

export function FloatingToolbar({ t }: { t: UiMessages }) {
  const window = useWorkspaceStore((s) => s.window);
  const setWindowScale = useWorkspaceStore((s) => s.setWindowScale);

  // RC2-A fix: Replace full-store subscription with precise selector + useShallow
  // to avoid re-renders when unrelated sub-store fields change.
  const { inspectMode, toggleInspect } = useStudioStore(
    useShallow((s) => ({
      inspectMode: s.inspectMode,
      toggleInspect: s.toggleInspect,
    })),
  );

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
        className="h-6 rounded-md border border-border bg-card2 px-1 text-[11px] text-foreground outline-none"
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

      <div className="h-5 w-px bg-border" />

      {/* Inspect toggle */}
      <Button
        size="icon-xs"
        variant={inspectMode ? 'primary' : 'ghost'}
        onClick={() => void toggleInspect()}
        title={inspectMode ? t.studioInspectStop : t.studioInspectStart}
      >
        <Search className="size-3" />
      </Button>

      <div className="h-5 w-px bg-border" />

      {/* Zoom control */}
      <div className="relative">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setZoomOpen((v) => !v)}
          title={t.studioZoom}
        >
          {window ? `${window.scale}×` : t.studioZoomFallback} ▾
        </Button>
        {zoomOpen && (
          <div className="absolute bottom-full right-0 z-[var(--z-content)] mb-1 flex flex-col gap-0 rounded-md border border-border bg-card p-0 shadow-[var(--shadow-float)]">
            {ZOOM_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleZoom(s)}
                className="whitespace-nowrap rounded-md px-2 py-0 text-left text-[11px] hover:bg-card2"
                style={{
                  background: window?.scale === s ? 'var(--primary)' : 'transparent',
                  color: window?.scale === s ? 'var(--primary-foreground)' : 'var(--foreground)',
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
