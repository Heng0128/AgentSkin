// SPDX-License-Identifier: MPL-2.0

/**
 * SourceDetailPanel - 社区主题详情面板
 *
 * 展示选中主题的 Mock 预览、描述、作者、评分、tag 等信息，
 * 以及安装按钮。安装时显示进度条。
 *
 * 从 communityStore 读取 `selectedThemeDetail` / `selectedThemeId`，
 * 调用 installTheme / cancelInstall 完成安装流程。
 */

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import { formatDate, formatNumber } from '@shared/intl';
import type { CommunityThemeDetail } from '@shared/types/community';
import { Image as ImageIcon, Loader2, Palette, Shield, Star, X, Calendar } from 'lucide-react';
import { DownloadProgress } from './DownloadProgress';
import { CommunityThemePreview } from './CommunityThemePreview';
import { useShallow } from 'zustand/react/shallow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SourceDetailPanel() {
  const {
    selectedThemeDetail,
    selectedThemeId,
    detailLoading,
    installingIds,
    downloadProgress,
    installedIds,
    selectTheme,
    installTheme,
    cancelInstall,
    uninstallTheme,
  } = useCommunityStore(
    useShallow((s) => ({
      selectedThemeDetail: s.selectedThemeDetail,
      selectedThemeId: s.selectedThemeId,
      detailLoading: s.detailLoading,
      installingIds: s.installingIds,
      downloadProgress: s.downloadProgress,
      installedIds: s.installedIds,
      selectTheme: s.selectTheme,
      installTheme: s.installTheme,
      cancelInstall: s.cancelInstall,
      uninstallTheme: s.uninstallTheme,
    })),
  );

  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  // Loading state — theme ID selected but detail not yet fetched
  if (selectedThemeId && detailLoading && !selectedThemeDetail) {
    return (
      <aside className="flex h-full w-[320px] shrink-0 flex-col items-center justify-center border-l border-border bg-card">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {(t.communityLoading as string) ?? (t.loading as string) ?? 'Loading…'}
        </p>
      </aside>
    );
  }

  // Nothing selected — render EmptyState so standalone usage still has a placeholder
  if (!selectedThemeDetail || !selectedThemeId) {
    return (
      <aside
        data-empty="true"
        className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card"
      >
        <EmptyState
          icon={<ImageIcon className="text-muted-foreground/50" />}
          title={(t.communityNoSelectTitle as string) ?? 'No theme selected'}
          hint={(t.communitySelectThemeHint as string) ?? 'Select a theme from the list'}
          iconSize="lg"
          className="h-full"
        />
      </aside>
    );
  }

  const theme = selectedThemeDetail;
  const isInstalling = installingIds.has(selectedThemeId);
  const isInstalled = installedIds.has(selectedThemeId);
  const progress = downloadProgress.get(selectedThemeId);
  const previewUrl = theme.screenshots?.[0] ?? theme.thumbUrl;
  const displayMeta = theme.displayMeta;

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Preview image (top) */}
      {previewUrl && (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted">
          <img
            src={previewUrl}
            alt={theme.name}
            className="size-full object-cover"
            loading="lazy"
          />
          <button
            type="button"
            onClick={() => selectTheme(null)}
            aria-label={t.close ?? 'Close'}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Header (when no preview image) */}
      {!previewUrl && (
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold tracking-tight">{theme.name}</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              by {theme.author?.displayName ?? 'Unknown'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => selectTheme(null)}
            aria-label={t.close ?? 'Close'}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Title row */}
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{theme.name}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            by {theme.author?.displayName ?? 'Unknown'}
          </p>
        </div>

        {/* Mock UI preview */}
        {displayMeta?.colors ? (
          <CommunityThemePreview colors={displayMeta.colors} t={t} />
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground/60">
            <Palette size={24} strokeWidth={1.5} />
            <p className="mt-2 text-[11px]">{t.communityNoColors ?? 'No color data'}</p>
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {theme.version && (
            <span className="inline-flex items-center gap-1">
              v{theme.version}
            </span>
          )}
          {theme.license && (
            <span className="inline-flex items-center gap-1">
              <Shield size={11} className="text-muted-foreground/60" />
              {theme.license}
            </span>
          )}
          {theme.downloads > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={11} className="text-muted-foreground/60" />
              {formatNumber(theme.downloads, locale)}
            </span>
          )}
          {theme.rating != null && theme.rating > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={11} className="text-muted-foreground/60" />
              {theme.rating.toFixed(1)}
            </span>
          )}
          {theme.updatedAt && (
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} className="text-muted-foreground/60" />
              {formatDate(new Date(theme.updatedAt), locale)}
            </span>
          )}
        </div>

        {/* Tags — conditionally rendered (DreamSkin API does not return tags) */}
        {theme.tags && theme.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {theme.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {theme.description && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{theme.description}</p>
        )}

        {/* Download progress area */}
        {isInstalling && progress && (
          <DownloadProgress
            progress={progress.progress}
            bytesDownloaded={progress.bytesDownloaded}
            totalBytes={progress.totalBytes}
            showDetails
            phase={progress.phase}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => selectTheme(null)}>
          {t.close ?? 'Close'}
        </Button>
        {isInstalled ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void uninstallTheme(selectedThemeId)}
          >
            {t.installedBadge ?? 'Installed'}
          </Button>
        ) : isInstalling ? (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => void cancelInstall(selectedThemeId)}
          >
            {t.cancel ?? 'Cancel'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={() => void installTheme(selectedThemeId)}
          >
            {t.install ?? 'Install'}
          </Button>
        )}
      </div>
    </aside>
  );
}
