// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStage
 *
 * Workspace stage region — renders a single preview window wrapped in a
 * DeviceFrame for resolution-preset presentation.
 *
 * Single-window architecture — workspaceStore exposes a single `window` object.
 * PreviewWindow uses the useLiveDom hook for real-time CDP DOM streaming
 * with snapshot fallback caching. Inspect / Zoom functionality is preserved.
 *
 * Lifted state (iframeRef / pickedPath) is exposed to the parent via optional
 * callbacks so StudioInspector can drive element picking and DOM inspection.
 */

import { useEffect, useRef, useState } from 'react';
import { CenterStageTab } from '@/components/studio/CenterStageTab';
import { FloatingToolbar } from '@/components/studio/FloatingToolbar';
import { PreviewWindow } from '@/components/studio/PreviewWindow';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { FlaskConical } from 'lucide-react';
import { DeviceFrame, useResolutionPreset } from './device-frame';

export interface StudioStageProps {
  t: UiMessages;
  /** Callback when iframe ref is ready. */
  onIframeReady?: (iframe: HTMLIFrameElement | null) => void;
  /** Callback when picked path changes. */
  onPickChange?: (path: string | null) => void;
  /** External pick mode control. */
  pickEnabled?: boolean;
}

export function StudioStage({
  t,
  onIframeReady,
  onPickChange,
  pickEnabled = false,
}: StudioStageProps) {
  const window = useWorkspaceStore((s) => s.window);
  const previewView = useStudioStore((s) => s.previewView);

  // Lifted state for inspector integration
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeElement, setIframeElement] = useState<HTMLIFrameElement | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const { preset, showFrame } = useResolutionPreset('1920x1080');

  // Expose lifted state to parent via callbacks
  useEffect(() => {
    onIframeReady?.(iframeElement);
  }, [iframeElement, onIframeReady]);

  useEffect(() => {
    onPickChange?.(pickedPath);
  }, [pickedPath, onPickChange]);

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
              <FlaskConical className="size-6 text-muted-foreground" />
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
        <DeviceFrame preset={preset} showFrame={showFrame} scale={window.scale} className="mx-auto">
          <PreviewWindow
            key={window.id}
            win={window}
            active={true}
            onSelect={() => {}}
            onScaleChange={(_s) => {}}
            onIframeReady={(iframe) => {
              setIframeElement(iframe);
              iframeRef.current = iframe;
            }}
            onPick={(path) => setPickedPath(path)}
            externalPickedPath={pickedPath}
            pickEnabled={pickEnabled}
            t={t}
          />
        </DeviceFrame>
      </div>
      <FloatingToolbar t={t} />
    </main>
  );
}
