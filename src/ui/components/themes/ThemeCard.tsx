// SPDX-License-Identifier: MPL-2.0

import { useState } from 'react';
import type { UiMessages } from '@shared/i18n';
import type { ThemeCenterCardModel } from '@/types/theme-center';
import type { AgentId } from '@shared/types';
import { AppMark } from '@/components/AppMark';
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
  const [iconError, setIconError] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-all duration-fast ease-out',
        selected
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
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
            className="size-full object-cover transition-transform duration-slower ease-out group-hover:scale-[1.04]"
            onError={() => setImgError(true)}
          />
        ) : null}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-surface text-muted-foreground',
            theme.preview && !imgError ? 'hidden' : 'flex',
          )}
        >
          <span className="text-[16px] font-bold opacity-10">{theme.name.slice(0, 2)}</span>
        </div>

        {/* Gradient overlay on hover */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-fast group-hover:opacity-100" />

        {/* Active agent indicators — top-right */}
        {isActive && (
          <div
            role="img"
            aria-label={t.themeStatsActive(activeAgentIds.length)}
            className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-cr-success/90 px-1.5 py-0.5 shadow-sm backdrop-blur-sm"
          >
            {activeAgentIds.map((agentId) => (
              <span
                key={agentId}
                aria-hidden="true"
                className="flex size-4 items-center justify-center rounded-sm bg-popover/90"
              >
                <AppMark appId={agentId} size={10} />
              </span>
            ))}
          </div>
        )}

        {/* Mode indicator — subtle, only when not auto */}
        {theme.mode && theme.mode !== 'auto' && (
          <span
            className={cn(
              'absolute top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm',
              isActive ? 'left-2' : 'right-2',
              theme.mode === 'dark'
                ? 'bg-surface/80 text-secondary-foreground'
                : 'bg-muted/80 text-foreground',
            )}
          >
            {theme.mode === 'dark' ? t.themeModeDark : t.themeModeLight}
          </span>
        )}

        {/* Icon overlay — bottom-left */}
        {theme.icon && !iconError && (
          <div className="absolute bottom-2 left-2 opacity-0 transition-all duration-fast group-hover:opacity-100">
            <img
              src={theme.icon}
              alt=""
              onError={() => setIconError(true)}
              className="size-7 rounded-lg border border-white/10 bg-background/80 p-1 shadow-sm backdrop-blur-sm"
            />
          </div>
        )}

        {/* Dynamic wallpaper indicator — bottom-right */}
        {theme.hasWallpaper && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-surface/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            <span className="inline-flex size-1 rounded-full bg-primary" />
            {t.themeDynamicBadge}
          </span>
        )}
      </div>

      {/* Info section */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3.5">
        {/* Name + version */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold leading-snug">{theme.name}</h3>
          {theme.version && (
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              v{theme.version}
            </span>
          )}
        </div>

        {/* Author + category */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{theme.author}</span>
          {theme.category && (
            <>
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="shrink-0">{t.categoryLabel(theme.category)}</span>
            </>
          )}
        </div>

        {/* Supported agents + tags — separated with spacing */}
        <div className="flex items-center justify-between gap-2 pt-1.5">
          <span aria-hidden="true" className="flex items-center gap-1">
            {theme.supportedAgents.map((agentId) => {
              const agentActive = activeAgentIds.includes(agentId);
              return (
                <span
                  key={agentId}
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full transition-all',
                    agentActive
                      ? 'bg-cr-success/15 ring-1 ring-cr-success/30'
                      : 'bg-muted',
                  )}
                >
                  <AppMark appId={agentId} size={12} />
                </span>
              );
            })}
          </span>
          {theme.tags.length > 0 && (
            <div className="flex gap-1">
              {theme.tags.slice(0, 2).map((tag) => (
                <Badge
                  key={tag}
                  variant="ghost"
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
