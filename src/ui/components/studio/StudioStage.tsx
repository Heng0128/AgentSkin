// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStage
 *
 * Workspace stage region — renders N preview windows based on the current
 * viewMode (single / dual / triple / focus / quad).
 *
 * Layout: the grid-template is driven by the `[data-view]` attribute on
 * .ws-stage__inner, implemented in workspace.css.
 *
 * When a snapshot exists, domTree + rootVars are passed to the first window
 * for real DOM rendering. Otherwise an empty-state placeholder is shown.
 */

import { FloatingToolbar } from '@/components/studio/FloatingToolbar';
import { PreviewWindow } from '@/components/studio/PreviewWindow';
import { HugeIcon } from '@/components/ui/huge-icon';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { BeakerIcon } from '@hugeicons/core-free-icons';
import type { DomTreeNode } from '@shared/types';

export function StudioStage() {
  const { viewMode, windows, activeWindowId, setActiveWindow, updateWindow, removeWindow } =
    useWorkspaceStore();

  const snapshot = useStudioStore((s) => s.snapshot);

  const domTree: DomTreeNode | undefined = snapshot?.domTree;
  const rootVars = snapshot?.rootVars;

  // Empty state: no snapshot yet captured for the active project.
  if (!windows.length) {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner">
          <div className="ws-stage__placeholder">
            <div className="ws-stage__placeholder-icon">
              <HugeIcon icon={BeakerIcon} className="size-6 text-fg-3" />
            </div>
            <p className="ws-stage__placeholder-title">No preview windows</p>
            <p className="ws-stage__placeholder-hint">
              Click the&nbsp;
              <span className="font-mono text-[var(--accent)]">SNAPSHOT</span>
              &nbsp;button below to capture the agent DOM and begin previewing.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Window props builder — first window receives the real DOM.
  const firstWindow = windows[0];

  const renderPreviewWindow = (
    win: (typeof windows)[number],
    idx: number,
    opts?: { onClose?: () => void },
  ) => (
    <PreviewWindow
      key={win.id}
      win={win}
      active={activeWindowId === win.id}
      onSelect={() => setActiveWindow(win.id)}
      onScaleChange={(s) => updateWindow(win.id, { scale: s })}
      onClose={opts?.onClose}
      domTree={idx === 0 ? domTree : undefined}
      rootVars={idx === 0 ? rootVars : undefined}
    />
  );

  if (viewMode === 'focus') {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner" data-view="focus">
          {renderPreviewWindow(firstWindow, 0)}
          <div className="ws-focus-side">
            {windows.slice(1).map((win, i) => renderPreviewWindow(win, i + 1))}
          </div>
        </div>
        <FloatingToolbar />
      </main>
    );
  }

  return (
    <main className="ws-stage">
      <div className="ws-stage__inner" data-view={viewMode}>
        {windows.map((win, idx) =>
          renderPreviewWindow(win, idx, {
            onClose: windows.length > 1 ? () => removeWindow(win.id) : undefined,
          }),
        )}
      </div>
      <FloatingToolbar />
    </main>
  );
}
