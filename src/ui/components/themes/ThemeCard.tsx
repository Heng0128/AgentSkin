// SPDX-License-Identifier: MPL-2.0

import { useState } from 'react';
import type { UiMessages } from '@shared/i18n';
import type { ThemeCenterCardModel } from '@/types/theme-center';
import type { AgentId } from '@shared/types';
import { AppMark } from '@/components/app-mark';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function ThemeCard({
  theme,
  selected,
  activeAgentIds,
  onSelect,
  t,
}: {
  theme: ThemeCenterCardModel;
  selected: boolean;
  /** Agent IDs that currently have this theme applied. */
  activeAgentIds: AgentId[];
  onSelect: () => void;
  t: UiMessages;
}) {
  const isActive = activeAgentIds.length > 0;
  // Track image load failure via React state (not direct DOM manipulation
  // which can conflict with React's virtual DOM on re-render).
  const [imgError, setImgError] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-[var(--radius-md)] border bg-card text-left shadow-xs transition-all duration-fast ease-out',
        selected
          ? 'border-primary ring-1 ring-primary'
          : 'border-transparent hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
      )}
    >
      {/* Preview — 16:9 aspect ratio */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {theme.preview && !imgError ? (
          <img
            src={theme.preview}
            alt={theme.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : null}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-surface text-muted-foreground',
            theme.preview && !imgError ? 'hidden' : 'flex',
          )}
        >
          <span className="text-[13px] font-normal opacity-20">{theme.name.slice(0, 2)}</span>
        </div>

        {/* Active agent indicators — top-right, sharp pills */}
        {isActive && (
          <div
            role="img"
            aria-label={t.themeStatsActive(activeAgentIds.length)}
            className="absolute right-1 top-1 flex items-center gap-0 rounded-sm bg-cr-success px-1 py-0"
          >
            {activeAgentIds.map((agentId) => (
              <span
                key={agentId}
                aria-hidden="true"
                className="flex size-3 items-center justify-center rounded-sm bg-popover/90"
              >
                <AppMark appId={agentId} size={8} />
              </span>
            ))}
          </div>
        )}

        {/* Mode indicator — subtle, only when not auto */}
        {theme.mode && theme.mode !== 'auto' && (
          <span
            className={cn(
              'absolute top-1 rounded-sm px-1 py-0 text-[11px] font-normal',
              isActive ? 'left-1' : 'right-1',
              theme.mode === 'dark'
                ? 'bg-surface text-secondary'
                : 'bg-muted text-foreground',
            )}
          >
            {theme.mode === 'dark' ? t.themeModeDark : t.themeModeLight}
          </span>
        )}

        {/* Icon overlay — bottom-left */}
        {theme.icon && (
          <div className="absolute bottom-1 left-1 opacity-80 transition-opacity group-hover:opacity-100">
            <img
              src={theme.icon}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="size-6 rounded-md border border-white/10 bg-background/70 p-0.5"
            />
          </div>
        )}

        {/* Dynamic wallpaper indicator — bottom-right */}
        {theme.hasWallpaper && (
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-sm bg-surface px-1 py-0 text-micro font-normal text-muted-foreground">
            <span className="inline-flex size-1 rounded-full bg-white" />
            {t.themeDynamicBadge}
          </span>
        )}
      </div>

      {/* Info section — tight typography */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
        {/* Name — 13px medium, clean hierarchy */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[13px] font-medium leading-snug">{theme.name}</h3>
          {theme.version && (
            <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
              v{theme.version}
            </span>
          )}
        </div>

        {/* Author — 10px text-dim */}
        <div className="flex items-center gap-1 text-micro text-muted-foreground/60">
          <span className="truncate">{theme.author}</span>
          {theme.category && (
            <>
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="shrink-0">{t.categoryLabel(theme.category)}</span>
            </>
          )}
        </div>

        {/* Supported agents + tags — badges */}
        <div className="flex items-center gap-1 pt-1">
          <span aria-hidden="true" className="flex items-center gap-1">
            {theme.supportedAgents.map((agentId) => {
            const agentActive = activeAgentIds.includes(agentId);
            return (
              <span
                key={agentId}
                className={cn(
                  'flex size-4 items-center justify-center rounded-full transition-all',
                  agentActive
                    ? 'bg-cr-success/15'
                    : 'bg-muted/60',
                )}
              >
                <AppMark appId={agentId} size={12} />
              </span>
            );
          })}
          </span>
          {theme.tags.length > 0 && (
            <div className="ml-auto flex gap-1">
              {theme.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="ghost" className="rounded-md px-1.5 py-px text-[10px] font-normal text-muted-foreground">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
