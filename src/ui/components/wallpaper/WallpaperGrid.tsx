// SPDX-License-Identifier: MPL-2.0

/**
 * WallpaperGrid — 纯呈现网格列表。通过 props 接收已过滤排序的壁纸和回调。
 * 不持有任何业务状态，不发起任何 IPC / store 操作。
 */

import { cn } from '@/lib/utils';
import { gridClass } from '@/lib/wallpaperUtils';

import type { UiMessages } from '@shared/i18n';
import type { WallpaperInfo } from '@shared/types';
import { WallpaperCard } from './WallpaperCard';

export interface WallpaperGridProps {
  wallpapers: WallpaperInfo[];
  selectedId: string | null;
  isUiBackground: (wp: WallpaperInfo) => boolean;
  t: UiMessages;
  onSelect: (wp: WallpaperInfo) => void;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onEmptyNode: React.ReactNode;
}

export function WallpaperGrid({
  wallpapers,
  selectedId,
  isUiBackground,
  t,
  onSelect,
  deletingId,
  onDelete,
  onEmptyNode,
}: WallpaperGridProps) {
  if (wallpapers.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center font-mono text-[11px] tracking-wider text-muted-foreground/60">
        {onEmptyNode}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-2', gridClass(wallpapers.length))}>
      {wallpapers.map((wp, i) => (
        <WallpaperCard
          key={wp.id}
          wallpaper={wp}
          index={i}
          selected={selectedId === wp.id}
          isUiBackground={isUiBackground(wp)}
          previewOnly={wp.previewOnly}
          onSelect={() => onSelect(wp)}
          deletable={wp.source === 'local' && wp.id.startsWith('local:')}
          isDeleting={deletingId === wp.id}
          onDelete={() => onDelete(wp.id)}
          deleteLabel={t.wallpaperDelete}
          confirmLabel={t.wallpaperDeleteConfirm}
          t={t}
        />
      ))}
    </div>
  );
}
