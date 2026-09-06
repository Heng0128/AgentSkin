// SPDX-License-Identifier: MPL-2.0

/**
 * # Quick Apply Dependencies (Production Wiring)
 *
 * Bridges the Quick Apply engine's injected dependencies to the real main-process
 * services: image decoding via Electron nativeImage, token extraction via the
 * existing palette-extractor, library install via ThemeLibrary, and apply via
 * AgentEngineService.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { AgentId } from '../../shared/types';
import type { QuickApplyTokens } from '../../shared/types/ipc';
import type { MainContext } from '../main-context';
import { extractPalette } from '../palette-extractor';
import { analyzeImage, type PixelData } from '../profile/image-analyzer';
import type { QuickApplyDeps } from './quick-apply-engine';

// ---------------------------------------------------------------------------
// Image decoder (production): uses Electron nativeImage
// ---------------------------------------------------------------------------

/** Maximum dimension for resized decoding (performance cap). */
const MAX_DECODE_DIMENSION = 256;

/**
 * Decode an image file using Electron's nativeImage.
 * Resizes down to MAX_DECODE_DIMENSION for fast analysis while keeping
 * enough pixel data for accurate palette extraction.
 */
export async function decodeImageProduction(filePath: string): Promise<PixelData> {
  const buf = await fs.readFile(filePath);
  let img = nativeImage.createFromBuffer(buf);

  const { width, height } = img.getSize();
  if (width === 0 || height === 0) {
    throw new Error(`Image has zero dimensions: ${filePath}`);
  }

  // Downscale for performance — 256px wide is plenty for palette extraction.
  if (width > MAX_DECODE_DIMENSION || height > MAX_DECODE_DIMENSION) {
    const aspect = height / width;
    const newWidth = Math.min(width, MAX_DECODE_DIMENSION);
    const newHeight = Math.round(newWidth * aspect);
    img = img.resize({ width: newWidth, height: newHeight, quality: 'good' });
  }

  const size = img.getSize();
  // toBitmap() returns raw RGBA bytes.
  const bitmap = img.toBitmap();

  return {
    data: Uint8ClampedArray.from(bitmap),
    width: size.width,
    height: size.height,
  };
}

// ---------------------------------------------------------------------------
// Token extractor (production): reuses palette-extractor
// ---------------------------------------------------------------------------

/** Extract 14 tokens from pixel data using the existing palette-extractor. */
export function extractTokensProduction(
  pixels: PixelData,
  colorCount: number,
  forceMode?: 'light' | 'dark',
): QuickApplyTokens {
  const sample = buildPixelSample(pixels);
  const result = extractPalette(sample, { colorCount, forceMode });
  const t = result.theme;
  return {
    accent: t.accent,
    accentMuted: t.accentMuted,
    secondary: t.secondary,
    background: t.background,
    foreground: t.foreground,
    muted: t.muted,
    surface: t.surface,
    surfaceElevated: t.surfaceElevated,
    border: t.border,
    codeBackground: t.codeBackground,
    codeForeground: t.codeForeground,
    inputBackground: t.inputBackground,
    buttonBackground: t.buttonBackground,
    buttonForeground: t.buttonForeground,
    focusRing: t.focusRing,
  };
}

/**
 * Build a weighted color sample from raw RGBA pixel data.
 * Replicates the down-sampling + median-cut approach used by
 * image-analyzer's extractDominantColors.
 */
function buildPixelSample(pixels: PixelData): {
  colors: Array<{ r: number; g: number; b: number; weight: number }>;
} {
  const { data, width, height } = pixels;
  const totalPixels = width * height;
  const sampleCount = Math.min(4000, totalPixels);
  const step = Math.max(1, Math.floor(totalPixels / sampleCount));
  const colorMap = new Map<string, number>();

  for (let i = 0; i < data.length; i += 4 * step) {
    const r = Math.round(data[i] / 5.1) * 5.1;
    const g = Math.round(data[i + 1] / 5.1) * 5.1;
    const b = Math.round(data[i + 2] / 5.1) * 5.1;
    if (data[i + 3] < 128) continue;
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  const colors = Array.from(colorMap.entries()).map(([key, weight]) => {
    const [r, g, b] = key.split(',').map(Number);
    return { r, g, b, weight };
  });

  return { colors };
}

// ---------------------------------------------------------------------------
// Pixel analysis (production): reuses image-analyzer
// ---------------------------------------------------------------------------

export interface PixelAnalysis {
  dominantColors: string[];
  safeArea: 'left' | 'right' | 'center' | 'none' | 'auto';
  mode: 'light' | 'dark';
  averageLuminance: number;
}

/** Analyze pixels for safe area, dominant colors, and mode. */
export function analyzePixelsProduction(pixels: PixelData): PixelAnalysis {
  const result = analyzeImage(pixels);
  const avgLuminance = estimateLuminance(pixels);
  return {
    dominantColors: result.dominantColors.map((c) => c.hex),
    safeArea: result.safeArea,
    mode: avgLuminance >= 0.45 ? 'light' : 'dark',
    averageLuminance: avgLuminance,
  };
}

/** Quick luminance estimate from sampled pixels. */
function estimateLuminance(pixels: PixelData): number {
  const { data, width, height } = pixels;
  const step = Math.max(1, Math.floor((width * height) / 2000));
  let totalLum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 128) continue;
    totalLum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    count++;
  }
  return count > 0 ? totalLum / count : 0.5;
}

// ---------------------------------------------------------------------------
// Dependency factory
// ---------------------------------------------------------------------------

/**
 * Create the production dependency object for the Quick Apply engine.
 *
 * @param ctx  The MainContext with library and core services.
 * @param onProgress  Optional progress callback for IPC push.
 */
export function createQuickApplyDeps(
  ctx: MainContext,
  onProgress?: QuickApplyDeps['onProgress'],
): QuickApplyDeps {
  return {
    decodeImage: decodeImageProduction,
    extractTokens: extractTokensProduction,
    analyzePixels: analyzePixelsProduction,
    installTheme: async (bundleJson: string, suggestedId: string): Promise<string> => {
      const parsed = JSON.parse(bundleJson) as { theme?: { id?: string } };
      const id = parsed.theme?.id ?? suggestedId;

      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-qa-'));
      try {
        const tmpFile = path.join(tmp, `${id}.agenttheme`);
        await fs.writeFile(tmpFile, bundleJson, 'utf8');
        const entry = await ctx.library.importPackage(tmpFile);
        return entry.id;
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    },
    applyTheme: async (
      themeId: string,
      targetAppId: AgentId,
    ): Promise<{ status: string; message?: string }> => {
      const result = await ctx.core.apply({ appId: targetAppId, themeId });
      return { status: result.status, message: result.message };
    },
    restoreAgent: async (targetAppId: AgentId): Promise<void> => {
      await ctx.core.restore(targetAppId);
    },
    onProgress,
  };
}
