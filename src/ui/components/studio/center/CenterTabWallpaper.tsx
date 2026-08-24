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
    <div className="rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="text-[11px] font-normal text-[var(--fg-0)]">{t.studioTabWallpaper}</h3>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--fg-2)]">{desc}</p>
      <div className="mt-4">
        <StudioImageToThemePanel t={t} />
      </div>
    </div>
  );
}
