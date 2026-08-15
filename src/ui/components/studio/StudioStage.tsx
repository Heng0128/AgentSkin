// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStage
 *
 * Workspace stage region — renders a single preview window.
 *
 * Multi-window modes (dual / triple / focus / quad) are removed.
 * Snapshot / Baseline / Inspect / Zoom functionality is preserved.
 */

import { FloatingToolbar } from '@/components/studio/FloatingToolbar';
import { PreviewWindow } from '@/components/studio/PreviewWindow';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { DomTreeNode } from '@shared/types';
import { FlaskConical } from 'lucide-react';

export function StudioStage() {
  const { windows, activeWindowId, setActiveWindow, updateWindow } = useWorkspaceStore();

  const snapshot = useStudioStore((s) => s.snapshot);

  const domTree: DomTreeNode | undefined = snapshot?.domTree;
  const rootVars = snapshot?.rootVars;

  // No windows — should not happen with single-window architecture.
  if (!windows.length) {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner">
          <div className="ws-stage__placeholder">
            <div className="ws-stage__placeholder-icon">
              <FlaskConical className="size-6 text-[var(--fg-3)]" />
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

  const win = windows[0];

  return (
    <main className="ws-stage">
      <div className="ws-stage__inner" data-view="single">
        <PreviewWindow
          key={win.id}
          win={win}
          active={activeWindowId === win.id}
          onSelect={() => setActiveWindow(win.id)}
          onScaleChange={(s) => updateWindow(win.id, { scale: s })}
          domTree={domTree}
          rootVars={rootVars}
        />
      </div>
      <FloatingToolbar />
    </main>
  );
}
