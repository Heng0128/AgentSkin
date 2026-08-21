// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioTopBar
 *
 * Workspace top bar — brand cluster, undo/redo, panel toggles.
 * 52px fixed height.
 *
 * Multi-mode view switcher and workspace preset dropdown are removed
 * (single-window only).
 *
 * State wiring:
 *   · undo() / redo()                     studioStore (undoStack / redoStack)
 *   · activeProject / getActiveProject()  studioStore
 *   · dock / drawer / inspector toggle    workspaceStore
 */

import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { PreviewView } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

/** Ordered list of center tabs for the TopBar view switcher. */
const TOPBAR_TABS: {
  view: PreviewView;
  labelKey: 'studioTabTheme' | 'studioTabWallpaper' | 'studioTabBundle' | 'studioTabRaw';
}[] = [
  { view: 'theme', labelKey: 'studioTabTheme' },
  { view: 'wallpaper', labelKey: 'studioTabWallpaper' },
  { view: 'bundle', labelKey: 'studioTabBundle' },
  { view: 'raw', labelKey: 'studioTabRaw' },
];

export function StudioTopBar({ t }: { t: UiMessages }) {
  const { dock, drawer, inspector, toggleDock, toggleDrawer, toggleInspector } =
    useWorkspaceStore();

  const activeProject = useStudioStore((s) => s.getActiveProject());
  const { undoStack, redoStack, previewView } = useStudioStore();

  const undoDisabled = undoStack.length === 0;
  const redoDisabled = redoStack.length === 0;

  const handleUndo = () => {
    if (!undoDisabled) useStudioStore.getState().undo();
  };
  const handleRedo = () => {
    if (!redoDisabled) useStudioStore.getState().redo();
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

        {/* Center view switcher: 4 tabs (theme / wallpaper / bundle / raw) */}
        <div
          className="flex items-center gap-0 ml-[var(--space-2)] rounded-[var(--r-md)] p-0"
          style={{ background: 'var(--bg-3)' }}
        >
          {TOPBAR_TABS.map((tab) => (
            <button
              key={tab.view}
              type="button"
              data-active={previewView === tab.view}
              onClick={() => useStudioStore.getState().setPreviewView(tab.view)}
              className="ws-btn ws-btn--sm"
              title={t[tab.labelKey]}
            >
              {t[tab.labelKey]}
            </button>
          ))}
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
    </header>
  );
}
