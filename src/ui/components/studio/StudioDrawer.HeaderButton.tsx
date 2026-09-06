// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDrawer.HeaderButton
 *
 * Collapse toggle button for the StudioDrawer — renders the ◀ handle at the
 * bottom of the drawer that collapses the panel to icon-rail width.
 *
 * Extracted from StudioDrawer (RC-12) to reduce the parent to a thin
 * orchestration layer.
 */

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';

export interface HeaderButtonProps {
  t: UiMessages;
}

export function HeaderButton({ t }: HeaderButtonProps) {
  const setDrawerCollapsed = useWorkspaceStore((s) => s.setDrawerCollapsed);

  return (
    <button
      type="button"
      className="flex items-center justify-center h-6 w-full border-t border-border cursor-pointer shrink-0 bg-transparent"
      onClick={() => setDrawerCollapsed(true)}
      title={t.collapseSidebar}
    >
      <span className="text-micro text-muted-foreground">◀</span>
    </button>
  );
}
