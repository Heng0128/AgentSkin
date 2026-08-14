// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDock
 *
 * Bottom dock panel — fixed overlay with draggable height, tab bar
 * (FX / Export), and content routing.
 *
 * Features:
 *   · 5px drag handle for height adjustment (clamped via workspaceStore)
 *   · 32px tab bar with active indicator
 *   · Collapsed state shows tab bar only (height ≈ 32px + handle)
 *   · Content area overflow-x-auto for horizontal card rows
 */

import { useCallback, useRef } from 'react';
import { DockTabExport } from '@/components/studio/DockTabExport';
import { DockTabFX } from '@/components/studio/DockTabFX';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { DockTabId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';

const DOCK_TABS: { id: DockTabId; label: string }[] = [
  { id: 'fx', label: 'FX' },
  { id: 'export', label: 'Export' },
];

export function StudioDock({ t }: { t: UiMessages }) {
  const dock = useWorkspaceStore((s) => s.dock);
  const setDockTab = useWorkspaceStore((s) => s.setDockTab);
  const setDockHeight = useWorkspaceStore((s) => s.setDockHeight);
  const toggleDock = useWorkspaceStore((s) => s.toggleDock);

  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const currentH = useWorkspaceStore.getState().dock.height;
      dragRef.current = { startY: e.clientY, startH: currentH };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        // Dragging up increases height, dragging down decreases it
        const delta = dragRef.current.startY - ev.clientY;
        const next = dragRef.current.startH + delta;
        setDockHeight(next);
      };

      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setDockHeight],
  );

  if (!dock.open) return null;

  const height = dock.collapsed ? 32 : dock.height;

  return (
    <div
      className="ws-dock"
      data-open={dock.open ? 'true' : undefined}
      style={{ ['--dock-h-open' as string]: `${height}px` }}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="ws-dock__drag-handle"
        onMouseDown={handleDragStart}
        onDoubleClick={toggleDock}
        title="Drag to resize · Double-click to toggle"
      >
        <span className="sr-only">Drag to resize dock, double-click to toggle</span>
      </button>

      {/* Tab bar */}
      <div className="ws-dock__tabs">
        {DOCK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ws-dock__tab"
            data-active={dock.activeTab === tab.id ? 'true' : undefined}
            onClick={() => setDockTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content (hidden when collapsed) */}
      {!dock.collapsed && (
        <>
          {dock.activeTab === 'fx' && <DockTabFX t={t} />}
          {dock.activeTab === 'export' && <DockTabExport t={t} />}
        </>
      )}
    </div>
  );
}
