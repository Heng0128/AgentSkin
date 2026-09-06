// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # css-material.mjs — CSS Material Fragment Generator
//
// Generates portable CSS snippets for two material effects:
//
// 1. **Acrylic** — SVG fractalNoise data-URI texture + backdrop-filter blur/saturate
//    over a translucent tint layer. Inspired by fishcold789/Taffy-Codex-Theme-Studio.
//
// 2. **Liquid Glass** — Multi-layer box-shadow (inner highlight + outer dark edge +
//    RGB chromatic dispersion) combined with backdrop-filter blur to simulate a
//    refractive glass surface with adjustable light angle and dispersion strength.
//
// Both materials can be emitted as standalone `::before` / `::after` snippet
// fragments OR wrapped in a complete `.agentskin-surface` rule via
// `generateSurfaceRule()`. The bridge function replaces hardcoded colour literals
// with `var(--agentskin-token-NAME, fallback)` calls to wire into the 14-token
// contract.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the light-angle vector (dx, dy) in CSS pixel offsets.
 * 0deg = up, 90deg = right, 135deg = top-right (default), etc.
 * Returns unit-less multipliers (each component in range [-1, 1]).
 * @param {number} angleDeg
 * @returns {[number, number]} [dx, dy]
 */
function angleVector(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  // CSS y-axis points downward, so we negate sin to get "up = positive".
  return [Math.cos(rad), -Math.sin(rad)];
}

// ---------------------------------------------------------------------------
// Acrylic
// ---------------------------------------------------------------------------

/**
 * Generate an Acrylic (frosted glass) CSS `::before` fragment.
 *
 * The fragment embeds an SVG `fractalNoise` data URI as the background image
 * of a `::before` pseudo-element, then layers a translucent tint and declares
 * the host must establish `position: relative` for the pseudo to anchor.
 *
 * @param {object} options
 * @param {number} [options.blur=20] — backdrop-filter blur radius (px)
 * @param {number} [options.noiseOpacity=0.085] — noise grain opacity (0-1)
 * @param {number} [options.noiseFrequency=0.85] — SVG fractalNoise baseFrequency
 * @param {number} [options.saturation=1.2] — backdrop-filter saturate value
 * @param {string} [options.tintColor='rgba(255,255,255,0.6)'] — tint overlay colour
 * @returns {string} CSS fragment string for use inside a `::before` rule body
 */
export function acrylicMaterial(options = {}) {
  const {
    blur = 20,
    noiseOpacity = 0.085,
    noiseFrequency = 0.85,
    saturation = 1.2,
    tintColor = 'rgba(255,255,255,0.6)',
  } = options;

  // Convert noiseOpacity (0-1) to two-digit hex for the feColorMatrix alpha.
  const _alphaHex = Math.round(Math.max(0, Math.min(1, noiseOpacity)) * 255)
    .toString(16)
    .padStart(2, '0');

  // Inline SVG noise texture as a data URI.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${noiseFrequency}' numOctaves='4' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feFuncA type='table' tableValues='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity} ${noiseOpacity}'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`;

  const dataUri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

  return `content: '' !important;
position: absolute !important;
inset: 0 !important;
z-index: -1 !important;
pointer-events: none !important;
border-radius: inherit !important;
background: ${dataUri} !important;
backdrop-filter: blur(${blur}px) saturate(${saturation}) !important;
-webkit-backdrop-filter: blur(${blur}px) saturate(${saturation}) !important;
background-color: ${tintColor} !important;`;
}

// ---------------------------------------------------------------------------
// Liquid Glass
// ---------------------------------------------------------------------------

/**
 * Generate a Liquid Glass CSS fragment simulating a refractive glass edge.
 *
 * Combines:
 *   - Inner white highlight ring (offset by light angle)
 *   - Inner dark shadow ring (opposite the light angle)
 *   - Outer soft shadow for depth
 *   - RGB chromatic dispersion (three colour-separated overlays)
 *   - backdrop-filter blur for the substrate distortion
 *
 * @param {object} options
 * @param {number} [options.edgeWidth=2] — inner edge highlight width (px)
 * @param {number} [options.refraction=8] — backdrop-filter blur radius (px)
 * @param {number} [options.specular=0.7] — specular highlight intensity (0-1)
 * @param {number} [options.shadowDepth=0.3] — outer shadow darkness (0-1)
 * @param {number} [options.lightAngle=135] — light source angle in degrees
 * @param {number} [options.dispersion=3] — RGB dispersion offset in px (0 disables)
 * @param {number} [options.materialBlur=4] — material internal blur radius (px)
 * @returns {string} CSS fragment string for use inside a rule body
 */
export function liquidGlassMaterial(options = {}) {
  const {
    edgeWidth = 2,
    refraction = 8,
    specular = 0.7,
    shadowDepth = 0.3,
    lightAngle = 135,
    dispersion = 3,
    materialBlur = 4,
  } = options;

  const [dx, dy] = angleVector(lightAngle);
  const specularAlpha = Math.max(0, Math.min(1, specular)).toFixed(3);
  const shadowAlpha = Math.max(0, Math.min(1, shadowDepth)).toFixed(3);

  // Build multi-layer box-shadow.
  const shadows = [
    // Inner highlight (opposite to shadow direction — light side).
    `inset ${(-dx).toFixed(1)}px ${(-dy).toFixed(1)}px ${edgeWidth}px rgba(255,255,255,${specularAlpha})`,
    // Inner dark edge (shadow side).
    `inset ${(dx * 0.6).toFixed(1)}px ${(dy * 0.6).toFixed(1)}px ${edgeWidth}px rgba(0,0,0,${shadowAlpha})`,
    // Outer soft shadow for depth.
    `${(dx * 4).toFixed(1)}px ${(dy * 4).toFixed(1)}px ${refraction * 2}px rgba(0,0,0,${(shadowAlpha * 0.6).toFixed(3)})`,
  ];

  // RGB chromatic displacement when dispersion > 0.
  if (dispersion > 0) {
    const d = dispersion;
    shadows.push(
      `${(-dx * d * 0.3).toFixed(1)}px ${(-dy * d * 0.3).toFixed(1)}px ${(d * 2).toFixed(1)}px rgba(255,0,0,0.06)`,
    );
    shadows.push(
      `${(-dx * d * 0.15).toFixed(1)}px ${(-dy * d * 0.15).toFixed(1)}px ${(d * 1.5).toFixed(1)}px rgba(0,255,0,0.04)`,
    );
    shadows.push(
      `${(-dx * d * 0.45).toFixed(1)}px ${(-dy * d * 0.45).toFixed(1)}px ${(d * 2.5).toFixed(1)}px rgba(0,0,255,0.05)`,
    );
  }

  // Material internal blur is rendered as an inset spread shadow.
  if (materialBlur > 0) {
    shadows.push(`inset 0 0 ${materialBlur}px rgba(0,0,0,0.02)`);
  }

  return `content: '' !important;
position: absolute !important;
inset: 0 !important;
z-index: 1 !important;
pointer-events: none !important;
border-radius: inherit !important;
backdrop-filter: blur(${refraction}px) !important;
-webkit-backdrop-filter: blur(${refraction}px) !important;
box-shadow: ${shadows.join(',\n    ')} !important;
background-color: rgba(255,255,255,0.05) !important;`;
}

// ---------------------------------------------------------------------------
// Complete surface rule
// ---------------------------------------------------------------------------

/**
 * Generate a complete `.agentskin-surface` CSS rule that wraps the chosen
 * material inside positioning / base-styling scaffolding.
 *
 * @param {'acrylic'|'liquid-glass'} type
 * @param {object} options — forwarded to the matching material function
 * @returns {string} Full CSS rule block: `.agentskin-surface { ... }`
 */
export function generateSurfaceRule(type, options = {}) {
  const isAcrylic = type === 'acrylic';
  const materialCss = isAcrylic ? acrylicMaterial(options) : liquidGlassMaterial(options);

  if (isAcrylic) {
    return `.agentskin-surface {
  position: relative !important;
  isolation: isolate !important;
}

.agentskin-surface::before {
  ${materialCss}
}`;
  }

  return `.agentskin-surface {
  position: relative !important;
  isolation: isolate !important;
}

.agentskin-surface::after {
  ${materialCss}
}`;
}

// ---------------------------------------------------------------------------
// Token bridge
// ---------------------------------------------------------------------------

/**
 * Replace hardcoded colour literals inside `materialCss` with
 * `var(--agentskin-token-NAME, fallback)` calls.
 *
 * Supported token names (keys in `tokenMap`):
 *   - 'surface', 'overlay', 'bg', 'text', 'muted', 'accent', 'border'
 *
 * The function matches whole colour occurrences (hex, rgb(a), hsl(a) forms)
 * and replaces them. Unknown / unmatched colours are left intact.
 *
 * @param {string} materialCss — raw CSS string from a material function
 * @param {Record<string,string>} [tokenMap={}] — map of semantic token → CSS var name
 * @returns {string} Bridged CSS with var() fallbacks
 */
export function bridgeMaterialToTokens(materialCss, tokenMap = {}) {
  if (!materialCss) return '';

  let result = materialCss;

  // Map of recognized colour patterns → token replacement.
  // Each entry: [regex, tokenNameKey]
  // We iterate in a deterministic order so overlapping patterns resolve consistently.
  const replacements = [
    // rgba(255,255,255,<a>)  →  --agentskin-surface
    [/\brgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[\d.]+\s*\)/gi, 'surface'],
    // rgba(0,0,0,<a>)  →  --agentskin-overlay
    [/\brgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/gi, 'overlay'],
    // rgba(255,0,0,<a>) / green / blue → chromatic tokens
    [/\brgba\(\s*255\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/gi, 'accent'],
    [/\brgba\(\s*0\s*,\s*255\s*,\s*0\s*,\s*[\d.]+\s*\)/gi, 'secondary'],
    [/\brgba\(\s*0\s*,\s*0\s*,\s*255\s*,\s*[\d.]+\s*\)/gi, 'border'],
  ];

  for (const [pattern, tokenKey] of replacements) {
    const varName = tokenMap[tokenKey];
    if (!varName) continue;
    // Preserve the original matched colour as the fallback.
    result = result.replace(pattern, (match) => `var(${varName}, ${match})`);
  }

  return result;
}
