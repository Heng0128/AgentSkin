// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDock
 *
 * Bottom dock panel — fixed overlay with draggable height, tab bar
 * (Export), and content routing.
 *
 * Features:
 *   · 5px drag handle for height adjustment (clamped via workspaceStore)
 *   · 32px tab bar with active indicator
 *   · Collapsed state shows tab bar only (height ≈ 32px + handle)
 *   · Content area overflow-x-auto for horizontal card rows
 */

import { useCallback, useRef } from 'react';

// Dock height clamping — matches workspaceStore constraints.
const MIN_DOCK_HEIGHT = 160;
const MAX_DOCK_HEIGHT = 600;

import { DockTabExport } from '@/components/studio/DockTabExport';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { DockTabId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';

const DOCK_TABS: { id: DockTabId; labelKey: 'studioDockTabExport' }[] = [
  { id: 'export', labelKey: 'studioDockTabExport' },
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

      // P1 perf: use a callback ref to hold the latest target height so the
      // mousemove handler can update the DOM directly without triggering a
      // React re-render on every frame. The store is synced only on mouseup.
      const targetHeight = { value: currentH };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        // Dragging up increases height, dragging down decreases it
        const delta = dragRef.current.startY - ev.clientY;
        targetHeight.value = Math.min(
          MAX_DOCK_HEIGHT,
          Math.max(MIN_DOCK_HEIGHT, dragRef.current.startH + delta),
        );
        // Direct DOM update — bypasses React reconciliation for the duration
        // of the drag, syncing the store only on mouseup.
        const dockEl = document.querySelector<HTMLElement>('.ws-dock');
        if (dockEl) {
          dockEl.style.setProperty('--dock-h-open', `${targetHeight.value}px`);
        }
      };

      const onUp = () => {
        dragRef.current = null;
        // Sync the final height to the store once, triggering a single
        // re-render to persist the value.
        setDockHeight(targetHeight.value);
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
        title={t.studioDockDragHint}
      >
        <span className="sr-only">{t.studioDockDragHintSr}</span>
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
            {t[tab.labelKey]}
          </button>
        ))}
      </div>

      {/* Content (hidden when collapsed) */}
      {!dock.collapsed && <>{dock.activeTab === 'export' && <DockTabExport t={t} />}</>}
    </div>
  );
}
