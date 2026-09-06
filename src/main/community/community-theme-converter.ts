// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Theme Converter
 *
 * Converts a downloaded DreamSkin CommunityTheme ZIP package into an
 * AgentSkin engine-compatible **v1 single-file** theme bundle. Handles:
 *
 *   1. ZIP extraction to temp directory.
 *   2. SHA-256 verification against `metadata.packageSha256`.
 *   3. Source theme.json parsing.
 *   4. Image filename validation (format + path traversal).
 *   5. Color bridge from community metadata to AgentSkin 14-token palette.
 *   6. CSS image `url(...)` references inlined as data: URIs (single-file bundle).
 *   7. Hero image extraction (embedded as a base64 image asset).
 *   8. v1 flat manifest assembly with auto-filled author + license.
 *
 * The output is a single `.agentskin-theme` JSON string (`manifestJson`,
 * schemaVersion: 1) that `ThemeLibrary.installFile` / `readTheme` accept,
 * plus the 14-token palette in `theme.copy.colors` for rendering.
 *
 * All temporary extraction files are cleaned up regardless of outcome
 * (try/finally).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommunityTheme } from '../../shared/types/community';
import { bridgeColors } from './community-color-bridge';
import { cleanupExtractDir, extractThemeZip } from './community-zip-extractor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Agent ids supported by the community theme converter. Mirrors the 6 active
 * product agents so the v2 manifest's `targets` and `supportedAgents` align
 * with the adapter registry.
 */
const COMMUNITY_AGENT_IDS = [
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
] as const;

/** Default author name when the community theme provides none. */
const DEFAULT_AUTHOR_NAME = 'DreamSkin Community';

/** Default license when the community theme provides none. */
const DEFAULT_LICENSE = 'CC-BY-NC-SA-4.0';

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

export interface ConvertedTheme {
  /** AgentSkin theme id (prefixed with "community-"). */
  themeId: string;
  /**
   * v1 single-file `agentskin-theme` bundle JSON string (schemaVersion: 1).
   * This is the installable package — write it to a `.agentskin-theme` file
   * and pass it to `ThemeLibrary.installFile`. Includes the 14-token palette
   * in `theme.copy.colors` and base64 hero/icon/preview assets.
   */
  manifestJson: string;
  /**
   * Backward-compatibility field — always `''`. The v1 single-file bundle is
   * fully self-contained in `manifestJson`; no directory package is produced.
   */
  packageDir: string;
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the theme mode from the community metadata's `displayMeta.appearance`.
 * Only `"dark"` maps to dark mode; everything else (including `"auto"`,
 * `"light"`, or undefined) defaults to light.
 */
function deriveMode(metadata: CommunityTheme): 'dark' | 'light' {
  return metadata.displayMeta?.appearance === 'dark' ? 'dark' : 'light';
}

/**
 * Build the v2 manifest tag list. Always includes `"community"` as the first
 * tag, followed by any tags from the DreamSkin API (deduplicated).
 */
function buildTags(metadata: CommunityTheme): string[] {
  const tags = new Set(['community']);
  for (const tag of metadata.tags ?? []) {
    tags.add(tag);
  }
  return [...tags];
}

/** MIME type for a theme image file (aligned with engine's accepted set). */
function imageMimeType(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return null;
  }
}

/**
 * Map the bridging 14-token palette keys (camelCase) to the engine's canonical
 * `--agentskin-*` token names (kebab-case). These are the tokens the engine's
 * palette layer consumes (see palette/generator.ts raw bases and engine
 * tokens.css).
 */
const COLOR_TOKEN_MAP: Record<string, string> = {
  background: 'bg',
  surface: 'surface',
  surfaceElevated: 'surface-elevated',
  foreground: 'text',
  muted: 'muted',
  accent: 'accent',
  secondary: 'secondary',
  border: 'border',
  codeBackground: 'code-bg',
  codeForeground: 'code-fg',
  inputBackground: 'input-bg',
  buttonBackground: 'button-bg',
  focusRing: 'focus-ring',
  selection: 'selection',
};

/**
 * Emit a `:root { --agentskin-*: ... }` block from the bridging palette.
 *
 * The engine's palette builder ({@link buildPaletteCss}) requires at least 6
 * `--agentskin-*` declarations in the target CSS and otherwise returns null,
 * which makes engine injection fail and the app silently degrade to legacy
 * compatibility mode. Community CSS never declares these tokens, so we inject
 * them here to keep community themes on the full engine path.
 */
function buildAgentSkinTokens(colors: Record<string, string>): string {
  const declarations = Object.entries(colors)
    .filter(([key]) => COLOR_TOKEN_MAP[key])
    .map(([key, value]) => `  --agentskin-${COLOR_TOKEN_MAP[key]}: ${value};`);
  if (declarations.length === 0) return '';
  return `:root {\n${declarations.join('\n')}\n}\n`;
}

/**
 * Make community CSS compatible with the engine's v1 single-file target
 * validator, which rejects any `url(...)` that is not a `data:` URI and any
 * `@import` (see `REMOTE_CSS` in engine package.mjs).
 *
 *   - Local image references (`url('images/x.png')`) are inlined as base64
 *     `data:` URIs by reading the file from the extracted theme root.
 *   - Remote / unresolvable references and `@import` rules are dropped
 *     (replaced with `none`, a safe CSS-wide fallback) so the theme still
 *     installs even when the source ships external assets we cannot carry.
 */
function inlineCssImageUrls(css: string, themeRoot: string): string {
  const withoutImports = css.replace(/@import\s+[^;]+;\s*/g, '');
  return withoutImports.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (whole, _q, ref: string) => {
    const trimmed = ref.trim();
    // Keep data: URIs verbatim (they are already self-contained and pass the
    // engine's REMOTE_CSS gate).
    if (/^data:/i.test(trimmed)) return whole;
    // Only inline safe relative paths that resolve inside the theme root.
    const decoded = decodeURIComponent(trimmed);
    const resolved = path.resolve(themeRoot, decoded);
    if (
      resolved.startsWith(themeRoot + path.sep) &&
      fs.existsSync(resolved) &&
      fs.statSync(resolved).isFile()
    ) {
      const mime = imageMimeType(resolved);
      if (mime) {
        const b64 = fs.readFileSync(resolved).toString('base64');
        return `url("data:${mime};base64,${b64}")`;
      }
    }
    // Unresolvable external reference — drop it so the target still validates.
    return 'none';
  });
}

// ---------------------------------------------------------------------------
// Convert function
// ---------------------------------------------------------------------------

/**
 * Process a downloaded ZIP buffer and convert it to an AgentSkin v2 theme
 * package.
 *
 * The ZIP is first written to a temp file (required by the yauzl-based
 * extractor), then extracted, validated, and converted. On success, the
 * output package directory (`ConvertedTheme.packageDir`) contains a complete
 * v2 directory-based theme ready for installation. The caller must clean up
 * this directory after installation.
 *
 * All temporary *extraction* files are cleaned up in a finally block. The
 * output package directory is only cleaned up on error — on success it must
 * survive for the installer to consume.
 *
 * @param zipBuffer - Raw ZIP file bytes from the DreamSkin API.
 * @param metadata - Community theme metadata (from DreamSkin API, with optional displayMeta).
 * @returns Converted theme info including the output package directory.
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
      // TODO: type-guard — 待渐进式加固
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

    // 9. Read CSS content and hero image buffer (must happen BEFORE cleanup).
    //    Community CSS is inlined into a v1 single-file bundle, so any
    //    `url(...)` image references must be turned into data: URIs first.
    //    We also prepend the --agentskin-* palette tokens so the engine's
    //    palette builder (≥6 tokens) can run and community themes stay on the
    //    full engine path instead of degrading to legacy compatibility mode.
    const tokenCss = buildAgentSkinTokens(colors);
    const cssContent = `${tokenCss}${inlineCssImageUrls(fs.readFileSync(cssPath, 'utf-8'), themeRoot)}`;
    const heroExt = path.extname(imageName).toLowerCase();
    const heroImageBuffer = fs.readFileSync(imagePath);

    // 10. Build the engine-compatible v1 single-file `agentskin-theme` bundle.
    //     The library stores community themes exactly like any other installed
    //     `.agentskin-theme` package (schemaVersion: 1), which is what
    //     ThemeLibrary.installFile / readTheme validate against. The 14-token
    //     palette lives in theme.copy.colors and the hero is embedded as a
    //     base64 image asset so the theme page can render a cover.
    const mode = deriveMode(metadata);
    const tags = buildTags(metadata);

    const heroMime = imageMimeType(imagePath) ?? 'image/png';
    const assetImages: Record<string, { filename: string; mimeType: string; base64: string }> = {
      hero: {
        filename: `hero${heroExt}`,
        mimeType: heroMime,
        base64: heroImageBuffer.toString('base64'),
      },
      icon: {
        filename: `icon${heroExt}`,
        mimeType: heroMime,
        base64: heroImageBuffer.toString('base64'),
      },
      preview: {
        filename: `preview${heroExt}`,
        mimeType: heroMime,
        base64: heroImageBuffer.toString('base64'),
      },
    };

    const manifest = {
      format: 'agentskin-theme',
      schemaVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      theme: {
        id: themeId,
        displayName: String(sourceTheme.name || metadata.name || themeId).trim(),
        version: metadata.version || '1.0.0',
        copy: {
          author: { name: metadata.author?.displayName || DEFAULT_AUTHOR_NAME },
          category: 'community',
          tags,
          license: DEFAULT_LICENSE,
          unofficial: true,
          mode,
          supportedAgents: [...COMMUNITY_AGENT_IDS],
          colors,
          contentHash: metadata.packageSha256 ? metadata.packageSha256.slice(0, 32) : undefined,
        },
      },
      targets: Object.fromEntries(
        COMMUNITY_AGENT_IDS.map((agentId) => [agentId, { css: cssContent }]),
      ),
      assets: { images: assetImages },
    };

    return {
      themeId,
      manifestJson: JSON.stringify(manifest, null, 2),
      packageDir: '',
      colors,
    };
  } finally {
    // Always clean up both temp directories (ZIP staging + extraction root).
    cleanupExtractDir(tempDir);
    cleanupExtractDir(extractDir);
  }
}
