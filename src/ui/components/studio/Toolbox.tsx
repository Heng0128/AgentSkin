// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { EASING_OPTIONS, rgbToHex } from '@/components/studio/color-utils';
import type { PalettePreset } from '@/lib/palettePresets';
import { deletePalettePreset, loadPalettePresets, savePalettePreset } from '@/lib/palettePresets';
import { useStudioStore } from '@/stores/studioStore';
import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';
import type { ThemeVisualSnapshot } from '@shared/types';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';

function computeSignature(snap: ThemeVisualSnapshot) {
  const landmarks = snap.landmarks.filter((lm) => lm.visible);

  const backgrounds: string[] = [];
  const texts: string[] = [];
  const accents: string[] = [];
  let rootBg: string | null = null;
  let rootFg: string | null = null;

  for (const lm of landmarks) {
    if (lm.selector === ':root' || lm.tag === 'html') {
      for (const s of lm.styles) {
        if (s.property === 'background-color') rootBg = s.value;
        if (s.property === 'color') rootFg = s.value;
      }
    }
    for (const s of lm.styles) {
      if (s.property === 'background-color' && s.value !== 'transparent') backgrounds.push(s.value);
      if (s.property === 'color') texts.push(s.value);
      if (s.property.startsWith('border')) accents.push(s.value);
    }
  }

  const radiusValues: string[] = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (s.property === 'border-radius') radiusValues.push(s.value);
    }
  }
  const radiusCount = new Map<string, number>();
  for (const r of radiusValues) radiusCount.set(r, (radiusCount.get(r) ?? 0) + 1);
  let primaryRadius = '0px';
  for (const [r, c] of radiusCount) if (c > 1) primaryRadius = r;

  const paddings: number[] = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (s.property.startsWith('padding')) {
        const n = parseFloat(s.value);
        if (n > 0 && n < 100) paddings.push(n);
      }
    }
  }
  const avgPad = paddings.length ? paddings.reduce((a, b) => a + b, 0) / paddings.length : 8;

  let shadowLevel = 'none';
  let hasShadow = false;
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (s.property === 'box-shadow' && s.value !== 'none') {
        hasShadow = true;
        // CSS box-shadow: <offset-x> <offset-y> <blur-radius> <spread-radius>?
        // <color>? — extract all <length> values and use the 3rd as blur.
        const lengths = s.value.match(/([\d.]+)(?:px|rem|em|vh|vw)?/g);
        if (lengths && lengths.length >= 3) {
          const blurPx = parseFloat(lengths[2]);
          if (blurPx <= 4) shadowLevel = 'sm';
          else if (blurPx <= 12) shadowLevel = 'md';
          else if (blurPx <= 24) shadowLevel = 'lg';
          else shadowLevel = 'xl';
        } else if (lengths && lengths.length >= 1) {
          // Fallback: at least one length present but <3 — treat as 'sm'
          shadowLevel = 'sm';
        }
      }
    }
  }

  const blurValues: string[] = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (
        (s.property === 'backdrop-filter' || s.property === '-webkit-backdrop-filter') &&
        s.value !== 'none'
      ) {
        blurValues.push(s.value);
      }
    }
  }

  let fontFamily = '';
  const fontSizes: string[] = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (s.property === 'font-family' && !fontFamily) fontFamily = s.value;
      if (s.property === 'font-size') fontSizes.push(s.value);
    }
  }

  const durations: string[] = [];
  const timings: string[] = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (s.property === 'transition-duration') durations.push(s.value);
      if (s.property === 'transition-timing-function') timings.push(s.value);
    }
  }
  const durMap = new Map<string, number>();
  for (const d of durations) durMap.set(d, (durMap.get(d) ?? 0) + 1);
  let defaultDur = '0s';
  for (const [d, c] of durMap) if (c > 1) defaultDur = d;

  const timeMap = new Map<string, number>();
  for (const t of timings) timeMap.set(t, (timeMap.get(t) ?? 0) + 1);
  let defaultTiming = 'ease';
  for (const [t, c] of timeMap) if (c > 1) defaultTiming = t;

  const gradients = [];
  for (const lm of landmarks) {
    for (const s of lm.styles) {
      if (
        (s.property === 'background-image' || s.property === 'background') &&
        /gradient\(/.test(s.value)
      ) {
        gradients.push(s.value);
      }
    }
  }

  return {
    color: {
      backgrounds: [...new Set(backgrounds)],
      texts: [...new Set(texts)],
      accents: [...new Set(accents)],
      mode: (() => {
        const bg = rootBg ?? backgrounds[0] ?? '#000';
        const m = bg.match(/\d+/g);
        if (!m) return 'dark';
        // The snapshot may carry hex colors (#201a40) which regex-matching
        // digits would mangle into ["201","40"] → NaN channels. Parse hex
        // properly first; fall back to the rgb() digit split otherwise.
        let r: number, g: number, b: number;
        if (bg.startsWith('#')) {
          const hex = bg.slice(1).padEnd(6, '0');
          const n = parseInt(hex.slice(0, 6), 16);
          if (Number.isNaN(n)) return 'dark';
          r = (n >> 16) & 0xff;
          g = (n >> 8) & 0xff;
          b = n & 0xff;
        } else {
          r = parseInt(m[0], 10);
          g = parseInt(m[1], 10);
          b = parseInt(m[2], 10);
        }
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? 'dark' : 'light';
      })(),
      rootBackground: rootBg,
      rootColor: rootFg,
    },
    radius: { values: [...new Set(radiusValues)], primary: primaryRadius, maxRadius: 0 },
    spacing: { avgPadding: avgPad, avgMargin: 0 },
    shadow: { level: hasShadow ? shadowLevel : 'none' },
    blur: { values: [...new Set(blurValues)], countWithBlur: blurValues.length, intensity: 0 },
    font: { family: fontFamily, sizes: [...new Set(fontSizes)] },
    motion: { defaultDuration: defaultDur, defaultTiming },
    decoration: {
      borderedElementCount: 0,
      hasSeparators: false,
      gradients: [...new Set(gradients)],
    },
  };
}

function fingerprintFromSnapshot(snap: ThemeVisualSnapshot): string {
  const { radius, spacing, shadow, blur, font, motion } = computeSignature(snap);
  const fontShort = font.family.split(',')[0]?.trim().replace(/'/g, '') || 'system-ui';
  return [
    radius.primary,
    `${Math.round(spacing.avgPadding)}px`,
    shadow.level,
    blur.values.length ? 'blur' : 'no-blur',
    fontShort,
    motion.defaultDuration,
  ].join(' · ');
}

// ---------------------------------------------------------------------------

// Toolbox Panel — P3: real-time 8-dim overrides for the mock replica only
// ---------------------------------------------------------------------------

interface ToolboxPanelProps {
  t: UiMessages;
  originalSig: ReturnType<typeof computeSignature>;
  overrides?: ToolOverride | null;
  onOverride: (key: keyof ToolOverride, value: string | number | boolean | undefined) => void;
  onReset: () => void;
}

function shadowLevels(
  t: UiMessages,
): Array<{ label: string; value: 'none' | 'sm' | 'md' | 'lg' | 'xl' }> {
  return [
    { label: t.studioToolboxShadowNone, value: 'none' },
    { label: t.studioToolboxShadowSm, value: 'sm' },
    { label: t.studioToolboxShadowMd, value: 'md' },
    { label: t.studioToolboxShadowLg, value: 'lg' },
    { label: t.studioToolboxShadowXl, value: 'xl' },
  ];
}

// ---------------------------------------------------------------------------
// styled micro-components
// ---------------------------------------------------------------------------

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}: {
  label: string;
  hint: string;
  value: number | string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: string) => void;
}) {
  const nVal = typeof value === 'number' ? value : parseFloat(String(value)) || min;
  // Clamp: snapshot-derived values (e.g. avgPadding up to 100px) can exceed
  // the slider's max and would otherwise push the fill/thumb past the track.
  const pct = Math.min(100, Math.max(0, ((nVal - min) / (max - min)) * 100));
  return (
    <div className="space-y-1 py-1">
      <div className="flex items-baseline justify-between">
        <span
          className="text-[10px] font-normal "
          style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] font-normal" style={{ color: 'var(--foreground)' }}>
          {typeof value === 'number' ? `${value}${unit}` : value || `—${unit}`}
        </span>
      </div>
      <div className="relative h-4 flex items-center">
        {/* Track background ( thin + flat) */}
        <div
          className="absolute inset-x-0 h-[4px] rounded-md"
          style={{ background: 'var(--border)' }}
        />
        {/* Filled portion (primary red) */}
        <div
          className="absolute left-0 h-[4px]"
          style={{
            width: `${pct}%`,
            background: 'var(--primary)',
            borderRadius: '1px',
          }}
        />
        {/* Native range input (transparent, overlaid) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={nVal}
          onChange={(e) => onChange(e.target.value)}
          title={hint}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        {/* Thumb indicator */}
        <div
          className="pointer-events-none absolute size-[11px] -translate-x-1/2 rounded-md border-2"
          style={{
            left: `${pct}%`,
            borderColor: 'var(--primary)',
            background: 'var(--surface)',
          }}
        />
      </div>
    </div>
  );
}

function SelectRow({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1 py-1">
      <span
        className="text-[10px] font-normal "
        style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={hint}
        className="h-6 w-full border border-input bg-muted px-2 text-[10px] outline-none transition-colors focus:border-primary/60"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1 py-1">
      <span
        className="text-[10px] font-normal "
        style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-6 w-full border border-input bg-muted px-2 text-[10px] outline-none transition-colors focus:border-primary/60"
      />
    </div>
  );
}

function ColorRow({
  label,
  hint,
  value,
  onChange,
  t,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  t: UiMessages;
}) {
  return (
    <div className="space-y-1 py-1">
      <span
        className="text-[10px] font-normal "
        style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={hint}
          className="size-6 shrink-0 cursor-pointer  p-0.5"
          style={{ background: 'var(--muted)', borderRadius: 'var(--radius)' }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.studioColorHexPlaceholder}
          className="h-6 w-full border border-input bg-muted px-2 font-mono text-[10px] outline-none transition-colors focus:border-primary/60"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1" title={hint}>
      <span
        className="text-[10px] font-normal "
        style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
      >
        {label}
      </span>
      {/* toggle: thin inline switch */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-4 w-7 shrink-0 transition-colors"
        style={{
          borderRadius: '2px',
          background: checked ? 'var(--primary)' : 'var(--border)',
        }}
      >
        <span
          className="absolute top-0 size-[12px]"
          style={{
            borderRadius: '1px',
            background: 'var(--background)',
            left: checked ? '14px' : '2px',
            transition: 'left 0.15s ease',
          }}
        />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Section header — .tbx-t style
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2  pb-1 pt-2 text-[10px] font-normal "
      style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)' }}
    >
      <span
        className="size-[3px] rounded-md"
        style={{ background: 'var(--primary)' }}
      />
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolboxPanel — main styled 8-dimension panel
// ---------------------------------------------------------------------------

function ToolboxPanel({ t, originalSig, overrides, onOverride, onReset }: ToolboxPanelProps) {
  // ===== 我的调色板预设库（localStorage） =====
  const setPaletteLoaded = useStudioStore((s) => s.setPaletteLoaded);
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const [presets, setPresets] = useState<PalettePreset[]>([]);
  const [presetName, setPresetName] = useState('');

  const refreshPresets = () => setPresets(loadPalettePresets());
  // 仅挂载时从 localStorage 读取一次；内联避免引用每次渲染重建的 refreshPresets
  // （否则加入依赖数组会导致无限重渲染循环）。
  useEffect(() => {
    setPresets(loadPalettePresets());
  }, []);

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    savePalettePreset(name, toolOverrides?.colors ?? {});
    setPresetName('');
    refreshPresets();
  };
  const handleDeletePreset = (id: string) => {
    deletePalettePreset(id);
    refreshPresets();
  };

  // Resolve final values: override wins over original
  const finalRadius = overrides?.radius ?? originalSig.radius.primary;
  const finalSpacing = overrides?.spacing ?? originalSig.spacing.avgPadding;
  const finalShadow = overrides?.shadowLevel ?? originalSig.shadow.level;
  const finalBlur = overrides?.blurPx ?? 0;
  const finalFontSize =
    overrides?.fontSize ??
    Math.round(
      originalSig.font.sizes.length > 0
        ? originalSig.font.sizes.reduce((sum, s) => sum + (parseFloat(s) || 0), 0) /
            originalSig.font.sizes.length
        : 14,
    );
  const finalFontFam = overrides?.fontFam ?? originalSig.font.family;
  const finalDuration = overrides?.duration ?? originalSig.motion.defaultDuration;
  const finalTiming = overrides?.timing ?? originalSig.motion.defaultTiming;

  // color (re-themed by role)
  const finalAccent = overrides?.accent ?? rgbToHex(originalSig.color.accents[0]) ?? '#3b82f6';
  const finalBg =
    overrides?.background ??
    rgbToHex(originalSig.color.rootBackground || originalSig.color.backgrounds[0]) ??
    '#ffffff';
  const finalFg =
    overrides?.foreground ??
    rgbToHex(originalSig.color.rootColor || originalSig.color.texts[0]) ??
    '#111111';
  const finalSurface =
    overrides?.surface ??
    rgbToHex(originalSig.color.backgrounds[1] || originalSig.color.backgrounds[0]) ??
    '#f5f5f5';
  // structure / density
  const finalBorder = overrides?.borderWidth ?? 1;
  const finalLh = overrides?.lineHeight ?? 1.5;
  const finalScale = overrides?.scale ?? 1;
  const finalSep = overrides?.separators ?? true;
  // filter
  const finalInvert = overrides?.invert ?? false;
  const finalContrast = overrides?.contrast ?? 1;
  const finalSaturate = overrides?.saturate ?? 1;
  // visual effects
  const finalDim = overrides?.dim ?? 0;
  const finalOpacity = overrides?.opacity ?? 1;
  const finalGrad = overrides?.gradientAccent ?? false;

  // Number of override dimensions the user has actually touched (any key set
  // to a non-undefined value). Drives the "N 项微调生效" badge.
  const activeCount = Object.values(overrides ?? {}).filter((v) => v !== undefined).length;

  return (
    <div className="mt-4 space-y-0">
      {/* Panel header */}
      <div className="flex items-center justify-between  pb-1.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-3 text-primary" />
          <span
            className="text-[10px] font-normal "
            style={{ letterSpacing: '0.12em', color: 'var(--foreground)' }}
          >
            {t.studioToolboxTitle}
          </span>
          {activeCount > 0 && (
            <span
              className="rounded px-1 py-0 text-[10px] font-normal"
              style={{
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                letterSpacing: '0.06em',
              }}
            >
              {t.studioToolboxActiveCount(activeCount)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={!overrides}
          className="text-[10px]   disabled:opacity-30"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <span className="flex items-center gap-1 text-[10px]   disabled:opacity-30">
            <RotateCcw className="size-3" />
            {t.studioToolboxReset}
          </span>
        </button>
      </div>

      {/* Section: 我的调色板 / Presets */}
      <SectionHeader>{t.studioToolboxMyPalette}</SectionHeader>
      <div className="space-y-1.5 py-1">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder={t.studioToolboxPresetNamePlaceholder}
            className="h-6 min-w-0 flex-1 border border-input bg-muted px-2 text-[10px] outline-none transition-colors focus:border-primary/60"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={!presetName.trim() || !toolOverrides?.colors}
            className="h-6 shrink-0  px-2 text-[10px]  transition-colors hover:bg-accent disabled:opacity-30"
            style={{ borderRadius: 'var(--radius)', letterSpacing: '0.06em' }}
            title={t.studioToolboxSavePresetHint}
          >
            {t.studioToolboxSavePreset}
          </button>
        </div>
        {presets.length === 0 ? (
          <p
            className="text-[10px]"
            style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
          >
            {t.studioToolboxNoPresets}
          </p>
        ) : (
          <div className="space-y-1">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1  px-1 py-1"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="flex shrink-0 overflow-hidden rounded-md ">
                    {['accent', 'background', 'foreground', 'surface'].map((k) =>
                      p.colors[k] ? (
                        <span
                          key={k}
                          className="block size-3"
                          style={{ background: p.colors[k] }}
                          title={p.colors[k]}
                        />
                      ) : null,
                    )}
                  </span>
                  <span
                    className="truncate text-[10px]"
                    style={{ color: 'var(--foreground)' }}
                    title={p.name}
                  >
                    {p.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPaletteLoaded(p.colors)}
                  className="h-5 shrink-0  px-1 text-[10px]  transition-colors hover:bg-accent"
                  style={{ borderRadius: 'var(--radius)', letterSpacing: '0.04em' }}
                  title={t.studioToolboxLoadPresetHint}
                >
                  {t.studioToolboxLoadPreset}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePreset(p.id)}
                  className="h-5 shrink-0  px-1 text-[10px]  transition-colors hover:bg-accent"
                  style={{ borderRadius: 'var(--radius)', letterSpacing: '0.04em' }}
                  title={t.studioToolboxDeletePresetHint}
                >
                  {t.studioToolboxDeletePreset}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section: 配色 / Color */}
      <SectionHeader>{t.studioToolboxColorSection}</SectionHeader>
      <ColorRow
        label={t.studioToolboxAccentColor}
        hint={t.studioToolboxAccentColorHint}
        value={finalAccent}
        onChange={(v) => onOverride('accent', v)}
        t={t}
      />
      <ColorRow
        label={t.studioToolboxBgColor}
        hint={t.studioToolboxBgColorHint}
        value={finalBg}
        onChange={(v) => onOverride('background', v)}
        t={t}
      />
      <ColorRow
        label={t.studioToolboxFgColor}
        hint={t.studioToolboxFgColorHint}
        value={finalFg}
        onChange={(v) => onOverride('foreground', v)}
        t={t}
      />
      <ColorRow
        label={t.studioToolboxSurfaceColor}
        hint={t.studioToolboxSurfaceColorHint}
        value={finalSurface}
        onChange={(v) => onOverride('surface', v)}
        t={t}
      />
      <ToggleRow
        label={t.studioToolboxGradientBg}
        hint={t.studioToolboxGradientBgHint}
        checked={finalGrad}
        onChange={(v) => onOverride('gradientAccent', v)}
      />

      {/* Section: 形状与边框 / Shape */}
      <SectionHeader>{t.studioToolboxShapeSection}</SectionHeader>
      <SliderRow
        label={`${t.studioDimRadius} (${finalRadius})`}
        hint={t.studioToolboxRadiusHint}
        value={Number(finalRadius) || 0}
        min={0}
        max={24}
        step={1}
        onChange={(v) => onOverride('radius', `${v}px`)}
      />
      <SliderRow
        label={`${t.studioDimSpacing} (${Math.round(finalSpacing)}px)`}
        hint={t.studioToolboxSpacingHint}
        value={Math.round(finalSpacing)}
        min={0}
        max={32}
        step={1}
        onChange={(v) => onOverride('spacing', Number(v))}
      />
      <SelectRow
        label={`${t.studioDimShadow} (${finalShadow.toUpperCase()})`}
        hint={t.studioToolboxShadowHint}
        value={finalShadow}
        options={shadowLevels(t).map((s) => ({ label: s.label, value: s.value }))}
        onChange={(v) => onOverride('shadowLevel', v as ToolOverride['shadowLevel'])}
      />
      <SliderRow
        label={`${t.studioDimBlur} (${finalBlur}px)`}
        hint={t.studioToolboxBlurHint}
        value={finalBlur}
        min={0}
        max={12}
        step={1}
        onChange={(v) => onOverride('blurPx', Number(v))}
      />
      <SliderRow
        label={t.studioToolboxLineWidth(finalBorder)}
        hint={t.studioToolboxLineWidthHint}
        value={finalBorder}
        min={0}
        max={4}
        step={0.5}
        onChange={(v) => onOverride('borderWidth', Number(v))}
      />
      <ToggleRow
        label={t.studioToolboxSeparator}
        hint={t.studioToolboxSeparatorHint}
        checked={finalSep}
        onChange={(v) => onOverride('separators', v)}
      />

      {/* Section: 字体 / Typography */}
      <SectionHeader>{t.studioToolboxFontSection}</SectionHeader>
      <SliderRow
        label={`${t.studioDimFont} (${finalFontSize}px)`}
        hint={t.studioToolboxFontHint}
        value={finalFontSize}
        min={10}
        max={20}
        step={0.5}
        onChange={(v) => onOverride('fontSize', Number(v))}
      />
      <TextRow
        label={t.studioToolboxFontFamily}
        value={finalFontFam || ''}
        onChange={(v) => onOverride('fontFam', v)}
        placeholder={t.studioToolboxFontFamilyPlaceholder}
      />
      <SliderRow
        label={t.studioToolboxLineHeight}
        hint={t.studioToolboxLineHeightHint}
        value={finalLh}
        min={1}
        max={2.2}
        step={0.05}
        onChange={(v) => onOverride('lineHeight', Number(v))}
      />

      {/* Section: 动效 / Motion */}
      <SectionHeader>{t.studioToolboxMotionSection}</SectionHeader>
      <div className="grid grid-cols-2 gap-2 py-1">
        <TextRow
          label={`${t.studioDimMotion} ${t.studioToolboxMotionDuration}`}
          value={finalDuration}
          onChange={(v) => onOverride('duration', v)}
          placeholder={t.studioToolboxMotionDurationPlaceholder}
        />
        <SelectRow
          label={`${t.studioDimMotion} ${t.studioToolboxMotionEasing}`}
          value={finalTiming}
          options={EASING_OPTIONS.map((e) => ({ label: e, value: e }))}
          onChange={(v) => onOverride('timing', v)}
        />
      </div>

      {/* Section: 密度与滤镜 / Filter (preview only) */}
      <SectionHeader>{t.studioToolboxFilterSection}</SectionHeader>
      <SliderRow
        label={t.studioToolboxScale}
        hint={t.studioToolboxScaleHint}
        value={finalScale}
        min={0.6}
        max={1.2}
        step={0.05}
        onChange={(v) => onOverride('scale', Number(v))}
      />
      <ToggleRow
        label={t.studioToolboxInvert}
        hint={t.studioToolboxInvertHint}
        checked={finalInvert}
        onChange={(v) => onOverride('invert', v)}
      />
      <SliderRow
        label={t.studioToolboxContrast}
        hint={t.studioToolboxContrastHint}
        value={finalContrast}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => onOverride('contrast', Number(v))}
      />
      <SliderRow
        label={t.studioToolboxSaturate}
        hint={t.studioToolboxSaturateHint}
        value={finalSaturate}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => onOverride('saturate', Number(v))}
      />

      {/* Section: 视觉效果 / Effects (new in P0-1) */}
      <SectionHeader>{t.studioToolboxEffectsSection}</SectionHeader>
      <SliderRow
        label={t.studioToolboxDim}
        hint={t.studioToolboxDimHint}
        value={finalDim}
        min={0}
        max={0.85}
        step={0.05}
        onChange={(v) => onOverride('dim', Number(v))}
      />
      <SliderRow
        label={t.studioToolboxContentOpacity}
        hint={t.studioToolboxContentOpacityHint}
        value={finalOpacity}
        min={0.1}
        max={1}
        step={0.05}
        onChange={(v) => onOverride('opacity', Number(v))}
      />

      {/* Summary of effective values */}
      <div className="mt-2  p-2 bg-muted">
        <p
          className="mb-1 text-[10px] font-normal "
          style={{ letterSpacing: '0.12em', color: 'var(--muted-foreground)' }}
        >
          {t.studioToolboxCurrentProps}
        </p>
        <div className="space-y-0.5">
          {[
            [`accent: ${finalAccent}`, `bg: ${finalBg}`],
            [`fg: ${finalFg}`, `surface: ${finalSurface}`],
            [`radius: ${finalRadius}`, `spacing: ${Math.round(finalSpacing)}px`],
            [`border: ${finalBorder}px`, `lh: ${finalLh}`],
            [`shadow: ${finalShadow}`, `blur: ${finalBlur}px`],
            [`font: ${finalFontSize}px`, finalFontFam.split(',')[0]?.trim()],
            [`motion: ${finalDuration}`, finalTiming],
            [
              `scale: ${finalScale}`,
              `${finalInvert ? 'inv ' : ''}c${finalContrast}/s${finalSaturate}`,
            ],
            [
              `dim: ${(finalDim * 100).toFixed(0)}%`,
              `opacity: ${(finalOpacity * 100).toFixed(0)}%`,
            ],
          ].map(([k, v]) => (
            <p key={k} className="flex items-center justify-between font-mono text-[10px]">
              <span style={{ color: 'var(--muted-foreground)' }}>{k}</span>
              <span className="ml-2 truncate" style={{ color: 'var(--foreground)' }}>
                {v}
              </span>
            </p>
          ))}
        </div>
      </div>

      {Object.keys(overrides ?? {}).length > 0 && (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
          {t.studioToolboxExportNote}
        </p>
      )}
    </div>
  );
}

export { computeSignature, fingerprintFromSnapshot, ToolboxPanel };
