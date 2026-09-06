// SPDX-License-Identifier: MPL-2.0

/**
 * # Decoration Generator
 *
 * Core engine for the "AI 装饰生成器 (一次性 + 本地缓存)" feature (P1-1).
 *
 * ## Design
 *
 * The generator follows a **one-shot + local cache** model:
 *
 *   1. **Analyse** a source wallpaper / image → extract a {@link DecorationPrompt}
 *      (mood, luminance, dominant hue, keywords). Uses the existing pure-TS
 *      `image-analyzer` on top of Electron `nativeImage` pixel decoding.
 *   2. **Generate** candidate {@link DecorationAsset} decorations from the
 *      prompt. In the default (no-API) path this simply instantiates the
 *      builtin SVG templates with the image's dominant accent colour. An
 *      optional AI hook (`generateWithAi`) is reserved for future use — the
 *      architecture never *requires* an external API key.
 *   3. **Cache** resulting assets to the theme's decoration directory so
 *      re-analysing the same image (same SHA-256) is a cheap cache hit.
 *
 * The module is split into:
 *
 *   - **Pure functions** (`analysePromptFromColors`, `pickAccentFromPrompt`,
 *     `buildCandidates`) — zero I/O, fully unit-testable.
 *   - **Effectful functions** (`analyseImageForDecoration`, `generateDecorationCandidates`,
 *     `cacheDecoration`, `getCachedDecorations`) — touch the filesystem via
 *     injected helpers so tests can run without Electron.
 */

import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type {
  DecorationAsset,
  DecorationGenerateResult,
  DecorationPrompt,
} from '../../shared/types/decoration';
import {
  BUILTIN_DECORATIONS,
  BUILTIN_DIMENSION,
  renderBuiltinToDataUrl,
} from './builtin-decorations';
import { toHex } from './color-quantize';
import { extractDominantColors, type PixelData } from './image-analyzer';

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

/**
 * Decoration-specific dependencies injected so the public API functions
 * remain unit-testable without Electron `nativeImage` or a real filesystem.
 */
export interface DecorationDeps {
  /**
   * Resolve the root cache directory for a given theme id.
   * Defaults to `<userData>/decorations/<themeId>`.
   */
  getCacheDir?: (themeId: string) => string;
}

/** Default cache-dir resolver: `<themeUserData>/<themeId>/decorations`. */
function defaultCacheDir(themeId: string): string {
  // Lazy import `app` to keep this module import-safe in tests that stub
  // the filesystem. `app.getPath` is only called at runtime, not load time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'decorations', themeId, 'assets');
  } catch {
    // Non-Electron context (e.g. plain-node test harness without deps).
    return path.join('.agentskin-decoration-cache', themeId);
  }
}

// ---------------------------------------------------------------------------
// 1. Analysis — pure
// ---------------------------------------------------------------------------

/**
 * Convert raw analysis results into a structured {@link DecorationPrompt}.
 *
 * Pure function — no I/O. Dominant colours come from `image-analyzer`'s
 * `extractDominantColors` (median-cut clustering).
 *
 * @param dominantColors  Output of `extractDominantColors` (sorted by weight).
 * @param luminance       Global average luminance [0, 1].
 */
export function analysePromptFromColors(
  dominantColors: ReturnType<typeof extractDominantColors>,
  luminance: number,
): DecorationPrompt {
  if (dominantColors.length === 0) {
    return {
      mood: 'neutral',
      luminance,
      dominantHue: 0,
      keywords: ['neutral'],
    };
  }

  const primary = dominantColors[0];
  const hsl = rgbToHsl(primary.color.r, primary.color.g, primary.color.b);

  // Mood classification from hue + saturation. The buckets are intentionally
  // coarse — decorations are suggestive, not photorealistic.
  const mood = classifyMood(hsl.h, hsl.s, luminance);

  // Keywords derived from the top-2 dominant hues (used for future AI prompts).
  const keywords = dominantColors.slice(0, 2).map((c) => {
    const h = rgbToHsl(c.color.r, c.color.g, c.color.b);
    return hueToKeyword(h.h);
  });

  return {
    mood,
    luminance,
    dominantHue: Math.round(hsl.h),
    keywords,
  };
}

/** Classify image mood from hue + saturation + luminance. */
function classifyMood(h: number, s: number, l: number): DecorationPrompt['mood'] {
  if (s < 0.1) return 'neutral';
  if (l < 0.25 || l > 0.85) return 'muted';
  // Warm hues: red/orange/yellow (0–60) and magenta→red (300–360). These
  // always map to 'warm' regardless of saturation — vivid red is still
  // "warm", not a generic "vibrant". The same symmetry holds for cool.
  if ((h >= 0 && h < 60) || h >= 300) return 'warm';
  // Cool hues: yellow-green through green, cyan, blue, indigo (60–270).
  // Cerulean blue (220°) is firmly cool.
  if (h >= 60 && h < 270) return 'cool';
  // Narrow middle band (270–300): violet/purple that sits between warm
  // and cool. Use "vibrant" only when saturation is high AND luminance
  // is mid-range; otherwise fall back to "cool".
  return s > 0.6 && l > 0.3 && l < 0.7 ? 'vibrant' : 'cool';
}

/** Map a hue in degrees to a coarse colour keyword. */
function hueToKeyword(h: number): string {
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  if (h < 345) return 'pink';
  return 'red';
}

/** RGB → HSL (local, no shared dependency; same algorithm as tonal-palette). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h: ((h % 360) + 360) % 360, s, l };
}

// ---------------------------------------------------------------------------
// 1b. Analysis — effectful (image file → prompt)
// ---------------------------------------------------------------------------

/**
 * Decode an image file and produce a {@link DecorationPrompt}.
 *
 * Uses Electron `nativeImage` for format-agnostic decoding (PNG/JPEG/WebP/
 * BMP/GIF). Falls back gracefully: an unreadable image yields a neutral
 * prompt rather than throwing.
 *
 * @param imagePath  Absolute path to the image file.
 */
export async function analyseImageForDecoration(imagePath: string): Promise<DecorationPrompt> {
  const hash = await hashFile(imagePath);

  let prompt: DecorationPrompt;
  try {
    const pixels = decodeImageToPixels(imagePath);
    if (!pixels) {
      return { mood: 'neutral', luminance: 0.5, dominantHue: 0, keywords: ['neutral'] };
    }
    const colors = extractDominantColors(pixels, 5);
    const luminance = averageLuminance(pixels);
    prompt = analysePromptFromColors(colors, luminance);
  } catch {
    prompt = { mood: 'neutral', luminance: 0.5, dominantHue: 0, keywords: ['neutral'] };
  }

  // Attach the hash so the caller can use it as a cache key.
  return { ...prompt, sourceImageHash: hash } as DecorationPrompt & {
    sourceImageHash: string;
  };
}

/** Decode an image via Electron nativeImage → PixelData. Returns null on failure. */
function decodeImageToPixels(imagePath: string): PixelData | null {
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (!size || size.width <= 0 || size.height <= 0) return null;

  // Down-sample: longest edge = 48 px (matches wallpaper-theme convention).
  const scale = Math.min(1, 48 / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const resized = image.resize({ width, height });
  if (resized.isEmpty()) return null;

  const bitmap = resized.toBitmap(); // BGRA
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = bitmap[o + 2]; // R
    data[o + 1] = bitmap[o + 1]; // G
    data[o + 2] = bitmap[o]; // B
    data[o + 3] = bitmap[o + 3]; // A
  }
  return { data, width, height };
}

/** Compute global average luminance [0, 1] from pixel data. */
function averageLuminance(p: PixelData): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] < 8) continue; // skip transparent
    sum += (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255;
    count++;
  }
  return count > 0 ? sum / count : 0.5;
}

/** SHA-256 hex digest of a file (used as cache key). */
async function hashFile(filePath: string): Promise<string> {
  try {
    const buf = await fsp.readFile(filePath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return `unsafe-${Date.now()}`;
  }
}

// ---------------------------------------------------------------------------
// 2. Generation — pure
// ---------------------------------------------------------------------------

/**
 * Choose an accent colour (hex) from the prompt by rotating the dominant hue
 * by +24° (analogous harmony) and boosting saturation for vibrancy.
 */
export function pickAccentFromPrompt(prompt: DecorationPrompt): string {
  const h = (prompt.dominantHue + 24) % 360;
  const s = prompt.mood === 'muted' ? 0.35 : 0.7;
  const l = prompt.luminance > 0.5 ? 0.45 : 0.6;
  return hslToHex(h, s, l);
}

/** HSL → hex (local helper). */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex({
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  });
}

/**
 * Build candidate {@link DecorationAsset} list from a prompt using builtin
 * SVG templates. This is the **default (no-API) path** and always succeeds.
 *
 * @param prompt  The decoration prompt (mood / hue / luminance).
 * @param count   Maximum candidates to return (clamped to builtin count).
 */
export function buildCandidates(prompt: DecorationPrompt, count: number): DecorationAsset[] {
  const accent = pickAccentFromPrompt(prompt);
  const sourceHash =
    (prompt as DecorationPrompt & { sourceImageHash?: string }).sourceImageHash ??
    `builtin-${Date.now()}`;
  const now = Date.now();
  const n = Math.max(0, Math.min(count, BUILTIN_DECORATIONS.length));

  return BUILTIN_DECORATIONS.slice(0, n).map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    format: 'svg' as const,
    width: BUILTIN_DIMENSION,
    height: BUILTIN_DIMENSION,
    dataUrl: renderBuiltinToDataUrl(tpl.id, accent) ?? '',
    generatedAt: now,
    sourceImageHash: sourceHash,
  }));
}

// ---------------------------------------------------------------------------
// 2b. Generation — effectful
// ---------------------------------------------------------------------------

/**
 * Generate candidate decorations from a prompt.
 *
 * Currently always uses the builtin templates (no API key required). The
 * signature reserves `useAi` + optional `apiKey` for a future external
 * generator — callers that omit them get the builtin fallback.
 *
 * @param prompt  The decoration prompt.
 * @param count   Maximum number of candidate decorations to return.
 */
export async function generateDecorationCandidates(
  prompt: DecorationPrompt,
  count: number,
): Promise<DecorationGenerateResult> {
  const assets = buildCandidates(prompt, count);
  return { assets, usedBuiltin: true };
}

// ---------------------------------------------------------------------------
// 3. Cache — effectful
// ---------------------------------------------------------------------------

/**
 * Persist a decoration asset to the on-disk cache for the given theme.
 *
 * The asset is written as a JSON `.decoration` file containing the metadata
 * + the data URL. A separate copy of the data URL is also written alongside
 * as `<id>.svg` for direct filesystem reference.
 *
 * @param asset   The decoration asset to cache.
 * @param themeId Target theme id (determines the cache subdirectory).
 * @param deps    Optional dependency overrides (for testing).
 * @returns       Absolute path of the cached asset JSON file.
 */
export async function cacheDecoration(
  asset: DecorationAsset,
  themeId: string,
  deps: DecorationDeps = {},
): Promise<string> {
  const dir = deps.getCacheDir?.(themeId) ?? defaultCacheDir(themeId);
  await fsp.mkdir(dir, { recursive: true });

  const assetFile = path.join(dir, `${asset.id}.decoration.json`);
  const payload = JSON.stringify(asset, null, 2);
  await fsp.writeFile(assetFile, payload, 'utf8');

  // Sidecar: write the raw SVG render for direct filesystem use.
  if (asset.format === 'svg') {
    const b64 = asset.dataUrl.replace(/^data:image\/svg\+xml;base64,/, '');
    await fsp.writeFile(path.join(dir, `${asset.id}.svg`), Buffer.from(b64, 'base64'));
  } else if (asset.format === 'png') {
    const b64 = asset.dataUrl.replace(/^data:image\/png;base64,/, '');
    await fsp.writeFile(path.join(dir, `${asset.id}.png`), Buffer.from(b64, 'base64'));
  }

  return assetFile;
}

/**
 * Read all cached decorations for a theme.
 *
 * Scans the theme's cache directory for `*.decoration.json` files, parsing
 * each into a {@link DecorationAsset}. Malformed files are skipped (best-
 * effort) so a single corrupt cache entry does not break listing.
 *
 * @param themeId  Target theme id.
 * @param deps     Optional dependency overrides (for testing).
 */
export async function getCachedDecorations(
  themeId: string,
  deps: DecorationDeps = {},
): Promise<DecorationAsset[]> {
  const dir = deps.getCacheDir?.(themeId) ?? defaultCacheDir(themeId);

  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const assets: DecorationAsset[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.decoration.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, entry), 'utf8');
      const parsed = JSON.parse(raw) as DecorationAsset;
      // Minimal structural guard.
      if (parsed.id && parsed.dataUrl) assets.push(parsed);
    } catch {
      // Skip malformed entry.
    }
  }
  return assets;
}

/**
 * Look up a single cached decoration by its SHA-256 source image hash.
 * Returns the first matching asset, or null on a cache miss.
 *
 * @param themeId  Target theme id.
 * @param hash     SHA-256 hex digest of the source image.
 * @param deps     Optional dependency overrides.
 */
export async function findCachedByHash(
  themeId: string,
  hash: string,
  deps: DecorationDeps = {},
): Promise<DecorationAsset | null> {
  const all = await getCachedDecorations(themeId, deps);
  return all.find((a) => a.sourceImageHash === hash) ?? null;
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { DecorationAsset, DecorationPrompt } from '../../shared/types/decoration';
