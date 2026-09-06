// SPDX-License-Identifier: MPL-2.0

/**
 * # image-import-service — Image → Theme Package Orchestration
 *
 * Orchestrates the full pipeline from an image file on disk to a complete
 * AgentSkin theme package saved in the user's themes directory:
 *
 *   1. **Validate** — format, size, dimensions
 *   2. **Decode** — file bytes → RGBA pixel data (PNG via pngjs, JPEG/WebP
 *      via Electron nativeImage)
 *   3. **Analyze** — extract structured color palette
 *   4. **Generate** — map palette to 14-token theme
 *   5. **Package** — write theme.json + hero image to user themes directory
 *
 * ## Design
 *
 * This service lives in the main process (it touches the filesystem and
 * Electron APIs). The pure analysis/generation logic lives in
 * `image-theme-analyzer.ts` and `theme-generator.ts` respectively.
 */

import { nativeImage } from 'electron';
import { PNG } from 'pngjs';
import { extractThemePalette, type ImageThemePalette } from './image-theme-analyzer';
import { generateThemeTokens, type ThemeGenerationResult } from './theme-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported image formats for theme import. */
export type SupportedFormat = 'png' | 'jpeg' | 'webp';

/** Result of importing an image as a theme. */
export interface ImageImportResult {
  /** Whether the import succeeded. */
  success: boolean;
  /** Theme ID (slug) generated for the new theme. */
  themeId?: string;
  /** Display name of the new theme. */
  themeName?: string;
  /** Path to the created theme directory. */
  themePath?: string;
  /** The generated theme tokens (for preview). */
  tokens?: ThemeGenerationResult;
  /** Error message if import failed. */
  error?: string;
}

/** Options for the import operation. */
export interface ImageImportOptions {
  /** Custom display name for the theme (defaults to filename-based). */
  displayName?: string;
  /** Target directory for the theme (defaults to user themes dir). */
  targetDir?: string;
  /** Maximum file size in bytes (default: 20 MB). */
  maxFileSize?: number;
  /** Maximum image dimension (default: 8192). */
  maxDimension?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size: 20 MB. */
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Supported file extensions mapped to format. */
const EXT_MAP: Record<string, SupportedFormat> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an image file before processing.
 *
 * Checks file extension, size, and basic format validity.
 *
 * @param filePath  Absolute path to the image file.
 * @param fileSize  File size in bytes.
 * @param opts      Optional validation overrides.
 * @returns         `null` if valid, or an error string.
 */
export function validateImageFile(
  filePath: string,
  fileSize: number,
  opts: ImageImportOptions = {},
): string | null {
  const maxSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));

  if (!EXT_MAP[ext]) {
    return `Unsupported format "${ext}". Supported: PNG, JPEG, WebP`;
  }

  if (fileSize > maxSize) {
    return `File size ${(fileSize / 1024 / 1024).toFixed(1)} MB exceeds maximum ${(maxSize / 1024 / 1024).toFixed(0)} MB`;
  }

  if (fileSize === 0) {
    return 'File is empty';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Decode an image file to RGBA pixel data.
 *
 * Uses pngjs for PNG files and Electron's nativeImage for JPEG/WebP.
 * The returned pixel data is suitable for `extractThemePalette`.
 *
 * @param filePath  Absolute path to the image file.
 * @param fileBuffer  Raw file bytes.
 * @returns         RGBA pixel data + dimensions, or null on failure.
 */
export function decodeImageToRgba(
  filePath: string,
  fileBuffer: Buffer,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  const format = EXT_MAP[ext];

  if (!format) return null;

  if (format === 'png') {
    try {
      const png = PNG.sync.read(fileBuffer);
      return {
        data: new Uint8ClampedArray(png.data),
        width: png.width,
        height: png.height,
      };
    } catch {
      return null;
    }
  }

  // JPEG / WebP: use Electron nativeImage.
  try {
    const img = nativeImage.createFromBuffer(fileBuffer);
    if (img.isEmpty()) return null;
    const size = img.getSize();

    // Downscale to max 1920×1080 for analysis (preserves color distribution).
    const maxDim = 1920;
    let { width, height } = size;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    // Ensure minimum size for nativeImage resize.
    width = Math.max(1, width);
    height = Math.max(1, height);

    const resized = img.resize({ width, height });
    const pngBuffer = resized.toPNG();
    const png = PNG.sync.read(pngBuffer);

    return {
      data: new Uint8ClampedArray(png.data),
      width: png.width,
      height: png.height,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Theme ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique theme ID from a display name.
 *
 * Converts to lowercase, replaces non-alphanumeric with hyphens,
 * collapses multiple hyphens, and trims.
 */
export function generateThemeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  // Append a short random suffix for uniqueness.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `img-${slug || 'theme'}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Full pipeline (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Import an image file as a new AgentSkin theme.
 *
 * This is the main entry point. It validates the file, decodes it,
 * extracts the color palette, generates the 14-token theme, and
 * returns the result. The caller is responsible for writing the
 * theme package to disk (to keep this function testable without
 * filesystem side effects).
 *
 * @param filePath    Absolute path to the image file.
 * @param fileBuffer  Raw file bytes.
 * @param fileSize    File size in bytes.
 * @param opts        Optional import configuration.
 * @returns           An `ImageImportResult` with the outcome.
 */
export function importImageAsTheme(
  filePath: string,
  fileBuffer: Buffer,
  fileSize: number,
  opts: ImageImportOptions = {},
): ImageImportResult {
  // Step 1: validate.
  const validationError = validateImageFile(filePath, fileSize, opts);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Step 2: decode.
  const rgba = decodeImageToRgba(filePath, fileBuffer);
  if (!rgba) {
    return { success: false, error: 'Failed to decode image (corrupt or unsupported format)' };
  }

  // Step 3: analyze.
  let palette: ImageThemePalette;
  try {
    palette = extractThemePalette(rgba.data, rgba.width, rgba.height);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown analysis error';
    return { success: false, error: `Image analysis failed: ${msg}` };
  }

  // Step 4: generate tokens.
  const result = generateThemeTokens(palette);

  // Step 5: build theme metadata.
  const displayName =
    opts.displayName || filePath.slice(filePath.lastIndexOf('\\') + 1, filePath.lastIndexOf('.'));
  const themeId = generateThemeId(displayName);

  return {
    success: true,
    themeId,
    themeName: displayName,
    tokens: result,
  };
}

/**
 * Build a theme manifest JSON object from an import result.
 *
 * This creates the manifest structure that would be written to
 * `manifest.json` inside the theme package directory.
 *
 * @param result     The successful import result.
 * @param sourcePath The original image file path (for hero reference).
 * @returns          A manifest object ready for JSON serialization.
 */
export function buildThemeManifest(
  result: ImageImportResult,
  sourcePath: string,
): Record<string, unknown> | null {
  if (!result.success || !result.themeId || !result.tokens) return null;

  const { tokens } = result.tokens;

  return {
    id: result.themeId,
    name: result.themeName ?? result.themeId,
    version: '1.0.0',
    author: null,
    description: `Auto-generated from image: ${sourcePath.slice(sourcePath.lastIndexOf('\\') + 1)}`,
    supportedAgents: ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'],
    preview: null,
    hero: null,
    mode: tokens.background.startsWith('#') && isLightColor(tokens.background) ? 'light' : 'dark',
    colors: {
      accent: tokens.accent,
      secondary: tokens.secondary,
      background: tokens.background,
      foreground: tokens.foreground,
      muted: tokens.muted,
      surface: tokens.surface,
      surfaceElevated: tokens.surfaceElevated,
      border: tokens.border,
      codeBackground: tokens.codeBackground,
      codeForeground: tokens.codeForeground,
      inputBackground: tokens.inputBackground,
      buttonBackground: tokens.buttonBackground,
      buttonForeground: tokens.buttonForeground,
      focusRing: tokens.focusRing,
    },
  };
}

/**
 * Quick check if a hex color is "light" (luminance > 0.5).
 */
function isLightColor(hex: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  // Rec. 709 luma.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}
