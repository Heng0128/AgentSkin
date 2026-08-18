// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStage
 *
 * Workspace stage region — renders a single preview window.
 *
 * Multi-window modes (dual / triple / focus / quad) are removed.
 * Snapshot / Baseline / Inspect / Zoom functionality is preserved.
 */

import { CenterStageTab } from '@/components/studio/CenterStageTab';
import { FloatingToolbar } from '@/components/studio/FloatingToolbar';
import { PreviewWindow } from '@/components/studio/PreviewWindow';
import { StudioImageToThemePanel } from '@/components/studio/StudioImageToThemePanel';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import type { DomTreeNode } from '@shared/types';
import { FlaskConical } from 'lucide-react';

export function StudioStage({ t }: { t: UiMessages }) {
  const { windows, activeWindowId, setActiveWindow, updateWindow } = useWorkspaceStore();

  const snapshot = useStudioStore((s) => s.snapshot);
  const previewView = useStudioStore((s) => s.previewView);

  const domTree: DomTreeNode | undefined = snapshot?.domTree;
  const rootVars = snapshot?.rootVars;

  // Generator (image → theme) panel replaces the preview stage.
  if (previewView === 'generator') {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner" data-view="generator">
          <StudioImageToThemePanel t={t} />
        </div>
      </main>
    );
  }

  // Non-theme center tabs (wallpaper / bundle / inspect / raw).
  if (previewView !== 'theme') {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner" data-view={previewView}>
          <CenterStageTab view={previewView} t={t} />
        </div>
      </main>
    );
  }

  // No windows — should not happen with single-window architecture.
  if (!windows.length) {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner">
          <div className="ws-stage__placeholder">
            <div className="ws-stage__placeholder-icon">
              <FlaskConical className="size-6 text-[var(--fg-3)]" />
            </div>
            <p className="ws-stage__placeholder-title">{t.studioEmptyNoWindows}</p>
            <p className="ws-stage__placeholder-hint">{t.studioEmptySnapHintStage}</p>
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
          t={t}
        />
      </div>
      <FloatingToolbar t={t} />
    </main>
  );
}
