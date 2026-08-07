// SPDX-License-Identifier: MPL-2.0

/**
 * # token-extractor — Runtime CSS Token Extraction Pipeline
 *
 * Samples a live page's DOM via CDP `Runtime.evaluate`, reads the computed
 * style of each visible element for a curated set of design-relevant
 * properties, and clusters the extracted values into typed tokens:
 *
 *   - **colors**  → frequency-ranked `ColorToken[]` (the dominant palette:
 *                    the most-used background / accent / text colors). Colors
 *                    are normalized to uppercase `#RRGGBB` so `rgb()`,
 *                    `hsl()`, and named colors that map to the same RGB merge
 *                    into a single bucket.
 *   - **fonts**   → `FontToken[]` (font-family + the sizes it appears at).
 *   - **spacings**→ `SpacingToken[]` (margin / padding / gap values, ranked).
 *   - **shadows** / **radii** → deduplicated raw strings for surface depth
 *                    and corner-radius analysis.
 *
 * The extraction is best-evaluate: any per-property failure (no such
 * computed property, page navigated away) skips that element, so the
 * function always returns a result rather than throwing on a malformed
 * page.
 *
 * The page-side walk runs in a single `Runtime.evaluate` round-trip (the
 * same strategy as `dom-tree.ts`) — fast even for deep DOMs — and returns
 * a JSON string that this class parses and tokenizes. No CDP `send()` is
 * needed, so the extractor works against any object that satisfies
 * `Pick<CdpSession, 'evaluate'>`, making it trivially mockable in tests.
 */

import { parseColor, toHex } from '../profile/color-quantize';
import type { CdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalized color with original value, hex, frequency, and CSS contexts. */
export interface ColorToken {
  /** The canonical hex form used for dedup (e.g. "#FF453A"). */
  value: string;
  /** Same as `value` — explicit alias matching the spec. */
  hex: string;
  /** How many elements used this exact color. */
  frequency: number;
  /** CSS properties where this color was observed (e.g. "background-color"). */
  contexts: string[];
}

/** Font family with the computed sizes it appeared at across the sample. */
export interface FontToken {
  family: string;
  frequency: number;
  sizes: string[];
}

/** Spacing dimension (margin / padding / gap) ranked by frequency. */
export interface SpacingToken {
  value: string;
  frequency: number;
}

/** Final output bundle from a single `sample()` call. */
export interface ExtractedTokens {
  /** Which agent this extraction was performed on. */
  agentId: string;
  /** ISO-8601 timestamp of when the sample was taken. */
  extractedAt: string;
  colors: ColorToken[];
  fonts: FontToken[];
  spacings: SpacingToken[];
  shadows: string[];
  radii: string[];
}

// ---------------------------------------------------------------------------
// Sampled element shape (JSON coming back from the page-side walk)
// ---------------------------------------------------------------------------

interface SampledColors {
  color?: string;
  backgroundColor?: string;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  outlineColor?: string;
  columnRuleColor?: string;
  textDecorationColor?: string;
  caretColor?: string;
}

interface SampledShadows {
  boxShadow?: string;
  textShadow?: string;
}

interface SampledRadii {
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderBottomRightRadius?: string;
}

interface SampledFonts {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
}

interface SampledSpacings {
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  gap?: string;
}

/** One element's extracted style slots. */
interface SampledElement {
  tag: string;
  colors: SampledColors;
  shadows: SampledShadows;
  radii: SampledRadii;
  fonts: SampledFonts;
  spacings: SampledSpacings;
}

// ---------------------------------------------------------------------------
// Property lists (kebab-case for getPropertyValue)
// ---------------------------------------------------------------------------

const COLOR_PROPS: ReadonlyArray<[keyof SampledColors, string]> = [
  ['color', 'color'],
  ['backgroundColor', 'background-color'],
  ['borderTopColor', 'border-top-color'],
  ['borderRightColor', 'border-right-color'],
  ['borderBottomColor', 'border-bottom-color'],
  ['borderLeftColor', 'border-left-color'],
  ['outlineColor', 'outline-color'],
  ['columnRuleColor', 'column-rule-color'],
  ['textDecorationColor', 'text-decoration-color'],
  ['caretColor', 'caret-color'],
];

const SHADOW_PROPS: ReadonlyArray<[keyof SampledShadows, string]> = [
  ['boxShadow', 'box-shadow'],
  ['textShadow', 'text-shadow'],
];

const RADIUS_PROPS: ReadonlyArray<[keyof SampledRadii, string]> = [
  ['borderTopLeftRadius', 'border-top-left-radius'],
  ['borderTopRightRadius', 'border-top-right-radius'],
  ['borderBottomLeftRadius', 'border-bottom-left-radius'],
  ['borderBottomRightRadius', 'border-bottom-right-radius'],
];

const SPACING_PROPS: ReadonlyArray<[keyof SampledSpacings, string]> = [
  ['paddingTop', 'padding-top'],
  ['paddingRight', 'padding-right'],
  ['paddingBottom', 'padding-bottom'],
  ['paddingLeft', 'padding-left'],
  ['marginTop', 'margin-top'],
  ['marginRight', 'margin-right'],
  ['marginBottom', 'margin-bottom'],
  ['marginLeft', 'margin-left'],
  ['gap', 'gap'],
];

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * HSL/HSLA → RGB. Returns null when the input does not match the CSS
 * `hsl()` / `hsla()` production.
 */
function tryParseHsl(input: string): { r: number; g: number; b: number; a: number } | null {
  const m =
    /^hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(
      input,
    );
  if (!m) return null;
  const h = (((parseFloat(m[1]) % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, parseFloat(m[2]) / 100));
  const l = Math.min(1, Math.max(0, parseFloat(m[3]) / 100));
  let a = 1;
  if (m[4] !== undefined) {
    a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    a = Math.min(1, Math.max(0, a));
  }
  const { r, g, b } = hslToRgb(h, s, l);
  return { r, g, b, a };
}

/** HSL (h: 0-1, s: 0-1, l: 0-1) → RGB (0-255 each). */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  };
}

function hueToChannel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/**
 * Extract the first color-like fragment from a compound CSS value such as
 * `linear-gradient(...)` or `box-shadow(...)`. Falls back to null when no
 * `#hex`, `rgb()`, or `hsl()` token is found.
 */
function extractFirstColorFragment(value: string): string | null {
  // 6-digit hex
  const hex6 = /#[0-9a-fA-F]{6}\b/.exec(value);
  if (hex6) return hex6[0];
  // 3-digit hex
  const hex3 = /#[0-9a-fA-F]{3}\b/.exec(value);
  if (hex3) return hex3[0];
  // rgba / rgb
  const rgb = /rgba?\([^)]+\)/i.exec(value);
  if (rgb) return rgb[0];
  // hsla / hsl
  const hsl = /hsla?\([^)]+\)/i.exec(value);
  return hsl ? hsl[0] : null;
}

/**
 * Normalize an arbitrary CSS value to an uppercase `#RRGBB` string.
 *
 * Supports the same inputs as {@link parseColor} (hex, rgb, rgba, named
 * colors, transparent) plus hsl/hsla and the first color fragment of
 * compound values (gradients, multi-layer shadows). Returns null for
 * unparseable or fully-transparent values so callers can skip them.
 */
export function normalizeColor(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed === 'transparent' ||
    trimmed === 'none' ||
    trimmed === 'initial' ||
    trimmed === 'inherit' ||
    trimmed === 'currentcolor' ||
    trimmed === 'rgba(0, 0, 0, 0)'
  ) {
    return null;
  }

  // 1. Direct parse (hex / rgb / rgba / named)
  const direct = parseColor(trimmed);
  if (direct) {
    if (direct.a < 0.05) return null; // skip transparent
    return hexUpper(direct.r, direct.g, direct.b);
  }

  // 2. HSL / HSLA
  const hslParsed = tryParseHsl(trimmed);
  if (hslParsed) {
    if (hslParsed.a < 0.05) return null;
    return hexUpper(hslParsed.r, hslParsed.g, hslParsed.b);
  }

  // 3. Compound value — extract the first embedded color fragment
  const fragment = extractFirstColorFragment(trimmed);
  if (fragment && fragment !== trimmed) {
    return normalizeColor(fragment);
  }

  return null;
}

function hexUpper(r: number, g: number, b: number): string {
  return `#${toHex({ r, g, b }).slice(1).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Page-side sampling script builder
// ---------------------------------------------------------------------------

/** Tags that carry no visible styles — skipped to avoid noise. */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'META',
  'LINK',
  'HEAD',
  'TITLE',
  'HTML',
  'SVG',
  'PATH',
  'DEFS',
  'CLIPPATH',
]);

/**
 * Build the IIFE that runs inside the page via `Runtime.evaluate`. It walks
 * `body *`, skips invisible / blacklisted elements, reads computed styles for
 * the curated property lists, and returns a JSON string with **camelCase**
 * object keys (e.g. `backgroundColor`, `borderTopColor`).
 *
 * `getPropertyValue()` requires the hyphenated (kebab-case) CSS name, so the
 * script maps each camelCase key back to its kebab form at call time. The
 * returned object uses camelCase keys so the consumer
 * ({@link TokenExtractor.classifyColors} etc.) can look them up directly by
 * the type-safe {@link SampledColors} / {@link SampledSpacings} field names.
 *
 * The function is self-contained (no closures over outer scope) so it can be
 * stringified into an evaluate expression without capturing anything.
 */
function buildSamplingScript(maxNodes: number): string {
  // [camelKey, kebabKey] pairs for every category — kebabKey is used for
  // getPropertyValue, camelKey is used as the resulting object key.
  const COLOR_KV = COLOR_PROPS.map(([c, k]) => `${c}:${k}`).join(',');
  const SHADOW_KV = SHADOW_PROPS.map(([c, k]) => `${c}:${k}`).join(',');
  const RADIUS_KV = RADIUS_PROPS.map(([c, k]) => `${c}:${k}`).join(',');
  const SPACING_KV = SPACING_PROPS.map(([c, k]) => `${c}:${k}`).join(',');
  const FONT_KV = `fontFamily:font-family,fontSize:font-size,fontWeight:font-weight`;

  return `(function(maxNodes){var skip=${JSON.stringify([...SKIP_TAGS])};var cProps={${COLOR_KV}};var sProps={${SHADOW_KV}};var rProps={${RADIUS_KV}};var fProps={${FONT_KV}};var pProps={${SPACING_KV}};var out=[];try{var nodes=document.querySelectorAll('body, body *');for(var i=0;i<nodes.length&&out.length<maxNodes;i++){var el=nodes[i];if(skip.indexOf(el.tagName)>=0)continue;var rect=el.getBoundingClientRect();if(rect.width===0&&rect.height===0)continue;var cs=window.getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0)continue;var sample={tag:el.tagName.toLowerCase(),colors:{},shadows:{},radii:{},fonts:{},spacings:{}};for(var ck in cProps){if(Object.prototype.hasOwnProperty.call(cProps,ck)){var cv=cs.getPropertyValue(cProps[ck]);if(cv&&cv!=='transparent'&&cv!=='rgba(0, 0, 0, 0)'&&cv!=='initial')sample.colors[ck]=cv}}for(var sk in sProps){if(Object.prototype.hasOwnProperty.call(sProps,sk)){var sv=cs.getPropertyValue(sProps[sk]);if(sv&&sv!=='none')sample.shadows[sk]=sv}}for(var rk in rProps){if(Object.prototype.hasOwnProperty.call(rProps,rk)){var rv=cs.getPropertyValue(rProps[rk]);if(rv&&rv!=='0px')sample.radii[rk]=rv}}for(var fk in fProps){if(Object.prototype.hasOwnProperty.call(fProps,fk)){sample.fonts[fk]=cs.getPropertyValue(fProps[fk])}}for(var pk in pProps){if(Object.prototype.hasOwnProperty.call(pProps,pk)){var pv=cs.getPropertyValue(pProps[pk]);if(pv&&(pv!=='0px'||pk==='gap'))sample.spacings[pk]=pv}}out.push(sample)}}catch(e){}return JSON.stringify(out)})(${maxNodes})`;
}

// ---------------------------------------------------------------------------
// TokenExtractor
// ---------------------------------------------------------------------------

/**
 * Extracts design tokens from a live agent page. Constructed with a CDP
 * session (or any object providing `evaluate`) and an agentId; call
 * {@link sample} to run the extraction. Stateless between calls — safe to
 * reuse for repeated sampling.
 */
export class TokenExtractor {
  constructor(
    private readonly session: Pick<CdpSession, 'evaluate'>,
    private readonly agentId: string,
  ) {}

  /**
   * Sample up to `maxNodes` visible elements and extract their tokens.
   * Never throws: a failed evaluate or malformed JSON returns an empty
   * {@link ExtractedTokens} (array fields are `[]`, timestamp is set).
   */
  async sample(opts?: { maxNodes?: number }): Promise<ExtractedTokens> {
    const maxNodes = opts?.maxNodes ?? 80;
    const script = buildSamplingScript(maxNodes);

    let elements: SampledElement[] = [];
    try {
      const raw = await this.session.evaluate(script);
      if (raw && raw !== 'null') {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          elements = parsed as SampledElement[];
        }
      }
    } catch {
      // Page unavailable or evaluation failed — return empty result.
    }

    return {
      agentId: this.agentId,
      extractedAt: new Date().toISOString(),
      colors: this.classifyColors(elements),
      fonts: this.classifyFonts(elements),
      spacings: this.classifySpacings(elements),
      shadows: this.collectShadows(elements),
      radii: this.collectRadii(elements),
    };
  }

  // --- Private classification helpers -----------------------------------

  /**
   * Walk every sampled element, extract color values from all color and
   * shadow properties, normalize to hex, and cluster by frequency.
   * Colors from `box-shadow` / `text-shadow` are included because a shadow's
   * color is a meaningful design token even if the shadow geometry itself
   * is captured separately.
   */
  private classifyColors(elements: SampledElement[]): ColorToken[] {
    const freq = new Map<string, { count: number; contexts: Set<string> }>();

    for (const el of elements) {
      // Direct color properties
      for (const [camelProp, kebabProp] of COLOR_PROPS) {
        const raw = el.colors[camelProp];
        if (!raw) continue;
        const hex = normalizeColor(raw);
        if (!hex) continue;
        const existing = freq.get(hex) ?? { count: 0, contexts: new Set<string>() };
        existing.count++;
        existing.contexts.add(kebabProp);
        freq.set(hex, existing);
      }
      // Embedded colors inside shadows (the shadow color itself is a token)
      for (const [camelProp, kebabProp] of SHADOW_PROPS) {
        const raw = el.shadows[camelProp as keyof SampledShadows];
        if (!raw || raw === 'none') continue;
        const hex = normalizeColor(raw);
        if (!hex) continue;
        const existing = freq.get(hex) ?? { count: 0, contexts: new Set<string>() };
        existing.count++;
        existing.contexts.add(kebabProp);
        freq.set(hex, existing);
      }
    }

    return [...freq.entries()]
      .map(([hex, { count, contexts }]) => ({
        value: hex,
        hex,
        frequency: count,
        contexts: [...contexts],
      }))
      .sort((a, b) => b.frequency - a.frequency || a.hex.localeCompare(b.hex));
  }

  /** Cluster font-family by frequency, collecting distinct sizes per family. */
  private classifyFonts(elements: SampledElement[]): FontToken[] {
    const freq = new Map<string, { count: number; sizes: Set<string> }>();
    for (const el of elements) {
      const raw = el.fonts.fontFamily;
      if (!raw) continue;
      // Take the first family in the CSS font-family stack
      const family = raw.split(',')[0].replace(/["']/g, '').trim();
      if (!family) continue;
      const size = el.fonts.fontSize ?? '';
      const existing = freq.get(family) ?? { count: 0, sizes: new Set<string>() };
      existing.count++;
      if (size) existing.sizes.add(size);
      freq.set(family, existing);
    }

    return [...freq.entries()]
      .map(([family, { count, sizes }]) => ({
        family,
        frequency: count,
        sizes: [...sizes],
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  /** Collect non-zero spacing dimensions (margin / padding / gap). */
  private classifySpacings(elements: SampledElement[]): SpacingToken[] {
    const freq = new Map<string, number>();
    for (const el of elements) {
      for (const [camelProp] of SPACING_PROPS) {
        const raw = el.spacings[camelProp as keyof SampledSpacings];
        if (!raw || raw === '0px' || raw === 'auto') continue;
        freq.set(raw, (freq.get(raw) ?? 0) + 1);
      }
    }

    return [...freq.entries()]
      .map(([value, count]) => ({ value, frequency: count }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  /** Deduplicated list of non-"none" shadow strings. */
  private collectShadows(elements: SampledElement[]): string[] {
    const seen = new Set<string>();
    for (const el of elements) {
      for (const raw of Object.values(el.shadows)) {
        if (raw) seen.add(raw);
      }
    }
    return [...seen];
  }

  /** Deduplicated list of non-"0px" radius strings. */
  private collectRadii(elements: SampledElement[]): string[] {
    const seen = new Set<string>();
    for (const el of elements) {
      for (const raw of Object.values(el.radii)) {
        if (raw) seen.add(raw);
      }
    }
    return [...seen];
  }
}
