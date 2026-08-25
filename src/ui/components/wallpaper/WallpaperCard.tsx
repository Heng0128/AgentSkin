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
          {/* Hover overlay — dark scrim + type/size info */}
          <div
            className="pointer-events-none absolute inset-0 flex items-end opacity-0 transition-opacity duration-fast group-hover:opacity-100"
            aria-hidden
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <span className="relative flex w-full items-center justify-between px-2.5 pb-2 text-[10px] text-white/90">
              <span className="flex items-center gap-1">
                {wallpaper.type === 'video' ? (
                  <Video className="size-3" />
                ) : (
                  <Image className="size-3" />
                )}
                {wallpaper.type === 'video'
                  ? t.weTypeVideo
                  : wallpaper.type === 'image'
                    ? t.weTypeImage
                    : wallpaper.type === 'web'
                      ? t.weTypeWeb
                      : t.weTypeScene}
              </span>
              <span className="tabular-nums opacity-70">{formatSize(wallpaper.sizeBytes)}</span>
            </span>
          </div>
          {/* Single status badge — top-left */}
          {isUiBackground && (
            <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
              UI
            </span>
          )}
          {previewOnly && !isUiBackground && (
            <span className="absolute left-2 top-2 rounded-md bg-cr-warning/90 px-1.5 py-0.5 text-[10px] font-medium text-yellow-950 shadow-sm">
              PREVIEW
            </span>
          )}
          {/* Delete button — top-right on hover */}
          {deletable && (
            <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
              {confirming ? (
                <div className="flex items-center gap-1 rounded-md bg-card/90 p-0.5 shadow-md backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(wallpaper.id);
                      setConfirming(false);
                    }}
                    disabled={isDeleting}
                    className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {isDeleting ? '…' : confirmLabel}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirming(false);
                    }}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(true);
                  }}
                  className="flex size-6 items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="px-2.5 py-2">
          <p className="truncate text-[13px] font-medium leading-snug">{wallpaper.title}</p>
        </div>
      </button>
    </div>
  );
});
