// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityThemeCard
 *
 * Card component for a single DreamSkin community theme. Shows preview
 * (or a gradient placeholder), metadata (author, downloads, favorites),
 * tags, and an install / cancel / uninstall action button.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import type { CommunityThemeSummary, DownloadProgress as DownloadProgressData } from '@shared/types/community';
import { ImageIcon } from 'lucide-react';
import { DownloadProgress } from './DownloadProgress';

interface Props {
  theme: CommunityThemeSummary;
  isInstalled: boolean;
  isInstalling: boolean;
  downloadProgress?: DownloadProgressData;
  installError?: string | null;
  retryCount?: number;
  onInstall: () => void;
  onUninstall: () => void;
  onCancel: () => void;
}

export function CommunityThemeCard({
  theme,
  isInstalled,
  isInstalling,
  downloadProgress,
  installError = null,
  retryCount = 0,
  onInstall,
  onUninstall,
  onCancel,
}: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const hasPreview = Boolean(theme.thumbUrl) && !imgError;
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md">
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
          <div className="flex size-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10">
            <ImageIcon className="size-8 text-muted-foreground/30" strokeWidth={1.5} />
            <span className="text-[14px] font-semibold text-muted-foreground/50">
              {theme.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Download progress overlay */}
        {isInstalling && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white backdrop-blur-sm">
            <span className="mb-2 text-[13px] font-medium">
              {(downloadProgress?.progress ?? 0) < 100
                ? `${locale === 'zh-CN' ? '下载中' : 'Downloading'} ${downloadProgress?.progress ?? 0}%`
                : t.installing}
            </span>
            <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${downloadProgress?.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="truncate text-[13px] font-medium leading-snug" title={theme.name}>
          {theme.name}
        </h3>
        <p className="truncate text-[10px] text-muted-foreground/60">
          by {theme.author?.displayName ?? 'Unknown'}
        </p>

        {/* Stats */}
        <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>↓ {theme.downloads ?? 0}</span>
          <span>★ {theme.rating?.toFixed(1) ?? '0.0'}</span>
        </div>

        {/* Tags — max 3 */}
        {theme.tags?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {theme.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Color preview bar */}
        {theme.displayMeta?.colors && (
          <div className="mt-1.5 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
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
                  className="flex-1 transition-all duration-200 hover:flex-[2]"
                  style={{ backgroundColor: color }}
                />
              ))}
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="border-t border-border p-2">
        {isInstalled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={onUninstall}
          >
            {t.installedBadge}
          </Button>
        ) : isInstalling ? (
          <div className="flex flex-col gap-1">
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
              className="w-full text-[10px]"
              onClick={onCancel}
            >
              {t.cancel}
            </Button>
          </div>
        ) : installError ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-2 py-1">
              <span className="truncate text-[10px] text-destructive" title={installError}>
                {installError}
              </span>
            </div>
            {retryCount >= 3 ? (
              <div className="w-full rounded-md bg-muted px-3 py-1.5 text-center text-[10px] text-muted-foreground">
                {t.installFailed}
              </div>
            ) : (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-full text-[11px]"
                onClick={onInstall}
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
            className="w-full text-[11px]"
            onClick={onInstall}
          >
            {t.install}
          </Button>
        )}
      </div>
    </div>
  );
}
