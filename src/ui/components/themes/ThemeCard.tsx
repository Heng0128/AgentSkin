// SPDX-License-Identifier: MPL-2.0

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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-[2px] border border-border bg-card text-left transition-all duration-slow ease-out',
        selected
          ? 'border-primary/60 ring-1 ring-primary/30'
          : 'hover:border-border-strong hover:-translate-y-[3px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]',
      )}
    >
      {/* Preview — 16:9 aspect ratio */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {theme.preview ? (
          <img
            src={theme.preview}
            alt={theme.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-slower ease-out group-hover:scale-[1.02]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/8 via-muted to-card text-muted-foreground',
            theme.preview ? 'hidden' : 'flex',
          )}
        >
          <span className="text-sm font-medium opacity-20">{theme.name.slice(0, 2)}</span>
        </div>

        {/* Active agent indicators — top-right, Swiss sharp pills */}
        {isActive && (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-[2px] bg-cr-success/90 px-1 py-0.5">
            {activeAgentIds.map((agentId) => (
              <span key={agentId} className="flex size-3 items-center justify-center rounded-[1px] bg-white/90">
                <AppMark appId={agentId} size={8} />
              </span>
            ))}
          </div>
        )}

        {/* Mode indicator — subtle, only when not auto */}
        {theme.mode && theme.mode !== 'auto' && (
          <span
            className={cn(
              'absolute top-1.5 rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider',
              isActive ? 'left-1.5' : 'right-1.5',
              theme.mode === 'dark'
                ? 'bg-gray-900/80 text-gray-300'
                : 'bg-amber-50/90 text-amber-900',
            )}
          >
            {theme.mode === 'dark' ? t.themeModeDark : t.themeModeLight}
          </span>
        )}

        {/* Icon overlay — bottom-left */}
        {theme.icon && (
          <div className="absolute bottom-1.5 left-1.5 opacity-80 transition-opacity group-hover:opacity-100">
            <img
              src={theme.icon}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="size-6 rounded-[2px] border border-white/10 bg-background/70 p-0.5"
            />
          </div>
        )}

        {/* Dynamic wallpaper indicator — bottom-right */}
        {theme.hasWallpaper && (
          <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-[2px] bg-violet-500/80 px-1 py-0.5 font-mono text-[9px] font-medium text-white">
            <span className="relative flex size-1">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/60" />
              <span className="relative inline-flex size-1 rounded-full bg-white" />
            </span>
            {t.themeDynamicBadge}
          </span>
        )}
      </div>

      {/* Info section — tight Swiss typography */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
        {/* Name — font-medium, Swiss clean */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[12px] font-medium tracking-[-0.01em]">{theme.name}</h3>
          {theme.version && (
            <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/50">
              v{theme.version}
            </span>
          )}
        </div>

        {/* Author — font-mono 10px text-dim */}
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
          <span className="truncate">{theme.author}</span>
          {theme.category && (
            <>
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="shrink-0">{t.categoryLabel(theme.category)}</span>
            </>
          )}
        </div>

        {/* Supported agents + tags — Swiss badges */}
        <div className="flex items-center gap-1 pt-0.5">
          {theme.supportedAgents.map((agentId) => {
            const agentActive = activeAgentIds.includes(agentId);
            return (
              <span
                key={agentId}
                className={cn(
                  'flex size-[16px] items-center justify-center rounded-[2px] transition-all',
                  agentActive
                    ? 'bg-cr-success/15 ring-1 ring-cr-success/30'
                    : 'ring-1 ring-border',
                )}
              >
                <AppMark appId={agentId} size={13} />
              </span>
            );
          })}
          {theme.tags.length > 0 && (
            <div className="ml-auto flex gap-0.5">
              {theme.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="rounded-[2px] px-1 py-0 font-mono text-[9.5px] font-medium uppercase tracking-wider">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
