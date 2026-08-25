// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeDetailPanel
 *
 * Slide-in detail panel for a DreamSkin community theme. Displays the theme
 * name, author, version, license, color swatches, description, download stats,
 * and an install action. Renders as a fixed overlay with a right-side slide-in
 * animation.
 */

import type { CommunityTheme } from '@shared/types/community';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import {
  Calendar,
  Download,
  FileArchive,
  Hash,
  Palette,
  Shield,
  Star,
  X,
} from 'lucide-react';

interface ThemeDetailPanelProps {
  /** 主题数据 */
  theme: CommunityTheme;
  /** 关闭面板的回调 */
  onClose: () => void;
  /** 安装/下载按钮点击回调 */
  onInstall?: () => void;
  /** 是否正在安装 */
  isInstalling?: boolean;
}

/** Format byte size into a human-readable string. */
function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Color swatch grid — one pill per color in displayMeta.colors. */
function ColorSwatches({ colors }: { colors: Record<string, string | undefined> }) {
  const entries = Object.entries.colors).filter(([, v]) => Boolean(v));
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
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

export function ThemeDetailPanel({
  theme,
  onClose,
  onInstall,
  isInstalling = false,
}: ThemeDetailPanelProps) {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const colors = theme.displayMeta?.colors ?? {};

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)]" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-foreground/5 transition-opacity duration-fast data-starting-style:opacity-0"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — slides in from the right */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-popover shadow-md transition-transform duration-base ease-in-out sm:max-w-sm',
          'data-starting-style:translate-x-[2.5rem] data-ending-style:translate-x-[2.5rem]',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-normal tracking-[-0.015em]">
              {theme.name}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              by {theme.author?.displayName ?? 'Unknown'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-[background-color,color] duration-fast hover:bg-muted hover:text-foreground"
            aria-label={t.close}
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Version + license row */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
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

          {/* Color swatches */}
          {Object.keys(colors).length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Palette size={12} />
                颜色
              </p>
              <ColorSwatches colors={colors} />
            </div>
          )}

          {/* Description */}
          {theme.description && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {theme.description}
            </p>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Download size={12} className="text-muted-foreground/60" />
              <span className="text-[11px] font-normal">{theme.downloads ?? 0}</span>
              <span className="text-[10px] text-muted-foreground/70">下载</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Star size={12} className="text-muted-foreground/60" />
              <span className="text-[11px] font-normal">{theme.rating?.toFixed(1) ?? '0.0'}</span>
              <span className="text-[10px] text-muted-foreground/70">评分</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileArchive size={12} className="text-muted-foreground/60" />
              <span className="text-[11px] font-normal">{formatSize(theme.packageSize)}</span>
              <span className="text-[10px] text-muted-foreground/70">大小</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar size={12} className="text-muted-foreground/60" />
              <span className="text-[11px] font-normal">
                {theme.updatedAt ? new Date(theme.updatedAt).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>

          {/* Tags */}
          {theme.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
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
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex h-[30px] flex-1 items-center justify-center rounded-sm border border-border bg-card2 px-3.5 text-[10px] font-normal transition-[background-color,color] duration-fast hover:border-primary hover:text-primary"
          >
            {t.close}
          </button>
          {onInstall && (
            <button
              type="button"
              onClick={onInstall}
              disabled={isInstalling}
              className="flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-sm border border-primary bg-primary px-3.5 text-[10px] font-normal text-primary-foreground transition-[background-color] duration-fast hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isInstalling ? t.installing : t.install}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
