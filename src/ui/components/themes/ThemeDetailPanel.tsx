// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeDetailPanel
 *
 * Slide-in detail panel for a DreamSkin community theme. Matches the visual
 * language of the installed-theme DetailPanel sidebar: 400px width, top
 * preview, metadata grid, color swatches, description, tags, install action.
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import type { CommunityTheme } from '@shared/types/community';
import {
  Calendar,
  Download,
  FileArchive,
  Hash,
  Image as ImageIcon,
  Palette,
  Shield,
  Star,
  X,
} from 'lucide-react';

interface ThemeDetailPanelProps {
  theme: CommunityTheme;
  onClose: () => void;
  onInstall?: () => void;
  isInstalling?: boolean;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ColorSwatches({ colors }: { colors: Record<string, string | undefined> }) {
  const entries = Object.entries(colors).filter(([, v]) => Boolean(v));
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1"
        >
          <span
            className="size-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
          <span className="text-[10px] text-muted-foreground">{key}</span>
        </div>
      ))}
    </div>
  );
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} className="shrink-0 text-muted-foreground/60" />
      <span className="text-[12px] font-medium tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground/70">{label}</span>
    </div>
  );
}

export function ThemeDetailPanel({
  theme,
  onClose,
  onInstall,
  isInstalling = false,
}: ThemeDetailPanelProps) {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const colors = theme.displayMeta?.colors ?? {};
  const previewUrl = theme.screenshots?.[0] ?? theme.thumbUrl;

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)]" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t.close}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={cn(
          'absolute top-0 right-0 flex max-h-[90vh] w-[400px] flex-col border-l border-border bg-card shadow-lg',
          'animate-slide-in-right',
        )}
      >
        {/* Preview */}
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
              onClick={onClose}
              aria-label={t.close}
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background/60 backdrop-blur-sm transition-colors hover:bg-background/80"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Header (when no preview) */}
        {!previewUrl && (
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[16px] font-semibold tracking-tight">{theme.name}</h2>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                by {theme.author?.displayName ?? 'Unknown'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t.close}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Title (when preview shown) */}
          {previewUrl && (
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">{theme.name}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                by {theme.author?.displayName ?? 'Unknown'}
              </p>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Hash size={12} className="text-muted-foreground/60" />
              {t.versionLabel(theme.version)}
            </span>
            {'license' in theme && (theme as { license?: string }).license && (
              <span className="inline-flex items-center gap-1">
                <Shield size={12} className="text-muted-foreground/60" />
                {(theme as { license?: string }).license}
              </span>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <MetaItem icon={Download} label={t.downloads} value={String(theme.downloads ?? 0)} />
            <MetaItem icon={Star} label={t.rating} value={theme.rating?.toFixed(1) ?? '0.0'} />
            <MetaItem icon={FileArchive} label={t.size} value={formatSize(theme.packageSize)} />
            <MetaItem
              icon={Calendar}
              label={t.updated}
              value={theme.updatedAt ? new Date(theme.updatedAt).toLocaleDateString() : '—'}
            />
          </div>

          {/* Color swatches */}
          {Object.keys(colors).length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <Palette size={12} />
                {t.colors}
              </p>
              <ColorSwatches colors={colors} />
            </div>
          )}

          {/* Description */}
          {theme.description && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">{theme.description}</p>
          )}

          {/* Tags */}
          {theme.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {theme.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Screenshots count */}
          {theme.screenshots?.length > 1 && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <ImageIcon size={11} />
              {theme.screenshots.length} {t.screenshots}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border p-3">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>
            {t.close}
          </Button>
          {onInstall && (
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? t.installing : t.install}
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
