// SPDX-License-Identifier: MPL-2.0

/**
 * RenderSettingsPanel — Wallpaper Engine 风格渲染设置面板（对齐/翻转/滤镜/视差等）。
 * 通过受控 props 接收 value/onChange，不持有持久化逻辑 —— 持久化发生在点
 * 「设为 UI 背景」或「应用到 agent」时由父组件执行。
 */

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { WALLPAPER_ALIGNMENTS } from '@shared/types';

export interface RenderSettingsPanelProps {
  value: WallpaperRenderOptions | undefined;
  onChange: (v: WallpaperRenderOptions | undefined) => void;
  playback: WallpaperInfo['playback'];
}

export function RenderSettingsPanel({ value, onChange, playback }: RenderSettingsPanelProps) {
  const r = value ?? {};
  // 局部 setter：更新单个字段；全部字段都回默认时重置为 undefined。
  const set = (patch: Partial<WallpaperRenderOptions>) => {
    const next = { ...r, ...patch };
    const isEmpty =
      next.speed === undefined &&
      next.loop === undefined &&
      next.alignment === undefined &&
      next.positionX === undefined &&
      next.positionY === undefined &&
      next.flipH === undefined &&
      next.flipV === undefined &&
      next.parallax === undefined &&
      next.brightness === undefined &&
      next.contrast === undefined &&
      next.saturation === undefined &&
      next.hueRotate === undefined &&
      next.sepia === undefined &&
      next.grayscale === undefined &&
      next.blur === undefined &&
      next.tint === undefined &&
      next.audioLevel === undefined;
    onChange(isEmpty ? undefined : next);
  };
  const isVideo = playback === 'video';

  const slider = (
    label: string,
    key: keyof WallpaperRenderOptions,
    min: number,
    max: number,
    step = 1,
    display?: string,
  ) => (
    <div className="we-prow flex items-center gap-[9px]">
      <span className="w-[76px] shrink-0 font-mono text-[10px]  text-muted-foreground">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={typeof r[key] === 'number' ? (r[key] as number) : min}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<WallpaperRenderOptions>)}
        className="we-range h-[4px] flex-1 cursor-pointer appearance-none rounded-md bg-border-strong [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-md [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-card"
      />
      <span className="w-[42px] text-right font-mono text-[10px] font-bold tabular-nums text-foreground">
        {display ?? (typeof r[key] === 'number' ? String(r[key]) : '默认')}
      </span>
    </div>
  );

  return (
    <div className="mt-[8px] grid grid-cols-2 gap-x-[9px] gap-y-[6px] rounded-md  bg-card2/80 p-[10px_14px_4px]">
      <div className="col-span-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground ">RENDER_SETTINGS</span>
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="font-mono text-[10px] text-muted-foreground/60 hover:text-primary"
        >
          RESET
        </button>
      </div>

      {/* Theme tint */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px]  text-muted-foreground">
          THEME_TINT
        </span>
        <input
          type="color"
          value={r.tint ?? '#c41e2a'}
          onChange={(e) => set({ tint: e.target.value })}
          className="h-6 w-[30px] cursor-pointer rounded-md  bg-card2 p-0"
        />
        <span className="w-[42px] text-right font-mono text-[10px] font-bold text-foreground">
          {r.tint ? r.tint.toUpperCase() : '默认'}
        </span>
      </div>

      {/* Alignment */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px]  text-muted-foreground">
          ALIGNMENT
        </span>
        <select
          value={r.alignment ?? 'fill'}
          onChange={(e) =>
            set({ alignment: e.target.value as WallpaperRenderOptions['alignment'] })
          }
          className="h-6 flex-1 rounded-md  bg-card2 px-1 py-0 font-mono text-[10px] "
        >
          {WALLPAPER_ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Speed (video only) */}
      {isVideo &&
        slider('播放速度', 'speed', 25, 200, 5, r.speed !== undefined ? `${r.speed}x` : undefined)}
      {/* Loop (video only) */}
      {isVideo && (
        <div className="we-prow flex items-center gap-[9px]">
          <span className="w-[76px] shrink-0 font-mono text-[10px]  text-muted-foreground">
            LOOP
          </span>
          <Switch checked={r.loop ?? true} onCheckedChange={(v) => set({ loop: v })} />
        </div>
      )}

      {slider(
        '位置 X',
        'positionX',
        -100,
        100,
        1,
        r.positionX !== undefined ? `${r.positionX}%` : undefined,
      )}
      {slider(
        '位置 Y',
        'positionY',
        -100,
        100,
        1,
        r.positionY !== undefined ? `${r.positionY}%` : undefined,
      )}
      {slider(
        '视差',
        'parallax',
        0,
        100,
        5,
        r.parallax !== undefined ? `${r.parallax}` : undefined,
      )}
      {slider(
        '音频响应',
        'audioLevel',
        0,
        100,
        5,
        r.audioLevel !== undefined ? `${r.audioLevel}` : undefined,
      )}

      {/* Flip */}
      <div className="we-prow flex items-center gap-[9px]">
        <span className="w-[76px] shrink-0 font-mono text-[10px]  text-muted-foreground">FLIP</span>
        <span className="flex flex-1 items-center gap-[6px]">
          <button
            type="button"
            onClick={() => set({ flipH: !r.flipH })}
            className={cn(
              'h-6 flex-1 rounded-md  bg-card2 font-mono text-[10px] font-semibold  transition-colors',
              r.flipH ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
            )}
          >
            H ↕
          </button>
          <button
            type="button"
            onClick={() => set({ flipV: !r.flipV })}
            className={cn(
              'h-6 flex-1 rounded-md  bg-card2 font-mono text-[10px] font-semibold  transition-colors',
              r.flipV ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
            )}
          >
            V ↔
          </button>
        </span>
      </div>

      {/* Image filters */}
      <div className="col-span-2 mt-[6px] grid grid-cols-2 gap-x-[9px] gap-y-[9px]">
        <span className="col-span-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground ">IMAGE_FILTERS</span>
          <span className="h-px flex-1 bg-border" />
        </span>
        {slider(
          '亮度',
          'brightness',
          0,
          200,
          5,
          r.brightness !== undefined ? `${r.brightness}` : undefined,
        )}
        {slider(
          '对比度',
          'contrast',
          0,
          200,
          5,
          r.contrast !== undefined ? `${r.contrast}` : undefined,
        )}
        {slider(
          '饱和度',
          'saturation',
          0,
          200,
          5,
          r.saturation !== undefined ? `${r.saturation}` : undefined,
        )}
        {slider(
          '色相',
          'hueRotate',
          -180,
          180,
          5,
          r.hueRotate !== undefined ? `${r.hueRotate}°` : undefined,
        )}
        {slider('模糊', 'blur', 0, 50, 1, r.blur !== undefined ? `${r.blur}px` : undefined)}
        {slider(
          '灰度',
          'grayscale',
          0,
          100,
          5,
          r.grayscale !== undefined ? `${r.grayscale}` : undefined,
        )}
        {slider('棕褐', 'sepia', 0, 100, 5, r.sepia !== undefined ? `${r.sepia}` : undefined)}
      </div>
    </div>
  );
}
