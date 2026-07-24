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
        'group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-xs transition-all duration-300 ease-out',
        selected
          ? 'border-primary/50 ring-2 ring-primary/20 shadow-md'
          : 'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/[0.04]',
      )}
    >
      {/* Preview — clean overlay with minimal badges */}
      <div className="relative aspect-[1.6/1] w-full overflow-hidden bg-muted">
        {theme.preview ? (
          <img
            src={theme.preview}
            alt={theme.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-accent text-muted-foreground transition-opacity',
            theme.preview ? 'hidden' : 'flex',
          )}
        >
          <span className="text-lg font-medium opacity-30">{theme.name.slice(0, 2)}</span>
        </div>

        {/* Active agent indicators — show which agents have this theme applied */}
        {isActive && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 shadow-sm backdrop-blur-sm">
            {activeAgentIds.map((agentId) => (
              <span key={agentId} className="flex size-3.5 items-center justify-center rounded-full bg-white/90">
                <AppMark appId={agentId} size={10} />
              </span>
            ))}
          </div>
        )}

        {/* Mode indicator — subtle dot + label, only when not auto */}
        {theme.mode && theme.mode !== 'auto' && (
          <span
            className={cn(
              'absolute top-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm',
              isActive ? 'left-2' : 'right-2',
              theme.mode === 'dark'
                ? 'bg-slate-900/70 text-slate-300'
                : 'bg-amber-50/80 text-amber-800',
            )}
          >
            {theme.mode === 'dark' ? t.themeModeDark : t.themeModeLight}
          </span>
        )}

        {/* Icon overlay — bottom-left, subtle */}
        {theme.icon && (
          <div className="absolute bottom-2 left-2 opacity-90 transition-opacity group-hover:opacity-100">
            <img
              src={theme.icon}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="size-7 rounded-md border border-white/20 bg-background/80 p-0.5 shadow-sm backdrop-blur-sm"
            />
          </div>
        )}

        {/* Dynamic wallpaper indicator — bottom-right */}
        {theme.hasWallpaper && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-violet-500/80 px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm backdrop-blur-sm">
            <span className="relative flex size-1">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/60" />
              <span className="relative inline-flex size-1 rounded-full bg-white" />
            </span>
            {t.themeDynamicBadge}
          </span>
        )}

        {/* Hover gradient — subtle bottom fade for depth */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>

      {/* Info section — cleaner hierarchy */}
      <div className="flex flex-col gap-1.5 p-3">
        {/* Name + version */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em]">{theme.name}</h3>
          {theme.version && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
              v{theme.version}
            </span>
          )}
        </div>

        {/* Author + category */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{theme.author}</span>
          {theme.category && (
            <>
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="shrink-0">{t.categoryLabel(theme.category)}</span>
            </>
          )}
          {theme.source !== 'local' && (
            <>
              <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="shrink-0 text-primary/60">{t.sourceCommunity}</span>
            </>
          )}
        </div>

        {/* Supported agents + tags */}
        <div className="flex items-center gap-1 pt-0.5">
          {theme.supportedAgents.map((agentId) => {
            const agentActive = activeAgentIds.includes(agentId as never);
            return (
              <span
                key={agentId}
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full transition-all',
                  agentActive
                    ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40'
                    : '',
                )}
              >
                <AppMark appId={agentId as never} size={15} />
              </span>
            );
          })}
          {theme.tags.length > 0 && (
            <div className="ml-auto flex gap-1">
              {theme.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="rounded-md px-1.5 py-0 text-[9px] font-normal">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
