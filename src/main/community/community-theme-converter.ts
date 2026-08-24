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

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import type { CommunityTheme } from '../../shared/types/community';
import { bridgeColors } from './community-color-bridge';
import { extractThemeZip, cleanupExtractDir } from './community-zip-extractor';

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
  return rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100) || 'community-theme';
}

export interface ConvertedTheme {
  /** AgentSkin theme id (prefixed with "community-"). */
  themeId: string;
  /** ThemeManifest JSON string (ready for ThemeLibrary.install). */
  manifestJson: string;
  /** Absolute path to the hero/preview image. */
  heroPath: string;
  /** Absolute path to the theme CSS file. */
  cssPath: string;
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
    throw new Error(`Unsupported image format "${ext}" (allowed: ${[...ALLOWED_IMAGE_EXTS].join(', ')})`);
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
    const { themeRoot } = await extractThemeZip(zipPath);

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
      throw new Error(`Failed to parse theme.json: ${err instanceof Error ? err.message : String(err)}`);
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

    // 9. Build AgentSkin manifest v2 with all 6 agent targets
    const heroExt = path.extname(imageName).toLowerCase();
    const heroFileName = `hero${heroExt}`;

    const manifest = {
      schemaVersion: 2 as const,
      id: themeId,
      name: String(sourceTheme.name || metadata.name || themeId).trim(),
      author: metadata.author?.displayName || 'DreamSkin Community',
      version: metadata.version || '1.0.0',
      license: (metadata as unknown as Record<string, unknown>).license as string || 'MIT',
      hero: heroFileName,
      colors: {
        accent: colors.accent,
        secondary: colors.secondary,
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        surface: colors.surface,
        surfaceElevated: colors.surfaceElevated,
        border: colors.border,
        codeBackground: colors.codeBackground,
        codeForeground: colors.codeForeground,
        inputBackground: colors.inputBackground,
        buttonBackground: colors.buttonBackground,
        buttonForeground: colors.buttonForeground,
        focusRing: colors.focusRing,
      },
      source: 'community' as const,
      community: {
        themeId: metadata.themeId,
        downloads: metadata.downloads ?? 0,
        rating: metadata.rating ?? 0,
        updatedAt: metadata.updatedAt ?? null,
      },
      targets: [
        { agentId: 'traework', css: 'assets/css/traework.css' },
        { agentId: 'qoderwork', css: 'assets/css/qoderwork.css' },
        { agentId: 'workbuddy', css: 'assets/css/workbuddy.css' },
        { agentId: 'doubao', css: 'assets/css/doubao.css' },
        { agentId: 'codex', css: 'assets/css/codex.css' },
        { agentId: 'zcode', css: 'assets/css/zcode.css' },
      ],
    };

    return {
      themeId,
      manifestJson: JSON.stringify(manifest, null, 2),
      heroPath: imagePath,
      cssPath,
      colors: manifest.colors,
    };
  } finally {
    // Always clean up the temp directory
    cleanupExtractDir(tempDir);
  }
}
