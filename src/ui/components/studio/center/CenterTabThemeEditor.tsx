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
import { useThemeStore } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import {
  SHADOW_VALUES,
  SPACING_BASE,
  SPACING_MULTIPLIERS,
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

type ColorTokenKey = (typeof COLOR_TOKENS)[number];

// ---------------------------------------------------------------------------
// HSL hue-rotation helper
// ---------------------------------------------------------------------------

/** Parse a 6-digit hex string into [r, g, b] (0-255). Returns null on invalid. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

/** Convert [r,g,b] (0-255) → [h (0-360), s (0-100), l (0-100)]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Convert [h, s, l] → [r, g, b] (0-255). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Convert [r,g,b] (0-255) → "#rrggbb". */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Rotate a hex color's hue by `deg` degrees (default 30). Returns new hex. */
function rotateHue(hex: string, deg = 30): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(...rgb);
  const newH = (h + deg + 360) % 360;
  const [nr, ng, nb] = hslToRgb(newH, s, l);
  return rgbToHex(nr, ng, nb);
}

// ---------------------------------------------------------------------------
// Preview helpers — mirror the logic inside designLanguageBlock
// ---------------------------------------------------------------------------

function spacingPx(density: SpacingDensity | undefined): string {
  const mult = SPACING_MULTIPLIERS[density ?? 'comfortable'];
  const px = SPACING_BASE[2] * mult; // index 2 = 16px base
  return `${parseFloat(px.toFixed(1))}px`;
}

function radiusPx(scale: RadiusScale | undefined): string {
  const rp = { '0': 0, '2': 2, '4': 4, '8': 8 } as const;
  return `${rp[scale ?? '2']}px`;
}

function shadowValue(elevation: ShadowElevation | undefined): string {
  return SHADOW_VALUES[elevation ?? 'float'];
}

function motionMs(speed: MotionSpeed | undefined): string {
  const mp = { instant: 0, fast: 100, smooth: 200 } as const;
  return `${mp[speed ?? 'fast']}ms`;
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
            className={`rounded-[2px] border px-2 py-1 font-mono text-[10px] transition-colors ${
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
// WCAGContrastPill — inline ratio display
// ---------------------------------------------------------------------------

function WCAGContrastPill({ fgHex, bgHex }: { fgHex: string; bgHex: string }) {
  const { ratio, passesAA, passesAAA } = wcagCheck(fgHex, bgHex);
  const ratioText = `${ratio.toFixed(1)}:1`;

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px]">
      <span className={passesAA ? 'text-green-500' : 'text-red-500'}>{ratioText}</span>
      {passesAAA && (
        <span className="rounded-sm bg-green-500/15 px-1 text-[9px] font-medium leading-none text-green-500">
          AAA
        </span>
      )}
      {!passesAA && (
        <span className="rounded-sm bg-red-500/15 px-1 text-[9px] font-medium leading-none text-red-500">
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
  --agentskin-duration-fast: ${dur}ms;
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
    <div className="flex h-full flex-col rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      {/* Header */}
      <div>
        <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">
          {t.studioTabTheme ?? 'Theme Editor'}
        </h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioTabThemeDesc ??
            'Visual theme editor — adjust design language parameters and inspect color token contrast.'}
        </p>
      </div>

      {/* Live CSS preview bar */}
      <div className="mt-4 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioDLCssPreview ?? 'CSS Variables'}
        </h4>
        <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {cssPreview}
        </pre>
      </div>

      {/* Design Language controls */}
      <div className="mt-4 space-y-4">
        {/* Spacing Density */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
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
            <span className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
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
            <span className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
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
              className="h-6 w-6 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)]"
              style={{ boxShadow: shadowValue(elevation) }}
            />
          </div>
        </div>

        {/* Motion Speed */}
        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
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

      {/* Color Token display */}
      <div className="mt-4 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioThemeColors ?? 'Color Tokens (14)'}
        </h4>
        <p className="mt-1 font-mono text-[10px] text-[var(--fg-3)]">
          {t.studioThemeColorsHint ?? 'Click a swatch to rotate hue +30°'}
        </p>

        {colorTokens.length === 0 ? (
          <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] p-6 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-3)]">
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
                  className="flex items-center gap-2 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-2 text-left transition-colors hover:border-[var(--fg-3)]"
                  title={`Click to rotate hue +30°`}
                >
                  {/* Color swatch */}
                  <div
                    className="h-6 w-6 shrink-0 rounded-[2px] border border-[var(--border-subtle)]"
                    style={{ backgroundColor: displayHex }}
                  />
                  {/* Token info */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px] font-bold text-[var(--fg-0)]">
                      {key}
                    </div>
                    <div className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
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
