// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabThemeEditor
 *
 * Visual theme editor for the Studio center tab.
 *
 * Combines two panels:
 *   1. Design Language controls — spacing density, radius scale, shadow
 *      elevation, motion speed — with a live CSS variable preview bar
 *      at the top showing the exact output of `designLanguageBlock`.
 *   2. Colour Token display — the 14 manifest color tokens rendered as
 *      swatches with hex values and WCAG contrast badges. Clicking a
 *      swatch nudges the hue by +30° (cycles through 12 steps).
 *
 * Data sources:
 *   · themeStore.designLanguage / setDesignLanguage
 *   · themeStore.selection (for the active theme's manifest colors)
 *
 * Script imports:
 *   · design-language.mjs → designLanguageBlock, resolveDesignLanguage,
 *     SPACING_MULTIPLIERS, SPACING_BASE, SHADOW_VALUES, MOTION_VALUES
 *   · extended-colors.mjs → wcagCheck
 */

import { useMemo, useState } from 'react';
import { hexToHsl, hslToHex } from '@/components/studio/harmony';
import { useThemeStore } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import {
  motionMs,
  radiusPx,
  SHADOW_VALUES,
  SPACING_BASE,
  SPACING_MULTIPLIERS,
  shadowValue,
  spacingPx,
} from '../../../../../scripts/design-language.mjs';
import { wcagCheck } from '../../../../../scripts/extended-colors.mjs';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type SpacingDensity = 'compact' | 'comfortable' | 'cozy';
type RadiusScale = '0' | '2' | '4' | '8';
type ShadowElevation = 'flat' | 'subtle' | 'float';
type MotionSpeed = 'instant' | 'fast' | 'smooth';

/** The 14 canonical token keys from THEME_SPEC §"colors 颜色令牌". */
const COLOR_TOKENS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
] as const;

// ---------------------------------------------------------------------------
// HSL hue-rotation helper (delegates to shared color utilities)
// ---------------------------------------------------------------------------

/** Rotate a hex color's hue by `deg` degrees (default 30). Returns new hex. */
function rotateHue(hex: string, deg = 30): string {
  const hsl = hexToHsl(hex);
  const newH = (hsl.h + deg + 360) % 360;
  return hslToHex({ ...hsl, h: newH });
}

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
            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
              isSelected
                ? 'border-primary bg-card2 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40'
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
// WCAGContrastPill — inline ratio display
// ---------------------------------------------------------------------------

function WCAGContrastPill({ fgHex, bgHex }: { fgHex: string; bgHex: string }) {
  const { ratio, passesAA, passesAAA } = wcagCheck(fgHex, bgHex);
  const ratioText = `${ratio.toFixed(1)}:1`;

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className={passesAA ? 'text-cr-success' : 'text-destructive'}>{ratioText}</span>
      {passesAAA && (
        <span className="rounded-md bg-cr-success/15 px-1 text-[9px] font-normal leading-none text-cr-success">
          AAA
        </span>
      )}
      {!passesAA && (
        <span className="rounded-md bg-destructive/15 px-1 text-[9px] font-normal leading-none text-destructive">
          AA
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CenterTabThemeEditor({ t }: { t: UiMessages }) {
  const designLanguage = useThemeStore((s) => s.designLanguage);
  const setDesignLanguage = useThemeStore((s) => s.setDesignLanguage);
  const selection = useThemeStore((s) => s.selection);

  // Local hue-offset map: token key → number of 30° steps rotated.
  const [hueOffsets, setHueOffsets] = useState<Record<string, number>>({});

  const density = designLanguage.spacing?.density;
  const scale = designLanguage.radius?.scale;
  const elevation = designLanguage.shadow?.elevation;
  const speed = designLanguage.motion?.speed;

  // --- Live CSS variable preview -----------------------------------------
  const cssPreview = useMemo(() => {
    const mult = SPACING_MULTIPLIERS[density ?? 'comfortable'];
    const space = SPACING_BASE.map((v) => `${Math.round(v * mult)}px`);
    const rp = { '0': 0, '2': 2, '4': 4, '8': 8 } as const;
    const rScale = rp[scale ?? '2'];
    const radiusSm = Math.max(0, rScale - 1);
    const radiusMd = rScale;
    const radiusLg = Math.min(8, rScale + 4);
    const shadow = SHADOW_VALUES[elevation ?? 'float'];
    const dur = motionMs(speed).replace('ms', '');
    const durNum = Number(dur);
    const durNormal = Math.max(durNum * 2, 50);

    return `:root {
  --agentskin-space-1: ${space[0]};
  --agentskin-space-2: ${space[1]};
  --agentskin-space-3: ${space[2]};
  --agentskin-space-4: ${space[3]};
  --agentskin-space-5: ${space[4]};
  --agentskin-space-6: ${space[5]};
  --agentskin-radius-sm: ${radiusSm}px;
  --agentskin-radius-md: ${radiusMd}px;
  --agentskin-radius-lg: ${radiusLg}px;
  --agentskin-shadow-float: ${shadow};
  --agentskin-duration-base: ${dur}ms;
  --agentskin-duration-smooth: ${durNum === 0 ? 100 : durNum + 100}ms;
  --agentskin-duration-normal: ${durNormal}ms;
}`;
  }, [density, scale, elevation, speed]);

  // --- Color tokens from selection ---------------------------------------
  const colorTokens = useMemo(() => {
    const colors = selection?.kind === 'installed' ? selection.theme.colors : undefined;
    if (!colors) return [];

    return COLOR_TOKENS.filter((key) => colors[key]).map((key) => {
      const baseHex = colors[key];
      const steps = hueOffsets[key] ?? 0;
      const displayHex = steps === 0 ? baseHex : rotateHueN(baseHex, steps);
      return { key, baseHex, displayHex };
    });
  }, [selection, hueOffsets]);

  function handleTokenClick(tokenKey: string) {
    setHueOffsets((prev) => ({
      ...prev,
      [tokenKey]: ((prev[tokenKey] ?? 0) + 1) % 12,
    }));
  }

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-surface p-4">
      {/* Header */}
      <div>
        <h3 className="text-[11px] font-normal text-foreground">
          {t.studioTabTheme ?? 'Theme Editor'}
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t.studioTabThemeDesc ??
            'Visual theme editor — adjust design language parameters and inspect color token contrast.'}
        </p>
      </div>

      {/* Live CSS preview bar */}
      <div className="mt-4 rounded-md border border-border bg-card p-4">
        <h4 className="text-[11px] font-normal text-foreground">
          {t.studioDLCssPreview ?? 'CSS Variables'}
        </h4>
        <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-muted-foreground">
          {cssPreview}
        </pre>
      </div>

      {/* Design Language controls */}
      <div className="mt-4 space-y-4">
        {/* Spacing Density */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-normal text-foreground">
              {t.studioDLSpacing ?? 'Spacing Density'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/40">
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
            <span className="text-[11px] font-normal text-foreground">
              {t.studioDLRadius ?? 'Radius Scale'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/40">
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
                    r === scale ? 'border-primary bg-card2' : 'border-border bg-card'
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
            <span className="text-[11px] font-normal text-foreground">
              {t.studioDLShadow ?? 'Shadow Elevation'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/40">
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
              className="h-6 w-6 rounded-md border border-border bg-card"
              style={{ boxShadow: 'var(--shadow-float)' }}
            />
          </div>
        </div>

        {/* Motion Speed */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-normal text-foreground">
              {t.studioDLMotion ?? 'Motion Speed'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/40">
              --agentskin-duration-base: {motionMs(speed)}
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

      {/* Color Token display */}
      <div className="mt-4 rounded-md border border-border bg-card p-4">
        <h4 className="text-[11px] font-normal text-foreground">
          {t.studioThemeColors ?? 'Color Tokens (14)'}
        </h4>
        <p className="mt-1 text-[11px] text-muted-foreground/40">
          {t.studioThemeColorsHint ?? 'Click a swatch to rotate hue +30°'}
        </p>

        {colorTokens.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-[11px] text-muted-foreground/40">
              {t.studioThemeNoSelection ?? 'Select a theme to inspect its color tokens.'}
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {colorTokens.map(({ key, displayHex }) => {
              // Contrast check: token foreground against the theme background.
              const bgColor =
                selection?.kind === 'installed' ? selection.theme.colors?.background : undefined;
              const checkBg = bgColor ?? '#0a0a10';

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleTokenClick(key)}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-left transition-colors hover:border-muted-foreground/40"
                  title={`Click to rotate hue +30°`}
                >
                  {/* Color swatch */}
                  <div
                    className="h-6 w-6 shrink-0 rounded-md border border-border"
                    style={{ backgroundColor: displayHex }}
                  />
                  {/* Token info */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] font-normal text-foreground">
                      {key}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-muted-foreground/40">
                      {displayHex}
                    </div>
                    {/* WCAG contrast pill */}
                    <div className="mt-1">
                      <WCAGContrastPill fgHex={displayHex} bgHex={checkBg} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helper — rotate hue N times (30° per step)
// ---------------------------------------------------------------------------

function rotateHueN(hex: string, steps: number): string {
  let result = hex;
  for (let i = 0; i < steps; i++) {
    result = rotateHue(result);
  }
  return result;
}
