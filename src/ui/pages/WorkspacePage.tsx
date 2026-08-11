// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspacePage
 *
 * New Stage + Dock + Inspector layout shell — assembles the workspace.
 *
 * Layout (CSS grid on .ws-root):
 *   · topbar    52px
 *   · drawer    200px (collapsible → 48px)
 *   · stage     flex-1
 *   · inspector 240px (collapsible → 4px) — StudioInspector
 *   · status    24px
 *   · dock      fixed overlay at bottom — StudioDock
 */

import { useState } from 'react';
import { StudioDock } from '@/components/studio/StudioDock';
import { StudioDrawer } from '@/components/studio/StudioDrawer';
import { StudioInspector } from '@/components/studio/StudioInspector';
import { StudioStage } from '@/components/studio/StudioStage';
import { StudioStatusBar } from '@/components/studio/StudioStatusBar';
import { StudioTopBar } from '@/components/studio/StudioTopBar';
import { WorkspaceSwitcher } from '@/components/studio/WorkspaceSwitcher';
import { useShellStore } from '@/stores/shellStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { type UiMessages, uiMessages } from '@shared/i18n';
import '@/styles/workspace.css';

/** Read current i18n message table (project-standard pattern). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export function WorkspacePage() {
  const { drawer, inspector } = useWorkspaceStore();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const t = currentT();

  return (
    <div
      className="ws-root"
      data-drawer-collapsed={drawer.collapsed}
      data-inspector-collapsed={inspector.collapsed}
    >
      {/* Top Bar */}
      <StudioTopBar />

      {/* Left Drawer */}
      <StudioDrawer />

      {/* Stage — multi-window preview canvas */}
      <StudioStage />

      {/* Right Inspector — StudioInspector with tab bar */}
      <StudioInspector t={t} />

      {/* Status Bar */}
      <StudioStatusBar />

      {/* Bottom Dock — FX / Export tabs */}
      <StudioDock t={t} />

      {/* Workspace Switcher floating */}
      <WorkspaceSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </div>
  );
}
