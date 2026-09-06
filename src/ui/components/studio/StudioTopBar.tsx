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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { PreviewView } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

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
  // RC1-step3: Replace full-store subscription with precise selector + useShallow
  // to prevent re-renders when unrelated workspace fields change.
  const { dock, drawer, inspector, toggleDock, toggleDrawer, toggleInspector } = useWorkspaceStore(
    useShallow((s) => ({
      dock: s.dock,
      drawer: s.drawer,
      inspector: s.inspector,
      toggleDock: s.toggleDock,
      toggleDrawer: s.toggleDrawer,
      toggleInspector: s.toggleInspector,
    })),
  );

  const activeProject = useStudioStore((s) => s.getActiveProject());
  // RC2-A fix: Replace full-store subscription with precise selector + useShallow
  const { undoStack, redoStack, previewView } = useStudioStore(
    useShallow((s) => ({
      undoStack: s.undoStack,
      redoStack: s.redoStack,
      previewView: s.previewView,
    })),
  );

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
        <Badge variant="default" className="h-4 px-1 text-[11px] font-normal">
          {t.studioHeaderBeta}
        </Badge>
        {activeProject && (
          <button
            type="button"
            className="ws-topbar__project-name hover:text-foreground transition-colors"
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
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={undoDisabled}
            onClick={handleUndo}
            title={t.studioUndo}
          >
            <ChevronsLeft className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={redoDisabled}
            onClick={handleRedo}
            title={t.studioRedo}
          >
            <ChevronsRight className="size-3" />
          </Button>
        </div>

        {/* Center view switcher: 4 tabs (theme / wallpaper / bundle / raw) */}
        <div className="ml-2 flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {TOPBAR_TABS.map((tab) => (
            <Button
              key={tab.view}
              size="xs"
              variant={previewView === tab.view ? 'primary' : 'ghost'}
              onClick={() => useStudioStore.getState().setPreviewView(tab.view)}
              title={t[tab.labelKey]}
            >
              {t[tab.labelKey]}
            </Button>
          ))}
        </div>

        {/* Panel toggles */}
        <div className="ml-2 flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          <Button
            size="xs"
            variant={dock.open ? 'primary' : 'ghost'}
            onClick={toggleDock}
            title={t.studioDockToggle}
          >
            {t.studioDockTabFx}
          </Button>
          <Button
            size="xs"
            variant={drawer.open ? 'primary' : 'ghost'}
            onClick={toggleDrawer}
            title={t.studioDrawerToggle}
          >
            {t.studioDrawerToggle}
          </Button>
          <Button
            size="xs"
            variant={inspector.open ? 'primary' : 'ghost'}
            onClick={toggleInspector}
            title={t.studioInspectorToggle}
          >
            {t.studioInspectorToggle}
          </Button>
        </div>
      </div>
    </header>
  );
}
