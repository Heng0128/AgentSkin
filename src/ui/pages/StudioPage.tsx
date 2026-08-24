// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioPage
 *
 * Theme Studio — the standalone editor page assembled from the modular
 * studio components. This is the **Studio**, distinct from the Workspace
 * (live tweak). Layout:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ StudioTitleBar                     (window controls, 32px)    │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ StudioTopBar  (project / view switch / export, 52px)          │
 *   ├──────────┬───────────────────────────────┬────────────────────┤
 *   │ Drawer   │  Stage (preview canvas)       │  Inspector         │
 *   ├──────────┴───────────────────────────────┴────────────────────┤
 *   │ StudioStatusBar                       (24px)                  │
 *   └───────────────────────────────────────────────────────────────┘
 *   StudioDock — bottom overlay (toolbox), draggable height
 *
 * The `.ws-root` grid (topbar / drawer / stage / inspector / status) is
 * defined in styles/workspace.css; StudioTitleBar sits above it as the
 * frameless window title bar.
 */

import { useRef, useState } from 'react';
import type { DesktopResolution } from '@/components/studio/device-frame';
import { StudioDock } from '@/components/studio/StudioDock';
import { StudioDrawer } from '@/components/studio/StudioDrawer';
import { StudioInspector } from '@/components/studio/StudioInspector';
import { StudioStage } from '@/components/studio/StudioStage';
import { StudioStatusBar } from '@/components/studio/StudioStatusBar';
import { StudioTitleBar } from '@/components/studio/StudioTitleBar';
import { StudioTopBar } from '@/components/studio/StudioTopBar';
import { useShellStore } from '@/stores/shellStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';

export function StudioPage() {
  const locale = useShellStore((s) => s.locale);
  const t: UiMessages = uiMessages[locale];

  // Lifted state: iframe ref and picked path flow Stage → Inspector.
  const stageIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [resolution, setResolution] = useState<DesktopResolution>('1920x1080');
  const [showDeviceFrame, setShowDeviceFrame] = useState(false);
  const [pickEnabled, _setPickEnabled] = useState(false);

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background font-sans text-foreground">
      <StudioTitleBar />

      <div className="ws-root min-h-0 flex-1" style={{ width: '100%', height: '100%' }}>
        <StudioTopBar t={t} />
        <StudioDrawer t={t} />
        <StudioStage
          t={t}
          pickEnabled={pickEnabled}
          onIframeReady={(iframe) => {
            stageIframeRef.current = iframe;
          }}
          onPickChange={(path) => setPickedPath(path)}
        />
        <StudioInspector
          t={t}
          iframeRef={stageIframeRef}
          pickedPath={pickedPath}
          onClearPicked={() => setPickedPath(null)}
          resolution={resolution}
          onResolutionChange={setResolution}
          showDeviceFrame={showDeviceFrame}
          onToggleDeviceFrame={() => setShowDeviceFrame((v) => !v)}
        />
        <StudioStatusBar t={t} />
        <StudioDock t={t} />
      </div>
    </div>
  );
}
