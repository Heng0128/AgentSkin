// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabWallpaper
 *
 * Placeholder panel for the "Wallpaper" center tab.
 * Full implementation will allow extracting a theme from a wallpaper image.
 */

import type { UiMessages } from '@shared/i18n';

export function CenterTabWallpaper({ t }: { t: UiMessages }) {
  const desc =
    'studioTabWallpaperDesc' in t
      ? (t as unknown as Record<string, string>).studioTabWallpaperDesc
      : '从壁纸提取主题配色，生成 14-token 工程。';

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabWallpaper}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">{desc}</p>
      <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
        <p className="font-mono text-[10px] text-[var(--fg-3)]">Wallpaper → Theme（即将推出）</p>
      </div>
    </div>
  );
}
