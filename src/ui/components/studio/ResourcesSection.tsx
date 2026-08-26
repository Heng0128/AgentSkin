// SPDX-License-Identifier: MPL-2.0

/**
 * # ResourcesSection
 *
 * Theme library + wallpapers + bundles section of the Studio drawer.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useStudioStore } from '@/stores/studioStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';

import type { UiMessages } from '@shared/i18n';
import { Image, Layers, Package, Palette } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export function ResourcesSection({ t }: { t: UiMessages }) {
  const [open, setOpen] = useState(true);
  const { installedThemes } = useStudioStore(
    useShallow((s) => ({ installedThemes: s.installedThemes })),
  );
  const wallpapers = useWallpaperStore((s) => s.wallpapers);

  return (
    <div className="ws-drawer__section">
      <button
        type="button"
        className="ws-drawer__section-header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1">
          <span className="dot" />
          {t.studioResourcesTitle}
        </span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Theme library */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <Layers className="size-3 text-muted-foreground" />
              <span className="text-micro text-muted-foreground">{t.themeLibrary}</span>
            </div>
            {installedThemes.length === 0 ? (
              <EmptyState
                icon={<Palette />}
                title={t.studioLibraryEmpty}
                iconSize="sm"
                className="pl-4"
              />
            ) : (
              <div className="flex flex-col gap-0">
                {installedThemes.map((theme) => (
                  <div
                    key={theme.id}
                    className="flex items-center gap-1 p-0 rounded-md hover:bg-muted"
                  >
                    <span
                      className="size-[10px] rounded-md border border-border"
                      style={{ background: theme.colors?.accent || 'var(--muted)' }}
                    />
                    <span className="text-micro text-foreground truncate flex-1">{theme.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wallpapers (P1 — IPC-backed list) */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <Image className="size-3 text-muted-foreground" />
              <span className="text-micro text-muted-foreground">{t.studioWallpaperAllTitle}</span>
            </div>
            {wallpapers.length === 0 ? (
              <EmptyState
                icon={<Image />}
                title={t.studioWallpaperEmpty}
                iconSize="sm"
                className="pl-4"
              />
            ) : (
              <div className="flex flex-col gap-0">
                {wallpapers.map((wp) => (
                  <div
                    key={wp.id}
                    className="flex items-center gap-1 p-0 rounded-md hover:bg-muted"
                  >
                    <Image className="size-2.5 text-muted-foreground" />
                    <span className="text-micro text-foreground truncate flex-1">
                      {wp.title ?? wp.id}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bundles */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <Package className="size-3 text-muted-foreground" />
              <span className="text-micro text-muted-foreground">{t.studioTabBundle}</span>
            </div>
            <Button variant="outline" size="sm" className="w-full h-[var(--h-btn-sm)] text-micro">
              {t.studioBundleImport}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
