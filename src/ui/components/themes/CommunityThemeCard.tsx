// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityThemeCard
 *
 * Card component for a single DreamSkin community theme. Shows preview
 * (or a gradient placeholder), metadata (author, downloads, favorites),
 * tags (if any), and an install / cancel / uninstall action button.
 *
 * Selected state follows the media-large-card spec: `border-primary` +
 * `ring-2 ring-primary/30` + a Check badge in the top-right corner.
 *
 * ## API data notes
 *
 * DreamSkin API does not return `rating` or `tags` for list items, so
 * these fields are conditionally rendered only when truthy. `favoriteCount`
 * is displayed as a community engagement metric when > 0.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import { formatRelativeTime } from '@shared/intl';
import type {
  CommunityThemeSummary,
  DownloadProgress as DownloadProgressData,
} from '@shared/types/community';
import { Check, Clock, Download, Eye, Heart, ImageIcon, Star } from 'lucide-react';
import { DownloadProgress } from './DownloadProgress';

interface Props {
  theme: CommunityThemeSummary;
  /** True when this card's theme is shown in the detail panel. */
  selected?: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  downloadProgress?: DownloadProgressData;
  installError?: string | null;
  retryCount?: number;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
  className?: string;
  onClick?: () => void;
  /** Open the detail preview (Mock UI). */
  onPreview?: () => void;
  /** Triggered when the author name is clicked — opens AuthorPanel. */
  onAuthorClick?: (authorId: string) => void;
}

export function CommunityThemeCard({
  theme,
  selected = false,
  isInstalled,
  isInstalling,
  downloadProgress,
  installError = null,
  retryCount = 0,
  onInstall,
  onUninstall,
  onCancel,
  className,
  onClick,
  onPreview,
  onAuthorClick,
}: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const hasPreview = Boolean(theme.thumbUrl) && !imgError;
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const hasRating = theme.rating != null && theme.rating > 0;
  const hasTags = theme.tags != null && theme.tags.length > 0;
  const hasFavorites = theme.favoriteCount != null && theme.favoriteCount > 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-[transform,border-color,box-shadow] duration-base ease-out',
        selected
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:-translate-y-[2px] hover:border-border-strong hover:shadow-elev2',
        className,
      )}
    >
      {/* Preview area — 16:9 */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {hasPreview ? (
          <>
            {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
            <img
              src={theme.thumbUrl}
              alt={theme.name}
              className={cn(
                'size-full object-cover transition-transform duration-slower ease-out group-hover:scale-[1.03]',
                imgLoaded ? 'opacity-100' : 'opacity-0',
              )}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 bg-muted">
            <ImageIcon className="size-7 text-muted-foreground/30" strokeWidth={1.5} />
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground/50">
              {theme.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Selected badge — top-right */}
        {selected && (
          <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}

        {/* Download progress overlay */}
        {isInstalling && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-popover border border-border">
            <span className="mb-2 text-xs font-medium">
              {(downloadProgress?.progress ?? 0) < 100
                ? `${t.communityDownloading} ${downloadProgress?.progress ?? 0}%`
                : t.installing}
            </span>
            <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70 transition-all duration-slow"
                style={{ width: `${downloadProgress?.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="truncate text-sm font-medium leading-snug" title={theme.name}>
          {theme.name}
        </h3>
        <button
          type="button"
          onClick={(e) => {
            if (onAuthorClick && theme.author?.id) {
              e.stopPropagation();
              onAuthorClick(theme.author.id);
            }
          }}
          className={cn(
            'truncate text-left text-[11px] text-muted-foreground/60 transition-colors',
            onAuthorClick && theme.author?.id && 'hover:text-primary hover:underline',
          )}
          disabled={!onAuthorClick || !theme.author?.id}
          title={onAuthorClick ? t.communityCreator : undefined}
        >
          by {theme.author?.displayName ?? 'Unknown'}
        </button>

        {/* Stats — only render when data exists */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Download size={10} className="text-muted-foreground/70" />
            {theme.downloads ?? 0}
          </span>
          {hasRating && (
            <span className="inline-flex items-center gap-1">
              <Star size={10} className="text-muted-foreground/70" />
              {theme.rating.toFixed(1)}
            </span>
          )}
          {hasFavorites && (
            <span className="inline-flex items-center gap-1">
              <Heart size={10} className="text-muted-foreground/70" />
              {theme.favoriteCount}
            </span>
          )}
          {theme.updatedAt && (
            <span className="inline-flex items-center gap-1">
              <Clock size={10} className="text-muted-foreground/70" />
              {formatRelativeTime(new Date(theme.updatedAt), locale)}
            </span>
          )}
        </div>

        {/* Tags — max 3, only when tags exist */}
        {hasTags && (
          <div className="flex flex-wrap gap-1">
            {theme.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="ghost"
                className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Color preview bar — from displayMeta */}
        {theme.displayMeta?.colors && (
          <div className="mt-0.5 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
            {[
              theme.displayMeta.colors.accent,
              theme.displayMeta.colors.background,
              theme.displayMeta.colors.text,
              theme.displayMeta.colors.panel,
              theme.displayMeta.colors.secondary,
            ]
              .filter(Boolean)
              .slice(0, 5)
              .map((color, i) => (
                <div
                  key={i}
                  className="flex-1 transition-all duration-base hover:flex-[2]"
                  style={{ backgroundColor: color }}
                />
              ))}
          </div>
        )}
      </div>

      {/* Footer: preview + action button */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {onPreview && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              aria-label={t.communityPreview}
              title={t.communityPreview}
            >
              <Eye className="size-3.5" />
            </Button>
          )}
        </div>

        <div className="shrink-0">
          {isInstalled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall();
              }}
            >
              {t.installedBadge}
            </Button>
          ) : isInstalling ? (
            <div className="flex items-center gap-1.5">
              <DownloadProgress
                progress={downloadProgress?.progress ?? 0}
                bytesDownloaded={downloadProgress?.bytesDownloaded ?? 0}
                totalBytes={downloadProgress?.totalBytes ?? 0}
                showDetails={false}
                phase={downloadProgress?.phase ?? 'downloading'}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
              >
                {t.cancel}
              </Button>
            </div>
          ) : installError ? (
            <div className="flex flex-col gap-1">
              {retryCount >= 3 ? (
                <div className="rounded-md bg-muted px-2 py-1 text-center text-[11px] text-muted-foreground">
                  {t.installFailed}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInstall();
                  }}
                >
                  {t.communityRetry}
                </Button>
              )}
            </div>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-7 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                onInstall();
              }}
            >
              {t.install}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
