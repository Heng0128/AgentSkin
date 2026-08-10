// SPDX-License-Identifier: MPL-2.0

/**
 * # WallpaperStudioPanel
 *
 * WALLPAPER tab for Theme Studio's Workbench. Integrates wallpaper management
 * into the studio workflow: select a wallpaper → extract theme colors or apply
 * directly to the active agent.
 *
 * Swiss/International design: #141418 base, #FF453A accent, rounded-[2px],
 * Space Grotesk + IBM Plex Mono. Compact grid layout suited for the center
 * column of the Studio Workbench.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import {
  ColorPickerIcon,
  ImageIcon,
  PaintBrushIcon,
  Tick01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import type { WallpaperInfo } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WallpaperItem {
  id: string;
  name: string;
  type: 'scene' | 'video' | 'web' | 'preset';
  thumbUrl?: string;
}

type WallpaperVariant = 'scene' | 'video' | 'web' | 'preset';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<WallpaperVariant, string> = {
  scene: 'SCENE',
  video: 'VIDEO',
  web: 'WEB',
  preset: 'PRESET',
};

const TYPE_DOT_COLOR: Record<WallpaperVariant, string> = {
  scene: '#8B5CF6',
  video: '#F59E0B',
  web: '#06B6D4',
  preset: '#EC4899',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionKicker({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase">
      <span className="size-[3px] rounded-full bg-primary" />
      <span style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}>
        {children}
      </span>
      {count !== undefined && (
        <span className="ml-1 h-[12px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[9.5px] text-white/30">
          {count}
        </span>
      )}
    </div>
  );
}

function WallpaperCard({
  wallpaper,
  isActive,
  busy,
  onExtract,
  onApply,
  t,
}: {
  wallpaper: WallpaperItem;
  isActive: boolean;
  busy: boolean;
  onExtract: (id: string) => void;
  onApply: (id: string) => void;
  t: UiMessages;
}) {
  const dotColor = TYPE_DOT_COLOR[wallpaper.type];

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-[2px] border transition-colors ${
        isActive
          ? 'border-[#FF453A]/35 bg-[#FF453A]/[0.06]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
      }`}
    >
      {/* Thumbnail area */}
      <div className="relative aspect-video w-full overflow-hidden bg-white/[0.03]">
        {wallpaper.thumbUrl ? (
          <img
            src={wallpaper.thumbUrl}
            alt={wallpaper.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <HugeIcon icon={ImageIcon} className="size-6 text-white/10" />
          </div>
        )}

        {/* Active tick overlay */}
        {isActive && (
          <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-[2px] bg-[#FF453A]">
            <HugeIcon icon={Tick01Icon} className="size-3 text-white" />
          </div>
        )}

        {/* Type badge */}
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-[2px] bg-black/70 px-1.5 py-0.5">
          <span className="size-[5px] rounded-full" style={{ background: dotColor }} />
          <span className="font-mono text-[9.5px] font-semibold tracking-wider text-white/80">
            {TYPE_LABELS[wallpaper.type]}
          </span>
        </div>
      </div>

      {/* Info row */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span className="truncate font-mono text-[10px] font-medium text-white/80">
          {wallpaper.name}
        </span>

        {/* Action buttons */}
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onExtract(wallpaper.id)}
            disabled={busy}
            className="flex h-5 flex-1 items-center justify-center gap-1 rounded-[2px] border border-[#FF453A]/25 bg-[#FF453A]/[0.08] font-mono text-[9.5px] font-medium uppercase text-[#FF453A]/80 transition-colors hover:bg-[#FF453A]/15 disabled:opacity-40"
            style={{ letterSpacing: '0.06em' }}
            title={t.studioWallpaperExtractTooltip}
          >
            <HugeIcon icon={ColorPickerIcon} className="size-2.5" />
            {busy ? '…' : t.studioWallpaperExtract}
          </button>
          <button
            type="button"
            onClick={() => onApply(wallpaper.id)}
            disabled={isActive || busy}
            className="flex h-5 flex-1 items-center justify-center gap-1 rounded-[2px] border border-white/[0.08] bg-white/[0.04] font-mono text-[9.5px] font-medium uppercase text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-30"
            style={{ letterSpacing: '0.06em' }}
            title={t.studioWallpaperApplyTooltip}
          >
            <HugeIcon icon={PaintBrushIcon} className="size-2.5" />
            {busy ? '…' : t.studioWallpaperApply}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WallpaperStudioPanel({ t }: { t: UiMessages }) {
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const activeAgent = activeProject?.agentId ?? null;
  const setPaletteLoaded = useStudioStore((s) => s.setPaletteLoaded);
  const setPreviewView = useStudioStore((s) => s.setPreviewView);
  const showToast = useNotificationStore((s) => s.showToast);
  const [wallpapers, setWallpapers] = useState<WallpaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Tracks the wallpaper applied to the active agent this session so the
  // "active" tick can reflect reality (the panel has no cross-session getter).
  const [appliedId, setAppliedId] = useState<string | null>(null);

  // The applied-wallpaper indicator is agent-scoped: clear it when the active
  // agent changes so the tick never implies a stale cross-agent state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on agent change; the value is intentionally not read inside the body.
  useEffect(() => {
    setAppliedId(null);
  }, [activeAgent]);

  // --- Load wallpaper list ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const items = await api.listWallpapers();
        if (!cancelled) {
          setWallpapers(
            items.map((w: WallpaperInfo) => ({
              id: w.id,
              name: w.title || w.id,
              type: (w.projectType ?? 'preset') as WallpaperVariant,
              thumbUrl: w.previewUrl || undefined,
            })),
          );
        }
      } catch (e) {
        if (!cancelled) {
          showToast(t.studioWallpaperListLoadFailed(toMessage(e)), 'destructive');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // --- Extract theme from wallpaper ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const handleExtract = useCallback(
    async (wallpaperId: string) => {
      setBusy(wallpaperId);
      try {
        const result = await api.extractThemeFromWallpaper(wallpaperId);
        // Closing the loop: the generated theme is now installed in the
        // library — load its palette into the Studio editor (same path as
        // PresetThemePicker's LOAD) so the user can preview/tweak/export it.
        const palette = semanticColorsToPalette(result.colors);
        if (Object.keys(palette).length > 0) {
          setPaletteLoaded(palette);
          setPreviewView('theme');
          showToast(t.studioWallpaperExtractSuccess(result.displayName || result.id));
        } else {
          showToast(
            t.studioWallpaperExtractGenerated(result.displayName || result.id || 'extracted-theme'),
          );
        }
      } catch (e) {
        showToast(t.studioWallpaperExtractFailed(toMessage(e)), 'destructive');
      } finally {
        setBusy(null);
      }
    },
    [showToast, setPaletteLoaded, setPreviewView],
  );

  // --- Apply wallpaper to active agent ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const handleApply = useCallback(
    async (wallpaperId: string) => {
      if (!activeAgent) {
        showToast(t.studioSelectAgentFirst, 'destructive');
        return;
      }
      setBusy(wallpaperId);
      try {
        await api.applyWallpaperToAgent(wallpaperId, activeAgent);
        setAppliedId(wallpaperId);
        showToast(t.studioWallpaperApplied);
      } catch (e) {
        showToast(t.studioWallpaperApplyFailed(toMessage(e)), 'destructive');
      } finally {
        setBusy(null);
      }
    },
    [activeAgent, showToast],
  );

  // --- Import new wallpaper ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const handleImport = useCallback(async () => {
    try {
      const imported = await api.importWallpaper();
      if (imported && imported.length > 0) {
        setWallpapers((prev) => [
          ...imported.map((w: WallpaperInfo) => ({
            id: w.id,
            name: w.title || w.id,
            type: (w.projectType ?? 'preset') as WallpaperVariant,
            thumbUrl: w.previewUrl || undefined,
          })),
          ...prev,
        ]);
        showToast(t.studioWallpaperImported(imported.length));
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('cancel')) return; // user cancelled
      showToast(t.studioWallpaperImportFailed(toMessage(e)), 'destructive');
    }
  }, [showToast]);

  // --- Counts by type ---
  const typeCounts: Record<string, number> = {};
  for (const w of wallpapers) {
    typeCounts[w.type] = (typeCounts[w.type] ?? 0) + 1;
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#141418] text-white">
      {/* --- Header bar --- */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <HugeIcon icon={ColorPickerIcon} className="size-3.5 text-[#FF453A]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
            {t.studioWallpaperTitle}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] text-white/30">
            <span className="size-[5px] rounded-full bg-[#2ED573]/70" />
            {activeAgent ?? t.studioNoAgentSelected}
          </span>
        </div>
        <button
          type="button"
          onClick={handleImport}
          className="flex h-7 items-center gap-1.5 rounded-[2px] border border-white/[0.1] bg-white/[0.04] px-2 font-mono text-[10px] font-medium uppercase text-white/60 transition-colors hover:border-[#FF453A]/30 hover:text-white/90"
          style={{ letterSpacing: '0.06em' }}
        >
          <HugeIcon icon={Upload01Icon} className="size-3" />
          {t.studioWallpaperUpload}
        </button>
      </div>

      {/* --- Scrollable content --- */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Loading */}
          {loading && (
            <div className="flex h-32 items-center justify-center font-mono text-[10px] text-white/30">
              {t.studioWallpaperLoading}
            </div>
          )}

          {/* Empty state */}
          {!loading && wallpapers.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-3">
              <HugeIcon icon={ImageIcon} className="size-8 text-white/10" />
              <p className="font-mono text-[10px] text-white/30">{t.studioWallpaperEmpty}</p>
              <button
                type="button"
                onClick={handleImport}
                className="flex h-7 items-center gap-1.5 rounded-[2px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-3 font-mono text-[10px] font-medium uppercase text-[#FF453A]/80 transition-colors hover:bg-[#FF453A]/20"
                style={{ letterSpacing: '0.06em' }}
              >
                <HugeIcon icon={Upload01Icon} className="size-3" />
                {t.studioWallpaperImportAction}
              </button>
            </div>
          )}

          {/* Wallpaper grid */}
          {!loading && wallpapers.length > 0 && (
            <div className="space-y-4">
              <SectionKicker count={wallpapers.length}>
                {t.studioWallpaperAllTitle}
                {Object.entries(typeCounts).map(([tp, c]) => (
                  <span
                    key={tp}
                    className="ml-1 inline-flex items-center gap-1 font-mono text-[9.5px] text-white/25"
                  >
                    <span
                      className="size-[4px] rounded-full"
                      style={{ background: TYPE_DOT_COLOR[tp as WallpaperVariant] }}
                    />
                    {c}
                  </span>
                ))}
              </SectionKicker>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                {wallpapers.map((wp) => (
                  <WallpaperCard
                    key={wp.id}
                    wallpaper={wp}
                    isActive={appliedId === wp.id}
                    busy={busy === wp.id}
                    onExtract={handleExtract}
                    onApply={handleApply}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Workflow hint */}
          {!loading && wallpapers.length > 0 && (
            <div className="mt-5 rounded-[2px] border border-white/[0.06] bg-white/[0.015] p-3">
              <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/30">
                <HugeIcon icon={ColorPickerIcon} className="size-3 text-[#FF453A]/60" />
                {t.studioWallpaperWorkflowTitle}
              </div>
              <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-white/25">
                {t.studioWallpaperWorkflowDesc}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
