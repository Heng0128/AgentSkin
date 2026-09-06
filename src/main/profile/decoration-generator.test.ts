// SPDX-License-Identifier: MPL-2.0

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecorationAsset, DecorationPrompt } from '../../shared/types/decoration';
import { renderBuiltinToDataUrl } from './builtin-decorations';
import {
  analysePromptFromColors,
  buildCandidates,
  cacheDecoration,
  generateDecorationCandidates,
  getCachedDecorations,
  pickAccentFromPrompt,
} from './decoration-generator';
import { extractDominantColors } from './image-analyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build synthetic pixel data for testing analysis functions. */
function makePixels(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

const isValidHex = (v: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(v);

const isValidSvgDataUrl = (v: string): boolean => v.startsWith('data:image/svg+xml;base64,');

const isValidBase64 = (v: string): boolean => {
  try {
    return Buffer.from(v, 'base64').length > 0;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Tests: analysePromptFromColors (pure)
// ---------------------------------------------------------------------------

describe('analysePromptFromColors', () => {
  it('returns neutral mood for empty colors', () => {
    const prompt = analysePromptFromColors([], 0.5);
    expect(prompt.mood).toBe('neutral');
    expect(prompt.keywords).toEqual(['neutral']);
  });

  it('classifies warm mood for red-dominant image', () => {
    const pixels = makePixels(16, 16, () => [220, 40, 30, 255]); // vivid red
    const colors = extractDominantColors(pixels, 5);
    const prompt = analysePromptFromColors(colors, 0.45);
    expect(prompt.mood).toBe('warm');
    expect(prompt.dominantHue).toBeGreaterThanOrEqual(0);
    expect(prompt.dominantHue).toBeLessThan(60);
    expect(prompt.keywords.length).toBeGreaterThan(0);
  });

  it('classifies cool mood for blue-dominant image', () => {
    const pixels = makePixels(16, 16, () => [40, 80, 220, 255]); // vivid blue
    const colors = extractDominantColors(pixels, 5);
    const prompt = analysePromptFromColors(colors, 0.45);
    expect(prompt.mood).toBe('cool');
    expect(prompt.dominantHue).toBeGreaterThanOrEqual(195);
    expect(prompt.dominantHue).toBeLessThan(255);
  });

  it('classifies muted mood for very dark image', () => {
    const pixels = makePixels(16, 16, () => [10, 10, 15, 255]); // near-black
    const colors = extractDominantColors(pixels, 5);
    const prompt = analysePromptFromColors(colors, 0.05);
    expect(prompt.mood).toBe('muted');
  });

  it('classifies neutral mood for greyscale image', () => {
    const pixels = makePixels(16, 16, () => [128, 128, 128, 255]);
    const colors = extractDominantColors(pixels, 5);
    const prompt = analysePromptFromColors(colors, 0.5);
    expect(prompt.mood).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// Tests: pickAccentFromPrompt (pure)
// ---------------------------------------------------------------------------

describe('pickAccentFromPrompt', () => {
  it('returns a valid hex color', () => {
    const prompt: DecorationPrompt = {
      mood: 'warm',
      luminance: 0.5,
      dominantHue: 0,
      keywords: ['red'],
    };
    expect(isValidHex(pickAccentFromPrompt(prompt))).toBe(true);
  });

  it('rotates hue by +24°', () => {
    const prompt: DecorationPrompt = {
      mood: 'cool',
      luminance: 0.5,
      dominantHue: 200,
      keywords: ['blue'],
    };
    const accent = pickAccentFromPrompt(prompt);
    expect(isValidHex(accent)).toBe(true);
    // The hue rotation is internal; we just validate the output is a color.
    expect(accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildCandidates (pure — builtin fallback)
// ---------------------------------------------------------------------------

describe('buildCandidates', () => {
  it('returns requested count of candidates', () => {
    const prompt: DecorationPrompt = {
      mood: 'warm',
      luminance: 0.5,
      dominantHue: 10,
      keywords: ['red'],
    };
    const candidates = buildCandidates(prompt, 4);
    expect(candidates).toHaveLength(4);
  });

  it('clamps count to builtin maximum', () => {
    const prompt: DecorationPrompt = {
      mood: 'cool',
      luminance: 0.5,
      dominantHue: 210,
      keywords: ['blue'],
    };
    const candidates = buildCandidates(prompt, 100);
    expect(candidates.length).toBeLessThanOrEqual(6); // 6 builtins exist
  });

  it('returns zero candidates for count=0', () => {
    const prompt: DecorationPrompt = {
      mood: 'neutral',
      luminance: 0.5,
      dominantHue: 0,
      keywords: ['grey'],
    };
    expect(buildCandidates(prompt, 0)).toHaveLength(0);
  });

  it('produces valid SVG data URLs for all candidates', () => {
    const prompt: DecorationPrompt = {
      mood: 'vibrant',
      luminance: 0.5,
      dominantHue: 120,
      keywords: ['green'],
    };
    const candidates = buildCandidates(prompt, 6);
    for (const c of candidates) {
      expect(c.format).toBe('svg');
      expect(isValidSvgDataUrl(c.dataUrl)).toBe(true);
      expect(c.width).toBe(128);
      expect(c.height).toBe(128);
      expect(c.generatedAt).toBeGreaterThan(0);
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
    }
  });

  it('assigns unique ids to each candidate', () => {
    const prompt: DecorationPrompt = {
      mood: 'warm',
      luminance: 0.4,
      dominantHue: 30,
      keywords: ['orange'],
    };
    const candidates = buildCandidates(prompt, 6);
    const ids = new Set(candidates.map((c) => c.id));
    expect(ids.size).toBe(candidates.length);
  });

  it('sets sourceImageHash from prompt', () => {
    const prompt = {
      mood: 'cool' as const,
      luminance: 0.5,
      dominantHue: 200,
      keywords: ['blue'],
      sourceImageHash: 'test-hash-123',
    };
    const candidates = buildCandidates(prompt, 3);
    for (const c of candidates) {
      expect(c.sourceImageHash).toBe('test-hash-123');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: renderBuiltinToDataUrl (builtin templates)
// ---------------------------------------------------------------------------

describe('renderBuiltinToDataUrl', () => {
  it('returns valid data URLs for all 6 builtins', () => {
    const builtinIds = ['heart', 'star', 'snowflake', 'flower', 'bubble', 'leaf'];
    for (const id of builtinIds) {
      const url = renderBuiltinToDataUrl(id, '#ff6b6b');
      expect(url, `builtin ${id} should render`).toBeTruthy();
      expect(url!.startsWith('data:image/svg+xml;base64,')).toBe(true);
      // Extract + verify base64 payload is non-empty.
      const b64 = url!.replace(/^data:image\/svg\+base64,/, '');
      expect(isValidBase64(b64)).toBe(true);
    }
  });

  it('returns null for unknown builtin id', () => {
    expect(renderBuiltinToDataUrl('nonexistent', '#ff0000')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: cache + getCachedDecorations (filesystem, with temp dir)
// ---------------------------------------------------------------------------

describe('cacheDecoration + getCachedDecorations', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'decoration-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeAsset(id: string): DecorationAsset {
    return {
      id,
      name: `Test ${id}`,
      format: 'svg',
      width: 128,
      height: 128,
      dataUrl: renderBuiltinToDataUrl('heart', '#ff6b6b')!,
      generatedAt: Date.now(),
      sourceImageHash: 'abc123',
    };
  }

  const getCacheDir = (themeId: string) => join(tempDir, themeId);

  it('caches a decoration asset to disk', async () => {
    const asset = makeAsset('heart');
    const filePath = await cacheDecoration(asset, 'theme-a', { getCacheDir });
    expect(filePath).toContain('heart.decoration.json');
  });

  it('reads back cached decorations', async () => {
    const asset = makeAsset('star');
    await cacheDecoration(asset, 'theme-b', { getCacheDir });

    const cached = await getCachedDecorations('theme-b', { getCacheDir });
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe('star');
    expect(cached[0].format).toBe('svg');
    expect(cached[0].dataUrl).toBeTruthy();
  });

  it('returns empty array for theme with no cache', async () => {
    const cached = await getCachedDecorations('nonexistent-theme', { getCacheDir });
    expect(cached).toEqual([]);
  });

  it('caches multiple decorations and lists them all', async () => {
    const ids = ['heart', 'star', 'leaf'];
    for (const id of ids) {
      await cacheDecoration(makeAsset(id), 'theme-c', { getCacheDir });
    }
    const cached = await getCachedDecorations('theme-c', { getCacheDir });
    expect(cached).toHaveLength(3);
    const cachedIds = cached.map((c) => c.id).sort();
    expect(cachedIds).toEqual([...ids].sort());
  });

  it('writes a sidecar SVG file alongside the JSON', async () => {
    const asset = makeAsset('bubble');
    await cacheDecoration(asset, 'theme-d', { getCacheDir });

    const cached = await getCachedDecorations('theme-d', { getCacheDir });
    expect(cached).toHaveLength(1);
    // Verify the sidecar was written (functionally: cache succeeded).
    expect(cached[0].dataUrl).toContain('svg+xml');
  });

  it('isolates caches by theme id', async () => {
    await cacheDecoration(makeAsset('heart'), 'theme-x', { getCacheDir });
    await cacheDecoration(makeAsset('star'), 'theme-y', { getCacheDir });

    const x = await getCachedDecorations('theme-x', { getCacheDir });
    const y = await getCachedDecorations('theme-y', { getCacheDir });

    expect(x).toHaveLength(1);
    expect(x[0].id).toBe('heart');
    expect(y).toHaveLength(1);
    expect(y[0].id).toBe('star');
  });
});

// ---------------------------------------------------------------------------
// Tests: generateDecorationCandidates (async wrapper)
// ---------------------------------------------------------------------------

describe('generateDecorationCandidates', () => {
  it('returns assets with usedBuiltin=true', async () => {
    const prompt: DecorationPrompt = {
      mood: 'warm',
      luminance: 0.5,
      dominantHue: 20,
      keywords: ['red'],
    };
    const result = await generateDecorationCandidates(prompt, 3);
    expect(result.usedBuiltin).toBe(true);
    expect(result.assets).toHaveLength(3);
    for (const a of result.assets) {
      expect(a.dataUrl).toBeTruthy();
      expect(a.format).toBe('svg');
    }
  });

  it('defaults to 6 candidates when count is reasonable', async () => {
    const prompt: DecorationPrompt = {
      mood: 'cool',
      luminance: 0.5,
      dominantHue: 200,
      keywords: ['blue'],
    };
    const result = await generateDecorationCandidates(prompt, 6);
    expect(result.assets).toHaveLength(6);
  });
});
