// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Theme Converter
 *
 * Converts a downloaded DreamSkin CommunityTheme ZIP package into an
 * AgentSkin-compatible theme manifest + assets. Handles:
 *
 *   1. ZIP extraction to temp directory.
 *   2. SHA-256 verification against `metadata.packageSha256`.
 *   3. Source theme.json parsing.
 *   4. Image filename validation (format + path traversal).
 *   5. Color bridge from community metadata to AgentSkin 14-token palette.
 *   6. Manifest assembly for all 6 agent targets.
 *
 * All temporary files are cleaned up regardless of outcome (try/finally).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommunityTheme } from '../../shared/types/community';
import { bridgeColors } from './community-color-bridge';
import { cleanupExtractDir, extractThemeZip } from './community-zip-extractor';

// ---------------------------------------------------------------------------
// Public functions & types
// ---------------------------------------------------------------------------

/**
 * Normalize a theme title/name to a safe AgentSkin-compatible slug.
 *
 * Rules:
 * - Lowercase
 * - Only `[a-z0-9-]` characters
 * - Leading/trailing dashes stripped
 * - Collapses consecutive dashes
 * - Truncated to 100 characters
 *
 * @param rawTitle - Raw title string to normalize.
 * @returns Normalized slug (e.g. "Cyber Neon" → "cyber-neon").
 */
export function normalizeTitle(rawTitle: string): string {
  if (typeof rawTitle !== 'string' || rawTitle.length === 0) {
    return 'community-theme';
  }
  return (
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 100) || 'community-theme'
  );
}

/**
 * MIME type for a given image extension (whitelist-aligned with the engine).
 */
function mimeTypeForExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

export interface ConvertedTheme {
  /** AgentSkin theme id (prefixed with "community-"). */
  themeId: string;
  /**
   * v1 `.agentskin-theme` package JSON string — ready for
   * `ThemeLibrary.installFile` after being written to disk.
   */
  manifestJson: string;
  /** 14-token color palette from bridgeColors. */
  colors: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Image validation
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Maximum filename length for image files. */
const MAX_IMAGE_NAME_LEN = 255;

/**
 * Resolve and validate an image filename against the theme root.
 *
 * Guards against path traversal, spaces, and unsupported formats.
 *
 * @param themeRoot - Absolute path to the extracted theme root.
 * @param imageName - Filename from the source theme.json.
 * @returns Absolute path to the image file.
 * @throws Error if the filename is invalid or unsafe.
 */
function resolveSafeImagePath(themeRoot: string, imageName: string): string {
  // 1. Filename must not contain path separators
  if (imageName.includes('/') || imageName.includes('\\')) {
    throw new Error(`Image name must not contain path separators: ${imageName}`);
  }

  // 2. Filename must be a single file (not a path)
  if (path.basename(imageName) !== imageName) {
    throw new Error(`Invalid image name (expected a filename): ${imageName}`);
  }

  // 3. Filename length guard
  if (imageName.length > MAX_IMAGE_NAME_LEN) {
    throw new Error(`Image name too long (${imageName.length} > ${MAX_IMAGE_NAME_LEN})`);
  }

  // 4. Extension whitelist
  const ext = path.extname(imageName).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    throw new Error(
      `Unsupported image format "${ext}" (allowed: ${[...ALLOWED_IMAGE_EXTS].join(', ')})`,
    );
  }

  // 5. Spaces not accepted in agent-distributed filenames
  if (imageName.includes(' ')) {
    throw new Error(`Image filename must not contain spaces: ${imageName}`);
  }

  // 6. Resolve and verify path stays inside themeRoot
  const resolved = path.resolve(themeRoot, imageName);
  if (!resolved.startsWith(themeRoot + path.sep)) {
    throw new Error(`Image path escapes theme root: ${imageName}`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Convert function
// ---------------------------------------------------------------------------

/**
 * Process a downloaded ZIP buffer and convert it to an AgentSkin theme.
 *
 * The ZIP is first written to a temp file (required by the yauzl-based
 * extractor), then extracted, validated, and converted. All temp files
 * are cleaned up in a finally block.
 *
 * @param zipBuffer - Raw ZIP file bytes from the DreamSkin API.
 * @param metadata - Community theme metadata (from DreamSkin API, with optional displayMeta).
 * @returns Converted theme paths and manifest.
 */
export async function convertThemePackage(
  zipBuffer: Buffer,
  metadata: CommunityTheme,
): Promise<ConvertedTheme> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamskin-convert-'));
  const zipPath = path.join(tempDir, 'theme.zip');
  // Declared here so the finally block can clean it up even if extraction fails.
  let extractDir = '';

  try {
    // 1. Write ZIP to temp file (yauzl requires a file path)
    fs.writeFileSync(zipPath, zipBuffer, { flag: 'wx' });

    // 2. SHA-256 verification (if metadata provides a checksum)
    if (metadata.packageSha256) {
      const actualHash = createHash('sha256').update(zipBuffer).digest('hex');
      if (actualHash !== metadata.packageSha256) {
        throw new Error(
          `SHA-256 verification failed: expected ${metadata.packageSha256.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…. Package may be corrupted or tampered with.`,
        );
      }
    }

    // 3. Extract ZIP using the secure extractor
    const { themeRoot, extractDir: extractedDir } = await extractThemeZip(zipPath);
    extractDir = extractedDir;

    // 4. Parse source theme.json from the extracted package
    const sourceThemePath = path.join(themeRoot, 'theme.json');
    if (!fs.existsSync(sourceThemePath)) {
      throw new Error('theme.json not found in the extracted package (expected at package root)');
    }

    let sourceTheme: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(sourceThemePath, 'utf-8');
      sourceTheme = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to parse theme.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 5. Resolve image path with full safety checks
    const imageName = String(sourceTheme.image || sourceTheme.preview || '');
    if (imageName.length === 0) {
      throw new Error('theme.json references no image (missing "image" or "preview" field)');
    }

    const imagePath = resolveSafeImagePath(themeRoot, imageName);
    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      throw new Error(`Theme image file does not exist or is not a regular file: ${imageName}`);
    }

    // 6. Verify CSS file exists
    const cssName = String(sourceTheme.css || sourceTheme.cssFile || 'theme.css');
    const cssPath = path.resolve(themeRoot, cssName);
    if (!cssPath.startsWith(themeRoot + path.sep)) {
      throw new Error(`CSS path escapes theme root: ${cssName}`);
    }
    if (!fs.existsSync(cssPath) || !fs.statSync(cssPath).isFile()) {
      throw new Error(`Theme CSS file does not exist or is not a regular file: ${cssName}`);
    }

    // 7. Derive colors via the community color bridge (14-token system)
    const colors = bridgeColors(metadata);

    // 8. Normalize theme id: prefix with "community-" and validate
    const baseId = normalizeTitle(
      String(sourceTheme.name || metadata.name || metadata.themeId || 'community'),
    );
    const themeId = `community-${baseId}`;

    // 9. Read CSS content and hero image as base64 (must happen BEFORE cleanup).
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    const heroExt = path.extname(imageName).toLowerCase();
    const heroFileName = `hero${heroExt}`;
    const heroMimeType = mimeTypeForExt(heroExt);
    const heroBase64 = fs.readFileSync(imagePath).toString('base64');

    // 10. Build v1 `.agentskin-theme` package compatible with validateThemePackage.
    //     The v1 schema requires: format, schemaVersion, theme{ id, displayName,
    //     version, catalog }, targets{ [agentId]: { css } }, assets.images.hero.
    const themePackage = {
      format: 'agentskin-theme',
      schemaVersion: 1 as const,
      theme: {
        id: themeId,
        displayName: String(sourceTheme.name || metadata.name || themeId).trim(),
        version: metadata.version || '1.0.0',
        author: metadata.author?.displayName || 'DreamSkin Community',
        catalog: {
          categories: ['community'],
          name: {
            en: String(sourceTheme.name || metadata.name || themeId).trim(),
            zh: String(sourceTheme.name || metadata.name || themeId).trim(),
          },
        },
        colors: {
          accent: colors.accent,
          secondary: colors.secondary,
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.muted,
          surface: colors.surface,
        },
      },
      targets: {
        traework: { css: cssContent },
        qoderwork: { css: cssContent },
        workbuddy: { css: cssContent },
        doubao: { css: cssContent },
        codex: { css: cssContent },
        zcode: { css: cssContent },
      },
      assets: {
        images: {
          hero: {
            filename: heroFileName,
            mimeType: heroMimeType,
            base64: heroBase64,
          },
        },
      },
    };

    return {
      themeId,
      manifestJson: JSON.stringify(themePackage, null, 2),
      colors,
    };
  } finally {
    // Always clean up both temp directories (ZIP staging + extraction root)
    cleanupExtractDir(tempDir);
    cleanupExtractDir(extractDir);
  }
}
