// SPDX-License-Identifier: MPL-2.0

/**
 * # DreamSkin Parser
 *
 * Parses DreamSkin community theme ZIP packages. The expected input is a
 * pre-extracted file map (`Map<string, Uint8Array>`) produced by a secure
 * ZIP extractor (e.g. `theme-import-export.ts` in the main process).
 *
 * ## Source Format Structure
 *
 * A DreamSkin ZIP package contains:
 *
 * ```
 * theme.json          — Theme metadata (name, author, colors, css, image)
 * theme.css           — Single CSS file applied to all agents
 * hero.png            — Hero/preview image
 * (additional assets) — Optional extra images
 * ```
 *
 * ### theme.json Schema
 *
 * ```json
 * {
 *   "name": "Cyber Neon",
 *   "author": "dreamskin_user",
 *   "version": "1.0.0",
 *   "description": "A cyberpunk theme",
 *   "image": "hero.png",
 *   "css": "theme.css",
 *   "tags": ["cyberpunk", "dark"],
 *   "category": "cyberpunk"
 * }
 * ```
 *
 * ## Color Handling
 *
 * DreamSkin themes may ship with a `colors` object in theme.json or rely
 * on the community API's `displayMeta.colors` (10-color system). This parser
 * extracts whatever colors are present in the source and maps them to the
 * 14-token system. Missing tokens are left for downstream normalization.
 *
 * ## Agent CSS
 *
 * DreamSkin themes provide a single CSS file. The parser duplicates it for
 * all 6 AgentIds (the downstream pipeline may refine per-agent targeting).
 */

import type { AgentId } from '../../types/agent';
import { ALL_AGENT_IDS } from '../../types/agent';
import {
  coerceString,
  decodeUtf8,
  type ImageAsset,
  ParserError,
  type ParserSource,
  safeParseJson,
  type ThemeImages,
  type ThemeIntermediateRepresentation,
  type ThemeSourceParser,
} from '../theme-source-parser';

/** Supported file extensions for this parser. */
const EXTENSIONS = ['.dreamskin-theme', '.zip'];

/** Required entry in the file map for detection. */
const REQUIRED_ENTRY = 'theme.json';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the input is a DreamSkin theme package.
 *
 * Detection strategy:
 * - If `files` is present, check for `theme.json` entry.
 * - If `path` or `filename` is present, check the extension.
 * - If `buffer` is present, check for ZIP magic bytes (PK\x03\x04).
 */
function canParseSource(source: ParserSource): boolean {
  // File map detection (most reliable)
  if (source.files) {
    return source.files.has(REQUIRED_ENTRY);
  }

  // Extension-based detection
  if (source.filename && EXTENSIONS.some((ext) => source.filename!.endsWith(ext))) {
    return true;
  }
  if (source.path && EXTENSIONS.some((ext) => source.path!.endsWith(ext))) {
    return true;
  }

  // Buffer-based detection (ZIP magic bytes)
  if (source.buffer && isZipBuffer(source.buffer)) {
    return true;
  }

  return false;
}

/**
 * Check if a buffer starts with ZIP magic bytes (PK\x03\x04).
 */
function isZipBuffer(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a DreamSkin theme package into the unified IR.
 */
async function parseSource(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
  if (!source.files) {
    throw new ParserError(
      'DreamSkin parser requires pre-extracted files (Map<string, Uint8Array>)',
      'dreamskin',
      'dreamskin-theme',
    );
  }

  const files = source.files;

  // 1. Parse theme.json
  const themeJsonBuf = files.get(REQUIRED_ENTRY);
  if (!themeJsonBuf) {
    throw new ParserError('theme.json not found in package', 'dreamskin', 'dreamskin-theme');
  }

  const themeJson = safeParseJson(decodeUtf8(themeJsonBuf), 'dreamskin', 'dreamskin-theme');

  // 2. Extract metadata
  const id = extractThemeId(themeJson);
  const displayName = coerceString(themeJson.name) ?? id;
  const version = coerceString(themeJson.version) ?? '1.0.0';
  const authorName = coerceString(themeJson.author) ?? 'DreamSkin Community';
  const description = coerceString(themeJson.description);
  const category = coerceString(themeJson.category);
  const tags = extractTags(themeJson);

  // 3. Extract CSS
  const cssContent = extractCss(files, themeJson);
  const agentCss: Partial<Record<AgentId, string>> = {};
  if (cssContent) {
    for (const agentId of ALL_AGENT_IDS) {
      agentCss[agentId] = cssContent;
    }
  }

  // 4. Extract images
  const images = extractImages(files, themeJson);

  // 5. Extract colors
  const colors = extractColors(themeJson);

  // 6. Detect mode
  const mode = detectMode(cssContent, themeJson);

  return {
    id,
    displayName,
    version,
    author: { name: authorName },
    mode,
    category,
    tags,
    colors,
    images,
    agentCss,
    sourceFormat: 'dreamskin',
    confidence: 0.75,
    localizedDescriptions: description ? { en: description, zh: description } : undefined,
    unofficial: true,
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractThemeId(themeJson: Record<string, unknown>): string {
  const rawName = coerceString(themeJson.name);
  if (!rawName) {
    throw new ParserError(
      'DreamSkin theme.json missing required "name" field',
      'dreamskin',
      'dreamskin-theme',
    );
  }

  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100);
}

function extractTags(themeJson: Record<string, unknown>): string[] {
  const raw = themeJson.tags;
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t)).filter(Boolean);
  }
  return [];
}

/**
 * Extract CSS content from the package.
 *
 * Looks for the CSS file referenced in theme.json (`css` or `cssFile` field),
 * falling back to common filenames.
 */
function extractCss(
  files: Map<string, Uint8Array>,
  themeJson: Record<string, unknown>,
): string | undefined {
  // Try the referenced CSS file first
  const cssName = coerceString(themeJson.css) ?? coerceString(themeJson.cssFile);
  if (cssName) {
    const buf = findFileCaseInsensitive(files, cssName);
    if (buf) return decodeUtf8(buf);
  }

  // Fallback: look for common CSS filenames
  const fallbacks = ['theme.css', 'style.css', 'styles.css', 'main.css'];
  for (const name of fallbacks) {
    const buf = findFileCaseInsensitive(files, name);
    if (buf) return decodeUtf8(buf);
  }

  return undefined;
}

/**
 * Extract images from the package.
 *
 * Looks for the image referenced in theme.json (`image` or `preview` field),
 * plus any additional image files.
 */
function extractImages(
  files: Map<string, Uint8Array>,
  themeJson: Record<string, unknown>,
): ThemeImages {
  const images: ThemeImages = {};

  // Primary image (hero/preview)
  const imageName = coerceString(themeJson.image) ?? coerceString(themeJson.preview);
  if (imageName) {
    const buf = findFileCaseInsensitive(files, imageName);
    if (buf) {
      images.hero = {
        data: buf,
        ext: inferExt(imageName),
        filename: imageName,
        mimeType: mimeTypeForExt(imageName),
      };
      // Also use as preview if no separate preview exists
      images.preview = images.hero;
    }
  }

  // Icon (if present)
  const iconName = coerceString(themeJson.icon);
  if (iconName) {
    const buf = findFileCaseInsensitive(files, iconName);
    if (buf) {
      images.icon = {
        data: buf,
        ext: inferExt(iconName),
        filename: iconName,
        mimeType: mimeTypeForExt(iconName),
      };
    }
  }

  // Collect any additional images as textures/decorations
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  const knownFiles = new Set([imageName, iconName].filter(Boolean));

  for (const [filename, data] of files) {
    if (filename === 'theme.json') continue;
    if (filename.endsWith('.css')) continue;
    if (knownFiles.has(filename)) continue;

    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!imageExts.has(ext)) continue;

    const asset: ImageAsset = {
      data,
      ext: inferExt(filename),
      filename,
      mimeType: mimeTypeForExt(filename),
    };

    // Heuristic: small images are decorations, large ones are textures
    if (data.length < 50_000) {
      images.decorations = [...(images.decorations ?? []), asset];
    } else {
      images.textures = [...(images.textures ?? []), asset];
    }
  }

  return images;
}

/**
 * Extract colors from theme.json.
 *
 * DreamSkin themes may include a `colors` object with various color fields.
 * This maps them to the 14-token system where possible.
 */
function extractColors(
  themeJson: Record<string, unknown>,
): Partial<ThemeIntermediateRepresentation['colors']> {
  const raw = themeJson.colors;
  if (!raw || typeof raw !== 'object') return {};

  const src = raw as Record<string, unknown>;
  const colors: Record<string, string> = {};

  // Direct mappings
  const directMappings: Array<[string, string]> = [
    ['accent', 'accent'],
    ['primary', 'accent'],
    ['secondary', 'secondary'],
    ['background', 'background'],
    ['surface', 'surface'],
    ['surfaceElevated', 'surfaceElevated'],
    ['foreground', 'foreground'],
    ['text', 'foreground'],
    ['muted', 'muted'],
    ['border', 'border'],
    ['codeBackground', 'codeBackground'],
    ['codeBg', 'codeBackground'],
    ['codeForeground', 'codeForeground'],
    ['codeFg', 'codeForeground'],
    ['inputBackground', 'inputBackground'],
    ['inputBg', 'inputBackground'],
    ['buttonBackground', 'buttonBackground'],
    ['buttonBg', 'buttonBackground'],
    ['buttonForeground', 'buttonForeground'],
    ['buttonFg', 'buttonForeground'],
    ['focusRing', 'focusRing'],
  ];

  for (const [srcKey, targetKey] of directMappings) {
    const value = coerceString(src[srcKey]);
    if (value && !colors[targetKey]) {
      colors[targetKey] = value;
    }
  }

  return colors;
}

/**
 * Detect light/dark mode from CSS content or theme metadata.
 */
function detectMode(
  cssContent: string | undefined,
  themeJson: Record<string, unknown>,
): 'light' | 'dark' {
  // Check explicit mode field
  const modeField = coerceString(themeJson.mode) ?? coerceString(themeJson.appearance);
  if (modeField === 'dark') return 'dark';
  if (modeField === 'light') return 'light';

  // Check CSS for color-scheme
  if (cssContent) {
    if (cssContent.includes('color-scheme: dark')) return 'dark';
    if (cssContent.includes('color-scheme: light')) return 'light';
  }

  // Default to dark (DreamSkin community themes are predominantly dark)
  return 'dark';
}

// ---------------------------------------------------------------------------
// File map utilities
// ---------------------------------------------------------------------------

/**
 * Find a file in the map with case-insensitive matching.
 */
function findFileCaseInsensitive(
  files: Map<string, Uint8Array>,
  name: string,
): Uint8Array | undefined {
  // Exact match first
  if (files.has(name)) return files.get(name);

  // Case-insensitive fallback
  const lowerName = name.toLowerCase();
  for (const [key, value] of files) {
    if (key.toLowerCase() === lowerName) return value;
  }

  return undefined;
}

function inferExt(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return 'png';
  return filename.slice(dotIdx + 1).toLowerCase();
}

function mimeTypeForExt(filename: string): string {
  const ext = inferExt(filename);
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

// ---------------------------------------------------------------------------
// Exported parser instance
// ---------------------------------------------------------------------------

/**
 * DreamSkin community theme parser.
 *
 * Handles DreamSkin ZIP packages (pre-extracted to a file map).
 * Registered with priority 20 (medium — requires file map extraction first).
 */
export const dreamskinParser: ThemeSourceParser = {
  name: 'dreamskin',
  description: 'DreamSkin community theme package (ZIP with theme.json + CSS + images)',
  extensions: ['.dreamskin-theme', '.zip'],

  canParse(source: ParserSource): boolean {
    return canParseSource(source);
  },

  async parse(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
    return parseSource(source);
  },
};
