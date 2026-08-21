// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStatusBar
 *
 * Workspace status bar — 24px fixed bottom, displays zoom percentage.
 *
 * Multi-window view mode display is removed.
 */

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';

export function StudioStatusBar({ t }: { t: UiMessages }) {
  const window = useWorkspaceStore((s) => s.window);

  const scale = window?.scale ?? 1;
  const zoomPct = Math.round(scale * 100);

  return (
    <footer className="ws-statusbar">
      <span>{t.studioStatusZoom(zoomPct)}</span>
    </footer>
  );
}
