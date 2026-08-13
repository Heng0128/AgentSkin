// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioTopBar
 *
 * Workspace top bar — brand cluster, undo/redo, view-mode chips,
 * workspace switcher, restore, export. 52px fixed height.
 *
 * State wiring:
 *   · viewMode / setViewMode              workspaceStore
 *   · undo() / redo()                     studioStore (undoStack / redoStack)
 *   · exportTheme()                       studioStore
 *   · restoreAgent()                      studioStore
 *   · activeProject / getActiveProject()  studioStore
 *   · baselines                           studioStore (Restore visible when baseline exists)
 */

import { useState } from 'react';
import { WorkspaceSwitcher } from '@/components/studio/WorkspaceSwitcher';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { ChevronsLeft, ChevronsRight, Download, RefreshCw } from 'lucide-react';
import { ExportDialog } from './ExportDialog';

function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export function StudioTopBar() {
  const {
    viewMode,
    setViewMode,
    dock,
    drawer,
    inspector,
    toggleDock,
    toggleDrawer,
    toggleInspector,
  } = useWorkspaceStore();

  const activeProject = useStudioStore((s) => s.getActiveProject());
  const { snapshot, exportState, undoStack, redoStack, baselines } = useStudioStore();

  const undoDisabled = undoStack.length === 0;
  const redoDisabled = redoStack.length === 0;

  // Local UI state
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const showToast = useNotificationStore((s) => s.showToast);

  const hasBaseline = activeProject ? Boolean(baselines[activeProject.agentId]) : false;

  const handleUndo = () => {
    if (!undoDisabled) useStudioStore.getState().undo();
  };
  const handleRedo = () => {
    if (!redoDisabled) useStudioStore.getState().redo();
  };
  const handleExport = () => {
    if (exportState.loading) return;
    if (!snapshot) {
      showToast('Please capture a snapshot first', 'destructive');
      return;
    }
    setExportDialogOpen(true);
  };
  const handleRestore = () => {
    void useStudioStore.getState().restoreAgent();
  };

  return (
    <header className="ws-topbar">
      {/* Left: brand + project name (clickable -> opens project switcher in drawer) */}
      <div className="ws-topbar__left">
        <span className="ws-topbar__brand-icon">✦</span>
        <span className="ws-topbar__brand-name">Studio</span>
        <span
          className="badge-beta inline-flex items-center h-4 px-[5px] rounded-[var(--r-micro)] font-mono text-[length:9px] font-bold tracking-wider"
          style={{
            background: 'var(--accent-ghost)',
            color: 'var(--accent)',
            border: '1px solid rgba(255, 69, 58, 0.3)',
            letterSpacing: '0.12em',
          }}
        >
          BETA
        </span>
        {activeProject && (
          <button
            type="button"
            className="ws-topbar__project-name hover:text-[var(--fg-0)] transition-colors"
            title="Switch project"
            onClick={() => useWorkspaceStore.getState().toggleDrawer()}
          >
            / {activeProject.name}
          </button>
        )}
      </div>

      {/* Center: view-mode chips + undo/redo */}
      <div className="ws-topbar__center">
        {/* View-mode chips */}
        <div
          className="flex items-center gap-[var(--space-1)] rounded-[var(--r-md)] p-[2px]"
          style={{ background: 'var(--bg-3)' }}
        >
          {(['single', 'dual', 'triple', 'quad', 'focus'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              data-active={viewMode === mode}
              className="ws-btn ws-btn--sm"
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Undo / Redo */}
        <div
          className="flex items-center gap-[var(--space-1)] ml-[var(--space-2)] rounded-[var(--r-md)] p-[2px]"
          style={{ background: 'var(--bg-3)' }}
        >
          <button
            type="button"
            disabled={undoDisabled}
            onClick={handleUndo}
            className="ws-btn ws-btn--sm"
            title="Undo"
          >
            <ChevronsLeft className="size-3" />
          </button>
          <button
            type="button"
            disabled={redoDisabled}
            onClick={handleRedo}
            className="ws-btn ws-btn--sm"
            title="Redo"
          >
            <ChevronsRight className="size-3" />
          </button>
        </div>

        {/* Panel toggles */}
        <div
          className="flex items-center gap-[var(--space-1)] ml-[var(--space-2)] rounded-[var(--r-md)] p-[2px]"
          style={{ background: 'var(--bg-3)' }}
        >
          <button
            type="button"
            data-active={dock.open}
            onClick={toggleDock}
            className="ws-btn ws-btn--sm"
            title="Dock"
          >
            FX
          </button>
          <button
            type="button"
            data-active={drawer.open}
            onClick={toggleDrawer}
            className="ws-btn ws-btn--sm"
            title="Drawer"
          >
            Lib
          </button>
          <button
            type="button"
            data-active={inspector.open}
            onClick={toggleInspector}
            className="ws-btn ws-btn--sm"
            title="Inspector"
          >
            Ins
          </button>
        </div>
      </div>

      {/* Right: Workspaces + Restore + Export */}
      <div className="ws-topbar__right">
        {/* Workspace preset switcher trigger */}
        <button
          type="button"
          className="ws-btn ws-btn--sm"
          onClick={() => setSwitcherOpen(true)}
          title="Workspace presets"
        >
          ▢ Workspaces ▼
        </button>

        {/* Restore: only when baseline exists for current agent */}
        {hasBaseline && (
          <button
            type="button"
            className="ws-btn"
            onClick={handleRestore}
            title="Restore agent to native baseline"
          >
            <RefreshCw className="size-3" />
            Restore
          </button>
        )}

        {/* Export */}
        <button
          type="button"
          className="ws-btn ws-btn--primary"
          disabled={!snapshot || exportState.loading}
          onClick={handleExport}
        >
          <Download className="size-3" />
          {exportState.loading ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {/* Workspace preset switcher overlay */}
      <WorkspaceSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />

      {/* Export dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        t={currentT()}
      />
    </header>
  );
}
