// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioTitleBar
 *
 * Compact title bar for the standalone Studio window. Replaces the generic
 * {@link TitleBar} (38 px) with a leaner 32 px chrome that matches the
 * Studio tool aesthetic:
 *
 *   - height: 32px sharp, no rounded corners
 *   - left: "✦ Studio" + active project name
 *   - right: window controls (minimize / maximize / close)
 *   - draggable except for the interactive control buttons
 *
 * Window control API is the same preload bridge used by the main window's
 * TitleBar — `api.windowMinimize / windowToggleMaximize / windowClose` —
 * so the Studio window reuses the same IPC channel plumbing.
 *
 * i18n keys (`titlebarMinimize / titlebarMaximize / titlebarRestore /
 * titlebarClose`) are shared with the main TitleBar.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { Maximize, Minimize2, Minus, X } from 'lucide-react';

export function StudioTitleBar() {
  const locale = useShellStore((s) => s.locale);
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const t: UiMessages = uiMessages[locale];

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void api.windowIsMaximized().then(setMaximized);
    const off = api.onWindowMaximizeChange(setMaximized);
    return off;
  }, []);

  /**
   * style icon button — transparent default, ghost background on hover.
   * 24×24 px for the compact 32 px bar (vs 27×27 in the main TitleBar).
   */
  const studioBtn =
    'flex h-6 w-6 items-center justify-center rounded-[2px] border border-transparent text-muted-foreground transition-[background-color,border-color,color] duration-150 hover:bg-card2 hover:text-foreground';

  const projectName = activeProject?.name;

  return (
    <header
      className={cn(
        'relative flex h-8 shrink-0 items-center justify-between gap-2 px-3',
        ' bg-[var(--surface)]',
        // The entire bar is a drag region; interactive controls opt out below.
        '[-webkit-app-region:drag]',
      )}
    >
      {/* Left: brand + active project */}
      <div className="pointer-events-none flex items-center gap-2">
        <span className="font-display text-sm font-bold text-[var(--primary)]">✦</span>
        <span className="font-mono text-[11px] font-semibold   text-foreground">Studio</span>
        {projectName && (
          <>
            <span className="text-[var(--muted-foreground)]">/</span>
            <span className="max-w-[200px] truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {projectName}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: window controls (no-drag region) */}
      <div className="flex items-center gap-0 [-webkit-app-region:no-drag]">
        <button
          type="button"
          title={t.titlebarMinimize}
          aria-label={t.titlebarMinimize}
          onClick={() => api.windowMinimize()}
          className={studioBtn}
        >
          <Minus className="size-3" />
        </button>
        <button
          type="button"
          title={maximized ? t.titlebarRestore : t.titlebarMaximize}
          aria-label={maximized ? t.titlebarRestore : t.titlebarMaximize}
          onClick={() => void api.windowToggleMaximize()}
          className={studioBtn}
        >
          {maximized ? <Minimize2 className="size-3" /> : <Maximize className="size-3" />}
        </button>
        <button
          type="button"
          title={t.titlebarClose}
          aria-label={t.titlebarClose}
          onClick={() => api.windowClose()}
          className={cn(
            studioBtn,
            'hover:bg-[var(--brand-red)] hover:text-white hover:border-[var(--brand-red)]',
          )}
        >
          <X className="size-3" />
        </button>
      </div>
    </header>
  );
}
