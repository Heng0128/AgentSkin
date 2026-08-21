// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStage
 *
 * Workspace stage region — renders a single preview window.
 *
 * Single-window architecture — workspaceStore exposes a single `window` object.
 * PreviewWindow uses the useLiveDom hook for real-time CDP DOM streaming
 * with snapshot fallback caching. Inspect / Zoom functionality is preserved.
 */

import { CenterStageTab } from '@/components/studio/CenterStageTab';
import { FloatingToolbar } from '@/components/studio/FloatingToolbar';
import { PreviewWindow } from '@/components/studio/PreviewWindow';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { FlaskConical } from 'lucide-react';

export function StudioStage({ t }: { t: UiMessages }) {
  const window = useWorkspaceStore((s) => s.window);

  const previewView = useStudioStore((s) => s.previewView);

  // Non-theme center tabs (wallpaper / bundle / raw).
  if (previewView !== 'theme') {
    return (
      <main className="ws-stage">
        <div className="ws-stage__inner" data-view={previewView}>
          <CenterStageTab view={previewView} t={t} />
        </div>
      </main>
    );
  }

  // No window — should not happen with single-window architecture.
  if (!window) {
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

  return (
    <main className="ws-stage">
      <div className="ws-stage__inner" data-view="single">
        <PreviewWindow
          key={window.id}
          win={window}
          active={true}
          onSelect={() => {}}
          onScaleChange={(_s) => {}}
          t={t}
        />
      </div>
      <FloatingToolbar t={t} />
    </main>
  );
}
