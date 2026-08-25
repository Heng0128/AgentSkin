// SPDX-License-Identifier: MPL-2.0

import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatSize } from '@/lib/wallpaperUtils';
import { useWallpaperVideoUrl } from '@/lib/wallpaperVideo';

import type { UiMessages } from '@shared/i18n';
import type { WallpaperInfo } from '@shared/types';
import { Image, Video, X } from 'lucide-react';

export interface WallpaperCardProps {
  wallpaper: WallpaperInfo;
  index: number;
  selected: boolean;
  isUiBackground: boolean;
  previewOnly: boolean;
  deletable: boolean;
  isDeleting: boolean;
  onSelect: (wp: WallpaperInfo) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
  confirmLabel: string;
  t: UiMessages;
}

/** Renders a wallpaper preview according to its `playback` kind:
 *  - `video` — plays via `<video>`, falling back to the still preview image
 *    when the clip can't be decoded (e.g. an HEVC mp4 Chromium rejects).
 *  - `gif` — renders the media as an `<img>`, which browsers animate natively
 *    (a `<video>` element cannot play GIFs).
 *  - `image` — shows the still preview (static images).
 *  - `web` / `scene` — shows the still preview image (the workshop
 *    preview.jpg/png). The actual animated content is rendered on demand
 *    via an iframe (web) or canvas (scene) when applied to an agent — the
 *    grid card only shows a static thumbnail.
 *  When neither media nor a preview is available it shows `loadingNode` while
 *  the media URL resolves, then `emptyNode`. Key the element by wallpaper id at
 *  the call site so the failed state resets when the selection changes. */
export function WallpaperPreview({
  playback,
  mediaUrl,
  previewUrl,
  className,
  loading,
  loadingNode,
  emptyNode,
  alt,
}: {
  playback: 'video' | 'gif' | 'image' | 'web' | 'scene';
  mediaUrl: string | null;
  previewUrl: string | null;
  className: string;
  loading: boolean;
  loadingNode?: ReactNode;
  emptyNode?: ReactNode;
  /** Descriptive alt for the preview image. Omit for a purely decorative preview. */
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const onError = () => setFailed(true);
  if (playback === 'video' && mediaUrl && !failed) {
    return (
      <video
        src={mediaUrl}
        muted
        loop
        autoPlay
        playsInline
        disablePictureInPicture
        onError={onError}
        className={className}
      />
    );
  }
  if (playback === 'gif' && mediaUrl && !failed) {
    return <img src={mediaUrl} alt={alt ?? ''} onError={onError} className={className} />;
  }
  // image / web / scene: show the still preview image.
  if (previewUrl) {
    return <img src={previewUrl} alt={alt ?? ''} loading="lazy" className={className} />;
  }
  if (loading) return <>{loadingNode}</>;
  return <>{emptyNode}</>;
}

export const WallpaperCard = memo(function WallpaperCard({
  wallpaper,
  index: _index,
  selected,
  isUiBackground,
  previewOnly,
  deletable,
  isDeleting,
  onSelect,
  onDelete,
  deleteLabel,
  confirmLabel,
  t,
}: WallpaperCardProps) {
  const [confirming, setConfirming] = useState(false);
  const wantsMedia = wallpaper.playback === 'video' || wallpaper.playback === 'gif';
  // Lazy-load the streaming URL only when the card is (about to be) visible.
  // Previously every grid card resolved its loopback video URL + registered a
  // media-server token at once — a 45-wallpaper library fired 45 IPC calls and
  // minted 45 server entries on first paint, stalling the main process. The
  // IntersectionObserver gates resolution to the visible viewport (+0.15x
  // overscan), so scrolling populates cards on demand instead of all at once.
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || !wantsMedia) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '15% 0px', threshold: 0 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [wantsMedia]);
  const { url: mediaUrl, loading: mediaLoading } = useWallpaperVideoUrl(
    wantsMedia && inView ? wallpaper.id : null,
  );
  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-md border border-transparent bg-surface text-left transition-all duration-fast ease-out',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
        selected && 'ring-1 ring-primary',
      )}
    >
      <button type="button" onClick={() => onSelect(wallpaper)} className="flex flex-1 flex-col">
        {/* Preview — fixed 16:9 like Wallpaper Engine's thumbs (never stretched
            to square by row heights). */}
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <WallpaperPreview
            playback={wallpaper.playback}
            mediaUrl={mediaUrl}
            previewUrl={wallpaper.previewUrl}
            loading={mediaLoading}
            alt={wallpaper.title}
            className="size-full object-cover"
            loadingNode={
              <div className="flex size-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground/50" />
              </div>
            }
            emptyNode={
              <div className="flex size-full items-center justify-center">
                {wallpaper.type === 'video' ? (
                  <Video className="size-8 text-muted-foreground/40" />
                ) : (
                  <Image className="size-8 text-muted-foreground/40" />
                )}
              </div>
            }
          />
          {/* WE-style hover overlay — dark scrim + hint sliding up on hover */}
          <div
            className="pointer-events-none absolute inset-0 flex items-end opacity-0 transition-opacity duration-fast group-hover:opacity-100"
            aria-hidden
          >
            <div className="absolute inset-0 bg-black/40" />
            <span className="relative flex w-full items-center justify-between px-2 pb-2 text-micro text-popover-foreground/90">
              {wallpaper.type === 'video'
                ? t.weTypeVideo
                : wallpaper.type === 'image'
                  ? t.weTypeImage
                  : wallpaper.type === 'web'
                    ? t.weTypeWeb
                    : t.weTypeScene}
              <span className="tabular-nums">{formatSize(wallpaper.sizeBytes)}</span>
            </span>
          </div>
          {/* Type badge (mono) */}
          <span
            className={cn(
              'absolute bottom-1 right-1 flex items-center gap-0 rounded-sm px-1 py-0 text-micro',
              wallpaper.type === 'video'
                ? 'bg-primary text-primary-foreground'
                : wallpaper.type === 'image'
                  ? 'bg-info text-white'
                  : wallpaper.type === 'web'
                    ? 'bg-cr-success text-white'
                  : 'bg-cr-warning text-white',
            )}
          >
            {wallpaper.type === 'video' ? (
              <Video className="size-2" />
            ) : (
              <Image className="size-2" />
            )}
            {wallpaper.type === 'video'
              ? 'VID'
              : wallpaper.type === 'image'
                ? 'IMG'
                : wallpaper.type === 'web'
                  ? 'WEB'
                  : 'SCN'}
          </span>
          {/* UI background indicator  */}
          {isUiBackground && (
            <span className="absolute left-1 top-1 rounded-sm bg-primary px-1 py-0 text-micro text-primary-foreground">
              UI
            </span>
          )}
          {/* Preview-only badge (warning) */}
          {previewOnly && !isUiBackground && (
            <span className="absolute left-1 top-1 rounded-sm bg-cr-warning px-1 py-0 text-micro text-yellow-950">
              PREVIEW
            </span>
          )}
          {/* Source badge for local imports  */}
          {wallpaper.source === 'local' && (
            <span className="absolute right-1 top-1 rounded-sm bg-muted px-1 py-0 text-micro text-muted-foreground">
              LOCAL
            </span>
          )}
        </div>

        {/* Title — 13px medium, single line, size folded into hover overlay */}
        <div className="px-2 py-1.5">
          <p className="truncate text-[13px] font-medium leading-snug">{wallpaper.title}</p>
        </div>
      </button>

      {/* Delete button for local wallpapers  */}
      {deletable && (
        <div className="absolute left-1 bottom-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
          {confirming ? (
            <div className="flex items-center gap-0 rounded-md bg-card px-1 py-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(wallpaper.id);
                  setConfirming(false);
                }}
                disabled={isDeleting}
                className="rounded-sm px-1 py-0 text-micro font-normal text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {isDeleting ? '…' : confirmLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                className="rounded-sm px-1 py-0 text-micro text-muted-foreground hover:bg-muted"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              className="rounded-sm bg-surface px-1 py-0 text-micro text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              {deleteLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
