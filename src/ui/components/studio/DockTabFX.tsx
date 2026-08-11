// SPDX-License-Identifier: MPL-2.0

/**
 * # DockTabFX
 *
 * Bottom dock "FX" tab — 8-dimension override controls rendered as
 * Swiss slider cards in a horizontal scrolling layout.
 *
 * Sections: Color / Shape / Type / Motion / Filter / Effects
 *
 * Each card is 160×72px with 1px border and 6px radius.
 * Overrides are written through `studioStore.setOverride`.
 * Palette presets are persisted to localStorage.
 */

import { useEffect, useState } from 'react';
import { ColorCard, SelectCard, SliderCard, ToggleCard } from '@/components/studio/dock-internals';
import { Kicker } from '@/components/studio/kicker';
import { computeSignature } from '@/components/studio/Toolbox';
import type { PalettePreset } from '@/lib/palettePresets';
import { loadPalettePresets, savePalettePreset } from '@/lib/palettePresets';
import { useStudioStore } from '@/stores/studioStore';
import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';

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

const easingOptions = [
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(.68,-.55,.27,1.55)',
];

/** Convert an rgb()/rgba() computed value to #rrggbb. Returns null on parse failure. */
function rgbToHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
  const m = trimmed.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());
  const r = Number.parseInt(parts[0], 10);
  const g = Number.parseInt(parts[1], 10);
  const b = Number.parseInt(parts[2], 10);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function DockTabFX({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const setOverride = useStudioStore((s) => s.setOverride);
  const resetOverrides = useStudioStore((s) => s.resetOverrides);
  const setPaletteLoaded = useStudioStore((s) => s.setPaletteLoaded);

  const [presets, setPresets] = useState<PalettePreset[]>([]);
  const [presetName, setPresetName] = useState('');

  // Derive signature from snapshot (only when snapshot exists)
  const sig = snapshot ? computeSignature(snapshot) : null;

  const refreshPresets = () => setPresets(loadPalettePresets());
  useEffect(() => {
    setPresets(loadPalettePresets());
  }, []);

  if (!sig || !snapshot) {
    return (
      <div className="flex items-center justify-center h-full font-mono text-[10px] text-[var(--fg-2)]">
        {t.studioInspectorEmpty}
      </div>
    );
  }

  // Resolve final values: override wins over original
  const finalRadius = toolOverrides?.radius ?? sig.radius.primary;
  const finalSpacing = toolOverrides?.spacing ?? sig.spacing.avgPadding;
  const finalShadow = toolOverrides?.shadowLevel ?? sig.shadow.level;
  const finalBlur = toolOverrides?.blurPx ?? 0;
  const finalFontSize =
    toolOverrides?.fontSize ??
    Math.round(
      sig.font.sizes.length > 0
        ? sig.font.sizes.reduce((sum, s) => sum + (parseFloat(s) || 0), 0) / sig.font.sizes.length
        : 14,
    );
  const finalDuration = toolOverrides?.duration ?? sig.motion.defaultDuration;
  const finalTiming = toolOverrides?.timing ?? sig.motion.defaultTiming;

  const finalAccent = toolOverrides?.accent ?? rgbToHex(sig.color.accents[0]) ?? '#3b82f6';
  const finalBg =
    toolOverrides?.background ??
    rgbToHex(sig.color.rootBackground || sig.color.backgrounds[0]) ??
    '#ffffff';
  const finalFg =
    toolOverrides?.foreground ?? rgbToHex(sig.color.rootColor || sig.color.texts[0]) ?? '#111111';
  const finalSurface =
    toolOverrides?.surface ??
    rgbToHex(sig.color.backgrounds[1] || sig.color.backgrounds[0]) ??
    '#f5f5f5';

  const finalBorder = toolOverrides?.borderWidth ?? 1;
  const finalLh = toolOverrides?.lineHeight ?? 1.5;
  const finalScale = toolOverrides?.scale ?? 1;
  const finalSep = toolOverrides?.separators ?? true;
  const finalInvert = toolOverrides?.invert ?? false;
  const finalContrast = toolOverrides?.contrast ?? 1;
  const finalSaturate = toolOverrides?.saturate ?? 1;
  const finalDim = toolOverrides?.dim ?? 0;
  const finalOpacity = toolOverrides?.opacity ?? 1;
  const finalGrad = toolOverrides?.gradientAccent ?? false;

  const overrides = toolOverrides as ToolOverride | null;

  const handleReset = (key: keyof ToolOverride) => () => {
    setOverride(key, undefined);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    savePalettePreset(name, toolOverrides?.colors ?? {});
    setPresetName('');
    refreshPresets();
  };
  // preset deletion handled inline in JSX below

  return (
    <div className="ws-dock__content">
      {/* Presets panel */}
      <div className="flex-shrink-0 w-[160px] space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxMyPalette}</Kicker>
        <div className="flex items-center gap-[var(--space-1)]">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder={t.studioToolboxPresetNamePlaceholder}
            className="h-6 min-w-0 flex-1 border border-[var(--border-subtle)] bg-[var(--bg-3)] px-2 font-mono text-[10px] outline-none"
            style={{ borderRadius: 'var(--r-micro)' }}
          />
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={!presetName.trim() || !toolOverrides?.colors}
            className="ws-btn ws-btn--sm"
          >
            {t.studioToolboxSavePreset}
          </button>
        </div>
        {presets.length > 0 && (
          <div className="space-y-[2px]">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-[var(--space-1)] border border-[var(--border-subtle)] px-1.5 py-1"
                style={{ borderRadius: 'var(--r-micro)' }}
              >
                <div className="flex shrink-0 overflow-hidden rounded-[2px] border border-[var(--border-subtle)]">
                  {['accent', 'background', 'foreground', 'surface'].map((k) =>
                    p.colors[k] ? (
                      <span key={k} className="block size-3" style={{ background: p.colors[k] }} />
                    ) : null,
                  )}
                </div>
                <span className="flex-1 truncate font-mono text-[9.5px] text-[var(--fg-0)]">
                  {p.name}
                </span>
                <button
                  type="button"
                  onClick={() => setPaletteLoaded(p.colors)}
                  className="h-5 border border-[var(--border-subtle)] px-1 font-mono text-[9px]"
                  style={{ borderRadius: 'var(--r-micro)' }}
                >
                  {t.studioToolboxLoadPreset}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section: Color */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxColorSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <ColorCard
            label={t.studioToolboxAccentColor}
            value={finalAccent}
            overridden={overrides?.accent !== undefined}
            onReset={handleReset('accent')}
            onChange={(v) => setOverride('accent', v)}
          />
          <ColorCard
            label={t.studioToolboxBgColor}
            value={finalBg}
            overridden={overrides?.background !== undefined}
            onReset={handleReset('background')}
            onChange={(v) => setOverride('background', v)}
          />
          <ColorCard
            label={t.studioToolboxFgColor}
            value={finalFg}
            overridden={overrides?.foreground !== undefined}
            onReset={handleReset('foreground')}
            onChange={(v) => setOverride('foreground', v)}
          />
          <ColorCard
            label={t.studioToolboxSurfaceColor}
            value={finalSurface}
            overridden={overrides?.surface !== undefined}
            onReset={handleReset('surface')}
            onChange={(v) => setOverride('surface', v)}
          />
          <ToggleCard
            label={t.studioToolboxGradientBg}
            checked={finalGrad}
            overridden={overrides?.gradientAccent !== undefined}
            onReset={handleReset('gradientAccent')}
            onChange={(v) => setOverride('gradientAccent', v)}
          />
        </div>
      </div>

      {/* Section: Shape */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxShapeSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <SliderCard
            label={t.studioDimRadius}
            displayValue={String(Number(finalRadius) || 0)}
            value={Number(finalRadius) || 0}
            min={0}
            max={24}
            step={1}
            unit="px"
            overridden={overrides?.radius !== undefined}
            onReset={handleReset('radius')}
            onChange={(v) => setOverride('radius', `${v}px`)}
          />
          <SliderCard
            label={t.studioDimSpacing}
            displayValue={String(Math.round(finalSpacing))}
            value={Math.round(finalSpacing)}
            min={0}
            max={32}
            step={1}
            unit="px"
            overridden={overrides?.spacing !== undefined}
            onReset={handleReset('spacing')}
            onChange={(v) => setOverride('spacing', v)}
          />
          <SelectCard
            label={t.studioDimShadow}
            value={finalShadow}
            options={shadowLevels(t).map((s) => ({ label: s.label, value: s.value }))}
            overridden={overrides?.shadowLevel !== undefined}
            onReset={handleReset('shadowLevel')}
            onChange={(v) => setOverride('shadowLevel', v as ToolOverride['shadowLevel'])}
          />
          <SliderCard
            label={t.studioDimBlur}
            displayValue={String(finalBlur)}
            value={finalBlur}
            min={0}
            max={12}
            step={1}
            unit="px"
            overridden={overrides?.blurPx !== undefined}
            onReset={handleReset('blurPx')}
            onChange={(v) => setOverride('blurPx', v)}
          />
          <SliderCard
            label="border"
            displayValue={String(finalBorder)}
            value={finalBorder}
            min={0}
            max={4}
            step={0.5}
            unit="px"
            overridden={overrides?.borderWidth !== undefined}
            onReset={handleReset('borderWidth')}
            onChange={(v) => setOverride('borderWidth', v)}
          />
          <ToggleCard
            label={t.studioToolboxSeparator}
            checked={finalSep}
            overridden={overrides?.separators !== undefined}
            onReset={handleReset('separators')}
            onChange={(v) => setOverride('separators', v)}
          />
        </div>
      </div>

      {/* Section: Typography */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxFontSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <SliderCard
            label={t.studioDimFont}
            displayValue={String(finalFontSize)}
            value={finalFontSize}
            min={10}
            max={20}
            step={0.5}
            unit="px"
            overridden={overrides?.fontSize !== undefined}
            onReset={handleReset('fontSize')}
            onChange={(v) => setOverride('fontSize', v)}
          />
          <SliderCard
            label="line-height"
            displayValue={String(finalLh)}
            value={finalLh}
            min={1}
            max={2.2}
            step={0.05}
            overridden={overrides?.lineHeight !== undefined}
            onReset={handleReset('lineHeight')}
            onChange={(v) => setOverride('lineHeight', v)}
          />
        </div>
      </div>

      {/* Section: Motion */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxMotionSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <SliderCard
            label={`${t.studioDimMotion}`}
            displayValue={finalDuration}
            value={parseFloat(finalDuration) || 0}
            min={0}
            max={2}
            step={0.05}
            unit="s"
            overridden={overrides?.duration !== undefined}
            onReset={handleReset('duration')}
            onChange={(v) => setOverride('duration', `${v}s`)}
          />
          <SelectCard
            label="easing"
            value={finalTiming}
            options={easingOptions.map((e) => ({ label: e, value: e }))}
            overridden={overrides?.timing !== undefined}
            onReset={handleReset('timing')}
            onChange={(v) => setOverride('timing', v)}
          />
        </div>
      </div>

      {/* Section: Filter */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxFilterSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <SliderCard
            label={t.studioToolboxScale}
            displayValue={String(finalScale)}
            value={finalScale}
            min={0.6}
            max={1.2}
            step={0.05}
            overridden={overrides?.scale !== undefined}
            onReset={handleReset('scale')}
            onChange={(v) => setOverride('scale', v)}
          />
          <ToggleCard
            label={t.studioToolboxInvert}
            checked={finalInvert}
            overridden={overrides?.invert !== undefined}
            onReset={handleReset('invert')}
            onChange={(v) => setOverride('invert', v)}
          />
          <SliderCard
            label="contrast"
            displayValue={String(finalContrast)}
            value={finalContrast}
            min={0.5}
            max={2}
            step={0.05}
            overridden={overrides?.contrast !== undefined}
            onReset={handleReset('contrast')}
            onChange={(v) => setOverride('contrast', v)}
          />
          <SliderCard
            label="saturate"
            displayValue={String(finalSaturate)}
            value={finalSaturate}
            min={0}
            max={2}
            step={0.05}
            overridden={overrides?.saturate !== undefined}
            onReset={handleReset('saturate')}
            onChange={(v) => setOverride('saturate', v)}
          />
        </div>
      </div>

      {/* Section: Effects */}
      <div className="flex-shrink-0 space-y-[var(--space-1)]">
        <Kicker>{t.studioToolboxEffectsSection}</Kicker>
        <div className="flex gap-[var(--space-1)]">
          <SliderCard
            label={t.studioToolboxDim}
            displayValue={`${(finalDim * 100).toFixed(0)}%`}
            value={finalDim}
            min={0}
            max={0.85}
            step={0.05}
            overridden={overrides?.dim !== undefined}
            onReset={handleReset('dim')}
            onChange={(v) => setOverride('dim', v)}
          />
          <SliderCard
            label={t.studioToolboxContentOpacity}
            displayValue={`${(finalOpacity * 100).toFixed(0)}%`}
            value={finalOpacity}
            min={0.1}
            max={1}
            step={0.05}
            overridden={overrides?.opacity !== undefined}
            onReset={handleReset('opacity')}
            onChange={(v) => setOverride('opacity', v)}
          />
          <button
            type="button"
            onClick={resetOverrides}
            disabled={!overrides}
            className="ws-btn ws-btn--sm self-end disabled:opacity-30"
          >
            ↺ {t.studioToolboxReset}
          </button>
        </div>
      </div>
    </div>
  );
}
