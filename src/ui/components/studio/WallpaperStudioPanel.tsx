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
      <span className="size-[3px] rounded-full bg-[#FF453A]" />
      <span style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}>
        {children}
      </span>
      {count !== undefined && (
        <span className="ml-1 h-[12px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[7px] text-white/30">
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
}: {
  wallpaper: WallpaperItem;
  isActive: boolean;
  busy: boolean;
  onExtract: (id: string) => void;
  onApply: (id: string) => void;
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
          <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-[#FF453A]">
            <HugeIcon icon={Tick01Icon} className="size-3 text-white" />
          </div>
        )}

        {/* Type badge */}
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-[2px] bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
          <span className="size-[5px] rounded-full" style={{ background: dotColor }} />
          <span className="font-mono text-[7.5px] font-semibold tracking-wider text-white/80">
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
            className="flex h-5 flex-1 items-center justify-center gap-1 rounded-[2px] border border-[#FF453A]/25 bg-[#FF453A]/[0.08] font-mono text-[8px] font-medium uppercase text-[#FF453A]/80 transition-colors hover:bg-[#FF453A]/15 disabled:opacity-40"
            style={{ letterSpacing: '0.06em' }}
            title="Extract colors from this wallpaper into a theme"
          >
            <HugeIcon icon={ColorPickerIcon} className="size-2.5" />
            {busy ? '…' : '提取'}
          </button>
          <button
            type="button"
            onClick={() => onApply(wallpaper.id)}
            disabled={isActive || busy}
            className="flex h-5 flex-1 items-center justify-center gap-1 rounded-[2px] border border-white/[0.08] bg-white/[0.04] font-mono text-[8px] font-medium uppercase text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-30"
            style={{ letterSpacing: '0.06em' }}
            title="Apply this wallpaper to the active agent"
          >
            <HugeIcon icon={PaintBrushIcon} className="size-2.5" />
            {busy ? '…' : '应用'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WallpaperStudioPanel() {
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const activeAgent = activeProject?.agentId ?? null;
  const showToast = useNotificationStore((s) => s.showToast);
  const [wallpapers, setWallpapers] = useState<WallpaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // --- Load wallpaper list ---
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
          showToast(`壁纸列表加载失败: ${toMessage(e)}`, 'destructive');
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
  const handleExtract = useCallback(
    async (wallpaperId: string) => {
      setBusy(wallpaperId);
      try {
        const result = await api.extractThemeFromWallpaper(wallpaperId);
        showToast(`主题已生成: ${result.displayName || result.id || 'extracted-theme'}`);
      } catch (e) {
        showToast(`提取失败: ${toMessage(e)}`, 'destructive');
      } finally {
        setBusy(null);
      }
    },
    [showToast],
  );

  // --- Apply wallpaper to active agent ---
  const handleApply = useCallback(
    async (wallpaperId: string) => {
      if (!activeAgent) {
        showToast('请先选择一个 Agent', 'destructive');
        return;
      }
      setBusy(wallpaperId);
      try {
        await api.applyWallpaperToAgent(wallpaperId, activeAgent);
        showToast('壁纸已应用');
      } catch (e) {
        showToast(`应用失败: ${toMessage(e)}`, 'destructive');
      } finally {
        setBusy(null);
      }
    },
    [activeAgent, showToast],
  );

  // --- Import new wallpaper ---
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
        showToast(`已导入 ${imported.length} 张壁纸`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('cancel')) return; // user cancelled
      showToast(`导入失败: ${toMessage(e)}`, 'destructive');
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
            壁纸工作室
          </span>
          <span className="flex items-center gap-1 font-mono text-[9px] text-white/30">
            <span className="size-[5px] rounded-full bg-[#2ED573]/70" />
            {activeAgent ?? '未选'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleImport}
          className="flex h-7 items-center gap-1.5 rounded-[2px] border border-white/[0.1] bg-white/[0.04] px-2 font-mono text-[9px] font-medium uppercase text-white/60 transition-colors hover:border-[#FF453A]/30 hover:text-white/90"
          style={{ letterSpacing: '0.06em' }}
        >
          <HugeIcon icon={Upload01Icon} className="size-3" />
          上传
        </button>
      </div>

      {/* --- Scrollable content --- */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Loading */}
          {loading && (
            <div className="flex h-32 items-center justify-center font-mono text-[10px] text-white/30">
              加载壁纸列表中…
            </div>
          )}

          {/* Empty state */}
          {!loading && wallpapers.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-3">
              <HugeIcon icon={ImageIcon} className="size-8 text-white/10" />
              <p className="font-mono text-[10px] text-white/30">
                暂无壁纸 — 上传或安装 Wallpaper Engine 壁纸
              </p>
              <button
                type="button"
                onClick={handleImport}
                className="flex h-7 items-center gap-1.5 rounded-[2px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-3 font-mono text-[9px] font-medium uppercase text-[#FF453A]/80 transition-colors hover:bg-[#FF453A]/20"
                style={{ letterSpacing: '0.06em' }}
              >
                <HugeIcon icon={Upload01Icon} className="size-3" />
                导入壁纸
              </button>
            </div>
          )}

          {/* Wallpaper grid */}
          {!loading && wallpapers.length > 0 && (
            <div className="space-y-4">
              <SectionKicker count={wallpapers.length}>
                全部壁纸
                {Object.entries(typeCounts).map(([t, c]) => (
                  <span
                    key={t}
                    className="ml-1 inline-flex items-center gap-1 font-mono text-[7px] text-white/25"
                  >
                    <span
                      className="size-[4px] rounded-full"
                      style={{ background: TYPE_DOT_COLOR[t as WallpaperVariant] }}
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
                    isActive={false}
                    busy={busy === wp.id}
                    onExtract={handleExtract}
                    onApply={handleApply}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Workflow hint */}
          {!loading && wallpapers.length > 0 && (
            <div className="mt-5 rounded-[2px] border border-white/[0.06] bg-white/[0.015] p-3">
              <div className="flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-white/30">
                <HugeIcon icon={ColorPickerIcon} className="size-3 text-[#FF453A]/60" />
                流程提示
              </div>
              <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-white/25">
                选择壁纸后，点击「提取」生成主题色板， 或直接点击「应用」注入当前 Agent 窗口。 支持
                scene / video / web / preset 四种类型。
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default WallpaperStudioPanel;
