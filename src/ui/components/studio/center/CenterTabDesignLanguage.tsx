// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabDesignLanguage
 *
 * Studio Design Language visualization panel.
 * Allows interactive adjustment of spacing density, radius scale,
 * shadow elevation, and motion speed. Live CSS variable preview
 * at the bottom reflects the current configuration.
 *
 * Data source: themeStore (designLanguage, setDesignLanguage).
 *
 * Visual style follows Swiss/International design tokens:
 *   · rounded-[var(--dl-radius,2px)] corners
 *   · spacing from the 4/8/16 Tailwind scale only
 *   · typography: text-[10px] mono for body, text-xs for headings
 *   · all colors via CSS custom properties (no bare hex/rgba)
 */

import { useThemeStore } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import {
  motionMs,
  radiusPx,
  shadowValue,
  spacingPx,
} from '../../../../../scripts/design-language.mjs';

// ---------------------------------------------------------------------------
// Segment option types
// ---------------------------------------------------------------------------

type SpacingDensity = 'compact' | 'comfortable' | 'cozy';
type RadiusScale = '0' | '2' | '4' | '8';
type ShadowElevation = 'flat' | 'subtle' | 'float';
type MotionSpeed = 'instant' | 'fast' | 'smooth';

// ---------------------------------------------------------------------------
// SegmentedControl — generic button-group selector
// ---------------------------------------------------------------------------

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  t: labels,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  t?: Record<string, string>;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-[var(--dl-radius,2px)] border px-2 py-1 font-mono text-[10px] transition-colors ${
              isSelected
                ? 'border-[var(--accent)] bg-[var(--bg-surface-elevated)] text-[var(--fg-0)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-2)] text-[var(--fg-2)] hover:border-[var(--fg-3)]'
            }`}
          >
            {labels?.[opt.value] ?? opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CenterTabDesignLanguage({ t }: { t: UiMessages }) {
  const designLanguage = useThemeStore((s) => s.designLanguage);
  const setDesignLanguage = useThemeStore((s) => s.setDesignLanguage);

  const density = designLanguage.spacing?.density;
  const scale = designLanguage.radius?.scale;
  const elevation = designLanguage.shadow?.elevation;
  const speed = designLanguage.motion?.speed;

  return (
    <div className="flex h-full flex-col rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      {/* Header */}
      <div>
        <h3 className="font-mono text-[11px] font-normal text-[var(--fg-0)]">
          {t.studioTabDesignLanguage ?? 'Design Language'}
        </h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioTabDesignLanguageDesc ??
            'Adjust spacing, radius, shadow, and motion parameters for the active theme.'}
        </p>
      </div>

      {/* Controls */}
      <div className="mt-4 space-y-4">
        {/* Spacing Density */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-normal text-[var(--fg-0)]">
              {t.studioDLSpacing ?? 'Spacing Density'}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
              --agentskin-space-3: {spacingPx(density)}
            </span>
          </div>
          <div className="mt-2">
            <SegmentedControl<SpacingDensity>
              options={[
                { value: 'compact', label: 'compact' },
                { value: 'comfortable', label: 'comfortable' },
                { value: 'cozy', label: 'cozy' },
              ]}
              value={density}
              onChange={(v) => setDesignLanguage({ spacing: { density: v } })}
              t={{
                compact: t.studioDLSpacingCompact ?? 'compact (0.75x)',
                comfortable: t.studioDLSpacingComfortable ?? 'comfortable (1x)',
                cozy: t.studioDLSpacingCozy ?? 'cozy (1.25x)',
              }}
            />
          </div>
        </div>

        {/* Radius Scale */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-normal text-[var(--fg-0)]">
              {t.studioDLRadius ?? 'Radius Scale'}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
              --agentskin-radius-md: {radiusPx(scale)}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4">
            <SegmentedControl<RadiusScale>
              options={[
                { value: '0', label: '0' },
                { value: '2', label: '2' },
                { value: '4', label: '4' },
                { value: '8', label: '8' },
              ]}
              value={scale}
              onChange={(v) => setDesignLanguage({ radius: { scale: v } })}
              t={{
                '0': t.studioDLRadius0 ?? '0',
                '2': t.studioDLRadius2 ?? '2',
                '4': t.studioDLRadius4 ?? '4',
                '8': t.studioDLRadius8 ?? '8',
              }}
            />
            {/* Radius preview swatches */}
            <div className="flex items-center gap-2">
              {(['0', '2', '4', '8'] as RadiusScale[]).map((r) => (
                <div
                  key={r}
                  className={`h-4 w-4 border ${
                    r === scale
                      ? 'border-[var(--accent)] bg-[var(--bg-surface-elevated)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-2)]'
                  }`}
                  style={{ borderRadius: `${r}px` }}
                  title={`${r}px`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Shadow Elevation */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-normal text-[var(--fg-0)]">
              {t.studioDLShadow ?? 'Shadow Elevation'}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
              --agentskin-shadow-float: {shadowValue(elevation).slice(0, 24)}...
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4">
            <SegmentedControl<ShadowElevation>
              options={[
                { value: 'flat', label: 'flat' },
                { value: 'subtle', label: 'subtle' },
                { value: 'float', label: 'float' },
              ]}
              value={elevation}
              onChange={(v) => setDesignLanguage({ shadow: { elevation: v } })}
              t={{
                flat: t.studioDLShadowFlat ?? 'flat',
                subtle: t.studioDLShadowSubtle ?? 'subtle',
                float: t.studioDLShadowFloat ?? 'float',
              }}
            />
            {/* Shadow preview swatch */}
            <div
              className="h-6 w-6 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)]"
              style={{ boxShadow: 'var(--shadow-float)' }}
            />
          </div>
        </div>

        {/* Motion Speed */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-normal text-[var(--fg-0)]">
              {t.studioDLMotion ?? 'Motion Speed'}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
              --agentskin-duration-fast: {motionMs(speed)}
            </span>
          </div>
          <div className="mt-2">
            <SegmentedControl<MotionSpeed>
              options={[
                { value: 'instant', label: 'instant' },
                { value: 'fast', label: 'fast' },
                { value: 'smooth', label: 'smooth' },
              ]}
              value={speed}
              onChange={(v) => setDesignLanguage({ motion: { speed: v } })}
              t={{
                instant: t.studioDLMotionInstant ?? 'instant (0ms)',
                fast: t.studioDLMotionFast ?? 'fast (100ms)',
                smooth: t.studioDLMotionSmooth ?? 'smooth (200ms)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Live CSS variable preview */}
      <div className="mt-4 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
        <h4 className="font-mono text-[10px] font-normal text-[var(--fg-0)]">
          {t.studioDLCssPreview ?? 'CSS Variables'}
        </h4>
        <div className="mt-2 space-y-1 font-mono text-[10px] text-[var(--fg-2)]">
          <div>
            <span className="text-[var(--fg-3)]">--agentskin-space-3:</span>{' '}
            <span className="text-[var(--fg-0)]">{spacingPx(density)}</span>
            {';'}
          </div>
          <div>
            <span className="text-[var(--fg-3)]">--agentskin-radius-md:</span>{' '}
            <span className="text-[var(--fg-0)]">{radiusPx(scale)}</span>
            {';'}
          </div>
          <div>
            <span className="text-[var(--fg-3)]">--agentskin-shadow-float:</span>{' '}
            <span className="text-[var(--fg-0)]">{shadowValue(elevation)}</span>
            {';'}
          </div>
          <div>
            <span className="text-[var(--fg-3)]">--agentskin-duration-fast:</span>{' '}
            <span className="text-[var(--fg-0)]">{motionMs(speed)}</span>
            {';'}
          </div>
        </div>
      </div>
    </div>
  );
}
