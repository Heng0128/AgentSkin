// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioTopBar
 *
 * Workspace top bar — brand cluster, undo/redo, panel toggles,
 * restore, export. 52px fixed height.
 *
 * Multi-mode view switcher and workspace preset dropdown are removed
 * (single-window only).
 *
 * State wiring:
 *   · undo() / redo()                     studioStore (undoStack / redoStack)
 *   · exportTheme()                       studioStore
 *   · restoreAgent()                      studioStore
 *   · activeProject / getActiveProject()  studioStore
 *   · baselines                           studioStore (Restore visible when baseline exists)
 *   · dock / drawer / inspector toggle    workspaceStore
 */

import { useState } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { ChevronsLeft, ChevronsRight, Download, RefreshCw } from 'lucide-react';
import { ExportDialog } from './ExportDialog';

export function StudioTopBar({ t }: { t: UiMessages }) {
  const { dock, drawer, inspector, toggleDock, toggleDrawer, toggleInspector } =
    useWorkspaceStore();

  const activeProject = useStudioStore((s) => s.getActiveProject());
  const { snapshot, exportState, undoStack, redoStack, baselines } = useStudioStore();

  const undoDisabled = undoStack.length === 0;
  const redoDisabled = redoStack.length === 0;

  // Local UI state
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
      showToast(t.studioToastCaptureSnapshotFirst, 'destructive');
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
        <span className="ws-topbar__brand-name">{t.studioBrand}</span>
        <span
          className="badge-beta inline-flex items-center h-4 px-1 rounded-[var(--r-micro)] font-mono text-[10px] font-bold"
          style={{
            background: 'var(--accent-ghost)',
            color: 'var(--accent)',
            border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
          }}
        >
          {t.studioHeaderBeta}
        </span>
        {activeProject && (
          <button
            type="button"
            className="ws-topbar__project-name hover:text-[var(--fg-0)] transition-colors"
            title={t.studioSwitchProject}
            onClick={() => useWorkspaceStore.getState().toggleDrawer()}
          >
            / {activeProject.name}
          </button>
        )}
      </div>

      {/* Center: undo/redo + panel toggles */}
      <div className="ws-topbar__center">
        {/* Undo / Redo */}
        <div
          className="flex items-center gap-[var(--space-1)] rounded-[var(--r-md)] p-0"
          style={{ background: 'var(--bg-3)' }}
        >
          <button
            type="button"
            disabled={undoDisabled}
            onClick={handleUndo}
            className="ws-btn ws-btn--sm"
            title={t.studioUndo}
          >
            <ChevronsLeft className="size-3" />
          </button>
          <button
            type="button"
            disabled={redoDisabled}
            onClick={handleRedo}
            className="ws-btn ws-btn--sm"
            title={t.studioRedo}
          >
            <ChevronsRight className="size-3" />
          </button>
        </div>

        {/* Panel toggles */}
        <div
          className="flex items-center gap-[var(--space-1)] ml-[var(--space-2)] rounded-[var(--r-md)] p-0"
          style={{ background: 'var(--bg-3)' }}
        >
          <button
            type="button"
            data-active={dock.open}
            onClick={toggleDock}
            className="ws-btn ws-btn--sm"
            title={t.studioDockToggle}
          >
            {t.studioDockTabFx}
          </button>
          <button
            type="button"
            data-active={drawer.open}
            onClick={toggleDrawer}
            className="ws-btn ws-btn--sm"
            title={t.studioDrawerToggle}
          >
            {t.studioDrawerToggle}
          </button>
          <button
            type="button"
            data-active={inspector.open}
            onClick={toggleInspector}
            className="ws-btn ws-btn--sm"
            title={t.studioInspectorToggle}
          >
            {t.studioInspectorToggle}
          </button>
        </div>
      </div>

      {/* Right: Restore + Export */}
      <div className="ws-topbar__right">
        {/* Restore: only when baseline exists for current agent */}
        {hasBaseline && (
          <button
            type="button"
            className="ws-btn"
            onClick={handleRestore}
            title={t.studioRestoreBaseline}
          >
            <RefreshCw className="size-3" />
            {t.studioRestore}
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
          {exportState.loading ? t.studioExporting : t.studioExportButton}
        </button>
      </div>

      {/* Export dialog */}
      <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} t={t} />
    </header>
  );
}
