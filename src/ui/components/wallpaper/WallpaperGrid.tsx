// SPDX-License-Identifier: MPL-2.0

/**
 * WallpaperGrid — 纯呈现网格列表。通过 props 接收已过滤排序的壁纸和回调。
 * 不持有任何业务状态，不发起任何 IPC / store 操作。
 */

import { useCallback } from 'react';
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
  // Stable callbacks (memoized on their deps) so a `deletingId` change only
  // re-renders the affected card — `WallpaperCard` is memoized with a shallow
  // compare, and inline closures here would defeat that memo on every grid
  // re-render. (Hooks must run before the early return below to satisfy Rules
  // of Hooks.)
  const handleSelect = useCallback((wp: WallpaperInfo) => onSelect(wp), [onSelect]);
  const handleDelete = useCallback((id: string) => onDelete(id), [onDelete]);

  if (wallpapers.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[11px] text-muted-foreground/60">
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
          onSelect={handleSelect}
          deletable={wp.source === 'local' && wp.id.startsWith('local:')}
          isDeleting={deletingId === wp.id}
          onDelete={handleDelete}
          deleteLabel={t.wallpaperDelete}
          confirmLabel={t.wallpaperDeleteConfirm}
          t={t}
        />
      ))}
    </div>
  );
}
