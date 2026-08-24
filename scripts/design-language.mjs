// SPDX-License-Identifier: MPL-2.0
//
// # design-language.mjs — design language registry and CSS generation (no I/O).
//
// Pure functions that resolve a manifest's designLanguage /
// designLanguageConfig into a normalized object and emit the corresponding
// CSS custom-property block (--agentskin-space-* / --agentskin-radius-* /
// --agentskin-shadow-float / --agentskin-duration-*). Consumed by the theme
// generators so every agent inherits the same spacing / radius / shadow /
// motion language without re-declaring the mapping in each generator.

// ---------------------------------------------------------------------------
// Preset registry
// ---------------------------------------------------------------------------

/** Design-language presets. Each preset declares density (spacing multiplier),
 *  radius scale (px), shadow elevation, and motion speed (ms). Themes reference
 *  a preset by id via manifest.designLanguage. */
export const DESIGN_LANGUAGES = Object.freeze({
  'default': {
    id: 'default',
    label: 'Default',
    spacing: { density: 'comfortable' },
    radius: { scale: '2' },
    shadow: { elevation: 'float' },
    motion: { speed: 'fast' },
  },
  'soft-rounded': {
    id: 'soft-rounded',
    label: 'Soft Rounded',
    spacing: { density: 'cozy' },
    radius: { scale: '8' },
    shadow: { elevation: 'subtle' },
    motion: { speed: 'smooth' },
  },
  'compact-flat': {
    id: 'compact-flat',
    label: 'Compact Flat',
    spacing: { density: 'compact' },
    radius: { scale: '0' },
    shadow: { elevation: 'flat' },
    motion: { speed: 'instant' },
  },
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Fallback values when manifest declares neither designLanguage nor
 *  designLanguageConfig — matches the default preset. */
export const DL_DEFAULTS = Object.freeze({
  spacing: { density: 'comfortable' },
  radius: { scale: '2' },
  shadow: { elevation: 'float' },
  motion: { speed: 'fast' },
});

// ---------------------------------------------------------------------------
// Mapping tables
// ---------------------------------------------------------------------------

/** Spacing density multipliers applied to the 4px grid base values. */
export const SPACING_MULTIPLIERS = Object.freeze({
  compact: 0.75,
  comfortable: 1,
  cozy: 1.25,
});

/** 4px grid base spacing scale (px). Mirrors design-tokens.md spacing tokens. */
export const SPACING_BASE = Object.freeze([4, 8, 16, 24, 32, 48]);

/** Radius scale values (px). */
export const RADIUS_VALUES = Object.freeze({
  0: 0,
  2: 2,
  4: 4,
  8: 8,
});

/** Shadow elevation presets (CSS box-shadow value). */
export const SHADOW_VALUES = Object.freeze({
  flat: 'none',
  subtle: '0 1px 3px rgba(0,0,0,0.08)',
  float: '0 4px 16px rgba(0,0,0,0.12)',
});

/** Motion speed presets (ms). */
export const MOTION_VALUES = Object.freeze({
  instant: 0,
  fast: 100,
  smooth: 200,
});

// ---------------------------------------------------------------------------
// Preview helpers — shared by UI panels and theme generators
// ---------------------------------------------------------------------------

/** Compute the `--agentskin-space-3` value (SPACING_BASE[2] × multiplier). */
export function spacingPx(density) {
  const mult = SPACING_MULTIPLIERS[density ?? 'comfortable'];
  const px = SPACING_BASE[2] * mult; // index 2 = 16px base
  return `${parseFloat(px.toFixed(1))}px`;
}

/** Map a radius scale key to its pixel value. */
export function radiusPx(scale) {
  const rp = { 0: 0, 2: 2, 4: 4, 8: 8 };
  return `${rp[scale ?? '2']}px`;
}

/** Resolve a shadow elevation key to its CSS box-shadow value. */
export function shadowValue(elevation) {
  return SHADOW_VALUES[elevation ?? 'float'];
}

/** Map a motion speed key to its millisecond value. */
export function motionMs(speed) {
  const mp = { instant: 0, fast: 100, smooth: 200 };
  return `${mp[speed ?? 'fast']}ms`;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a manifest's design-language configuration.
 *
 * Priority: manifest.designLanguageConfig (inline override) >
 *           manifest.designLanguage (preset id lookup) >
 *           DL_DEFAULTS (fallback).
 *
 * @param {Object} manifest - theme manifest (may be undefined).
 * @returns {{ spacing: { density: string }, radius: { scale: string },
 *             shadow: { elevation: string }, motion: { speed: string } }}
 */
export function resolveDesignLanguage(manifest) {
  if (!manifest) return DL_DEFAULTS;

  // Inline config takes precedence — merge over defaults so partial configs
  // still produce a complete, valid result.
  if (manifest.designLanguageConfig) {
    return {
      spacing: {
        density: manifest.designLanguageConfig.spacing?.density ?? DL_DEFAULTS.spacing.density,
      },
      radius: {
        scale: String(manifest.designLanguageConfig.radius?.scale ?? DL_DEFAULTS.radius.scale),
      },
      shadow: {
        elevation: manifest.designLanguageConfig.shadow?.elevation ?? DL_DEFAULTS.shadow.elevation,
      },
      motion: { speed: manifest.designLanguageConfig.motion?.speed ?? DL_DEFAULTS.motion.speed },
    };
  }

  // Preset reference — fall back to defaults if the id is unknown.
  const preset = DESIGN_LANGUAGES[manifest.designLanguage];
  if (preset) {
    return {
      spacing: { density: preset.spacing.density },
      radius: { scale: String(preset.radius.scale) },
      shadow: { elevation: preset.shadow.elevation },
      motion: { speed: preset.motion.speed },
    };
  }

  return DL_DEFAULTS;
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

/**
 * Generate the design-language CSS custom-property block.
 *
 * Emits --agentskin-space-* (6-step spacing scale), --agentskin-radius-{sm,md,lg},
 * --agentskin-shadow-float, and --agentskin-duration-{fast,smooth,normal}.
 *
 * @param {Object} dl - resolved design-language config (from resolveDesignLanguage).
 * @param {string} [host=':root'] - CSS selector to scope the variables under.
 * @returns {string} CSS custom-property block.
 */
export function designLanguageBlock(dl, host = ':root') {
  const density = dl?.spacing?.density ?? DL_DEFAULTS.spacing.density;
  const scale = String(dl?.radius?.scale ?? DL_DEFAULTS.radius.scale);
  const elevation = dl?.shadow?.elevation ?? DL_DEFAULTS.shadow.elevation;
  const speed = dl?.motion?.speed ?? DL_DEFAULTS.motion.speed;

  // Optimization: when the resolved config matches defaults, emit nothing.
  // This keeps existing themes' CSS byte-identical so --verify stays green.
  const isDefault =
    density === DL_DEFAULTS.spacing.density &&
    scale === DL_DEFAULTS.radius.scale &&
    elevation === DL_DEFAULTS.shadow.elevation &&
    speed === DL_DEFAULTS.motion.speed;
  if (isDefault) return '';

  // Spacing: multiply each base grid value by the density factor.
  const multiplier = SPACING_MULTIPLIERS[density] ?? SPACING_MULTIPLIERS.comfortable;
  const space = SPACING_BASE.map((v) => `${Math.round(v * multiplier)}px`);

  // Radius: derive sm / md / lg from the named scale.
  const rScale = RADIUS_VALUES[scale] ?? RADIUS_VALUES['2'];
  const radiusSm = Math.max(0, rScale - 1);
  const radiusMd = rScale;
  const radiusLg = Math.min(8, rScale + 4);

  // Shadow: direct elevation lookup (flat = 'none').
  const shadow = SHADOW_VALUES[elevation] ?? SHADOW_VALUES.float;

  // Motion: base duration from speed, normal = max(dur * 2, 50ms).
  const dur = MOTION_VALUES[speed] ?? MOTION_VALUES.fast;
  const durNormal = Math.max(dur * 2, 50);

  return `${host} {
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
  --agentskin-duration-smooth: ${dur === 0 ? 100 : dur + 100}ms;
  --agentskin-duration-normal: ${durNormal}ms;
}`;
}
