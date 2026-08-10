// SPDX-License-Identifier: MPL-2.0

/**
 * # PresetThemePicker
 *
 * Visual preset-theme gallery for the AgentSkin Theme Studio Workbench.
 * Browses the installed theme library with:
 *
 *   - Search by name / category / tag
 *   - Mode filter pills (All / Dark / Light)
 *   - Color-swatch preview cards inspired by HeiGe's 12-preset grid and
 *     WorkBuddy's curated anime-theme visual picker
 *   - Two actions per card:
 *       · APPLY  — install + inject theme to the active agent via CDP
 *       · LOAD   — import the theme's semantic colors into the Studio
 *                  palette (Toolbox overrides) for further tweaking
 *
 * Designed as a right-rail panel in the THEME tab, complementing the
 * ImageToThemePanel (image → palette) and Toolbox panels below it.
 *
 * Swiss/International: #141418 base, #FF453A accent, rounded-[2px],
 * Space Grotesk display + IBM Plex Mono mono.
 */

import { useCallback, useMemo, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/stores/notificationStore';

import {
  Add01Icon,
  AiMagicIcon,
  CheckIcon,
  PaintBrushIcon,
  RefreshIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import type { AgentId, ApplyRequest, ThemeCatalogItem } from '@shared/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PresetThemePickerProps {
  /** i18n messages object. */
  t: UiMessages;
  /** Currently selected agent — APPLY injects the theme into this agent. */
  activeAgent: AgentId | null;
  /** Installed themes (from `catalog.themes.list()`). */
  themes: ThemeCatalogItem[];
  /** Fires after a theme's palette is loaded into the Studio editor. */
  onPaletteLoaded: (palette: Record<string, string>) => void;
  /** Refresh the theme list (re-fetch from catalog). */
  onRefresh: () => void;
}

type ModeFilter = 'all' | 'dark' | 'light';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract up to N representative swatches from a ThemeCatalogItem.colors. */
function swatchesFromTheme(theme: ThemeCatalogItem, n = 4): string[] {
  const priority = ['accent', 'primary', 'background', 'surface', 'foreground', 'muted'];
  const out: string[] = [];
  const colors = theme.colors ?? {};
  const push = (v: string) => {
    if (v) out.push(v);
  };
  for (const key of priority) push(colors[key]);
  if (out.length >= n) return out.slice(0, n);
  for (const [k, v] of Object.entries(colors)) {
    if (priority.includes(k)) continue;
    push(v);
    if (out.length >= n) return out.slice(0, n);
  }
  return out.slice(0, n);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetThemePicker({
  t,
  activeAgent,
  themes,
  onPaletteLoaded,
  onRefresh,
}: PresetThemePickerProps) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);

  // --- Search + mode filter ---
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return themes.filter((t) => {
      // Mode filter
      if (modeFilter === 'dark' && t.mode === 'light') return false;
      if (modeFilter === 'light' && t.mode === 'dark') return false;
      // Search (name, category, tags)
      if (!q) return true;
      const hay = [t.name, t.category, ...(t.tags ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [themes, search, modeFilter]);

  // --- Load palette into Studio ---
  const handleLoad = useCallback(
    (theme: ThemeCatalogItem) => {
      const palette = semanticColorsToPalette(theme.colors as Record<string, unknown>);
      if (Object.keys(palette).length === 0) {
        showToast(t.studioPresetNoPalette(theme.name), 'destructive');
        return;
      }
      onPaletteLoaded(palette);
      showToast(t.studioPresetPaletteLoaded(theme.name));
    },
    [t, onPaletteLoaded, showToast],
  );

  // --- Apply theme to active agent ---
  const handleApply = useCallback(
    async (theme: ThemeCatalogItem) => {
      if (!activeAgent) {
        showToast(t.studioPresetSelectAgentFirst, 'destructive');
        return;
      }
      setBusy(theme.id);
      try {
        const request: ApplyRequest = { themeId: theme.id, appId: activeAgent };
        const res = await api.applyTheme(request);
        if (res.status === 'applied') {
          showToast(t.studioPresetApplied(theme.name, activeAgent));
        } else if (res.status === 'requires-restart') {
          showToast(t.studioPresetQueued(theme.name, activeAgent));
        }
      } catch (e) {
        showToast(t.studioPresetApplyFailed(toMessage(e)), 'destructive');
      } finally {
        setBusy(null);
      }
    },
    [t, activeAgent, showToast],
  );

  return (
    <div className="space-y-2">
      {/* Header kicker */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="size-[3px] rounded-full" style={{ background: 'var(--primary)' }} />
          <span
            className="font-mono text-[9.5px] font-semibold uppercase"
            style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}
          >
            {t.studioPresetTitle}
          </span>
          <span
            className="ml-1 rounded-[2px] border border-white/[0.08] px-1 font-mono text-[9.5px] text-white/30"
            style={{ letterSpacing: '0.05em' }}
          >
            {filtered.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-5 items-center gap-1 border border-border px-1.5 font-mono text-[10px] uppercase transition-colors hover:bg-accent"
          style={{ letterSpacing: '0.06em', borderRadius: '2px', color: 'var(--muted-foreground)' }}
        >
          <HugeIcon icon={RefreshIcon} className="size-2.5" />
          {t.studioPresetRefresh}
        </button>
      </div>

      {/* Search input */}
      <div className="flex items-center gap-1.5 border border-border bg-card px-1.5">
        <HugeIcon
          icon={Search01Icon}
          className="size-2.5 shrink-0"
          style={{ color: 'var(--muted-foreground)' }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.studioPresetSearchPlaceholder}
          className="h-5 flex-1 bg-transparent font-mono text-[10px] outline-none placeholder:text-white/20"
          style={{ color: 'var(--foreground)' }}
        />
      </div>

      {/* Mode filter pills */}
      <div className="inline-flex gap-[3px] rounded-[2px] bg-muted p-[2px]">
        {(['all', 'dark', 'light'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModeFilter(m)}
            className="h-[18px] px-2 font-mono text-[9.5px] font-semibold uppercase"
            style={{
              letterSpacing: '0.1em',
              borderRadius: '1px',
              color: modeFilter === m ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              background: modeFilter === m ? 'var(--primary)' : 'transparent',
            }}
          >
            {m === 'all' ? 'ALL' : m === 'dark' ? 'DARK' : 'LIGHT'}
          </button>
        ))}
      </div>

      {/* Theme grid */}
      <ScrollArea className="max-h-[260px]">
        {filtered.length === 0 ? (
          <div
            className="flex h-24 flex-col items-center justify-center gap-2 border border-dashed border-border"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <HugeIcon icon={AiMagicIcon} className="size-4 text-white/10" />
            <span className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              {themes.length === 0 ? t.studioPresetNoThemes : t.studioPresetNoMatch}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((theme) => (
              <PresetCard
                key={theme.id}
                t={t}
                theme={theme}
                busy={busy === theme.id}
                canApply={!!activeAgent}
                onLoad={handleLoad}
                onApply={handleApply}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PresetCard
// ---------------------------------------------------------------------------

interface PresetCardProps {
  t: UiMessages;
  theme: ThemeCatalogItem;
  busy: boolean;
  canApply: boolean;
  onLoad: (theme: ThemeCatalogItem) => void;
  onApply: (theme: ThemeCatalogItem) => void;
}

function PresetCard({ t, theme, busy, canApply, onLoad, onApply }: PresetCardProps) {
  const swatches = swatchesFromTheme(theme, 4);
  const isInstalled = theme.installed;

  return (
    <div
      className="group flex flex-col border bg-card transition-colors hover:border-white/[0.15]"
      style={{ borderRadius: 'var(--radius)', borderColor: 'var(--border)' }}
    >
      {/* Swatch header */}
      <div
        className="relative flex h-[34px] w-full overflow-hidden"
        style={{ borderRadius: 'calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0' }}
      >
        {swatches.length > 0 ? (
          swatches.map((c) => <div key={c} className="flex-1" style={{ background: c }} />)
        ) : (
          <div className="flex-1" style={{ background: 'var(--muted)' }} />
        )}
        {/* Mode badge */}
        <span
          className="absolute right-1 top-1 rounded-[2px] border border-white/[0.08] bg-black/50 px-1 font-mono text-[9.5px] uppercase"
          style={{ letterSpacing: '0.06em', color: 'white' }}
        >
          {theme.mode === 'dark' ? 'D' : theme.mode === 'light' ? 'L' : 'A'}
        </span>
        {/* Installed indicator */}
        {isInstalled && (
          <span
            className="absolute left-1 top-1 flex size-3.5 items-center justify-center rounded-[2px] bg-[#2ED573]/80"
            title={t.studioPresetInstalled}
          >
            <HugeIcon icon={CheckIcon} className="size-2 text-black/70" />
          </span>
        )}
      </div>

      {/* Info row */}
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <span
          className="truncate font-mono text-[10px] font-medium"
          style={{ color: 'var(--foreground)' }}
          title={theme.name}
        >
          {theme.name}
        </span>

        {/* Action buttons */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onLoad(theme)}
            disabled={busy}
            className="flex h-[18px] flex-1 items-center justify-center gap-0.5 rounded-[2px] bg-[var(--primary)]/[0.08] font-mono text-[9.5px] font-medium uppercase transition-colors hover:bg-[var(--primary)]/15 disabled:opacity-40"
            style={{ letterSpacing: '0.05em', color: 'var(--primary)' }}
            title={t.studioPresetLoadTooltip}
          >
            <HugeIcon icon={Add01Icon} className="size-2" />
            {t.studioPresetLoad}
          </button>
          <button
            type="button"
            onClick={() => onApply(theme)}
            disabled={busy || !canApply}
            className="flex h-[18px] flex-1 items-center justify-center gap-0.5 rounded-[2px] border border-white/[0.08] font-mono text-[9.5px] font-medium uppercase transition-colors hover:bg-white/[0.04] disabled:opacity-40"
            style={{ letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}
            title={canApply ? t.studioPresetApplyTooltip : t.studioPresetApplySelectAgentFirst}
          >
            <HugeIcon icon={PaintBrushIcon} className="size-2" />
            {busy ? '…' : t.studioPresetApply}
          </button>
        </div>
      </div>
    </div>
  );
}
