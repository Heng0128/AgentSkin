// SPDX-License-Identifier: MPL-2.0

/**
 * # AuthorPanel
 *
 * Slide-over panel that aggregates a community creator's themes. Shown when
 * the user clicks an author name on a CommunityThemeCard.
 *
 * Layout:
 *   Header: avatar initial, name, theme count, total downloads
 *   Scrollable grid: theme thumbnails with name + downloads on hover
 *
 * The panel is mutually exclusive with SourceDetailPanel — selecting a theme
 * from this panel jumps to the theme's detail panel.
 */

import { Badge } from '@/components/ui/badge';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';
import type { CommunityThemeSummary } from '@shared/types/community';
import { formatRelativeTime } from '@shared/intl';
import { uiMessages } from '@shared/i18n';
import { ImageIcon, X } from 'lucide-react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

interface AuthorPanelProps {
  authorId: string;
  onClose: () => void;
  onSelectTheme: (themeId: string) => void;
}

export function AuthorPanel({ authorId, onClose, onSelectTheme }: AuthorPanelProps) {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const { themes, selectTheme } = useCommunityStore(
    useShallow((s) => ({
      themes: s.themes,
      selectTheme: s.selectTheme,
    })),
  );

  const authorThemes = useMemo(
    () => themes.filter((theme) => theme.author?.id === authorId),
    [themes, authorId],
  );

  const authorName = authorThemes[0]?.author?.displayName ?? 'Unknown';
  const totalDownloads = authorThemes.reduce((sum, th) => sum + (th.downloads ?? 0), 0);

  const handleThemeClick = (theme: CommunityThemeSummary) => {
    selectTheme(theme.themeId);
    onSelectTheme(theme.themeId);
  };

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border p-4">
        {/* Avatar — image if available, otherwise initial */}
        {authorThemes[0]?.author?.avatarUrl ? (
          <img
            src={authorThemes[0].author.avatarUrl}
            alt={authorName}
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {authorName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{authorName}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t.communityCreator as string}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <Badge variant="secondary" className="rounded-md px-1.5 py-0.5 text-[10px]">
              {(t.communityAuthorThemes as (n: number) => string)(authorThemes.length)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {(t.communityAuthorDownloads as (n: number) => string)(totalDownloads)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close ?? 'Close'}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Theme grid */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {authorThemes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
            {(t.communityAuthorAllThemes as string) ?? 'No themes'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {authorThemes.map((theme) => (
              <button
                key={theme.themeId}
                type="button"
                onClick={() => handleThemeClick(theme)}
                className="group flex flex-col overflow-hidden rounded-md border border-border text-left transition-all hover:border-primary/50 hover:shadow-sm"
              >
                {/* Thumbnail */}
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                  {theme.thumbUrl ? (
                    <img
                      src={theme.thumbUrl}
                      alt={theme.name}
                      className="size-full object-cover transition-transform duration-base group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <ImageIcon className="size-5 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="flex flex-col gap-0.5 p-1.5">
                  <span className="truncate text-[11px] font-medium leading-tight">{theme.name}</span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>↓{theme.downloads}</span>
                    {theme.updatedAt && (
                      <span>· {formatRelativeTime(new Date(theme.updatedAt), locale)}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
