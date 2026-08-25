// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabWallpaper
 *
 * Wallpaper → Theme panel for the Studio center tab.
 * Composes StudioImageToThemePanel which provides the full
 * drag-and-drop upload → 14-token extraction → apply workflow.
 */

import type { UiMessages } from '@shared/i18n';
import { StudioImageToThemePanel } from '../StudioImageToThemePanel';

export function CenterTabWallpaper({ t }: { t: UiMessages }) {
  const desc = t.studioTabWallpaperDesc;

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h3 className="text-[11px] font-normal text-foreground">{t.studioTabWallpaper}</h3>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{desc}</p>
      <div className="mt-4">
        <StudioImageToThemePanel t={t} />
      </div>
    </div>
  );
}
