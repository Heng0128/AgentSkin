// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentSkin Built Parser
 *
 * Parses existing `.agentskin-theme` directory packages — the native format
 * produced by AgentSkin Studio and the theme build pipeline.
 *
 * ## Source Format Structure
 *
 * A `.agentskin-theme` directory contains:
 *
 * ```
 * manifest.json         — Theme metadata (id, name, version, colors, targets, assets)
 * icon.png              — Theme icon
 * preview.png           — Preview screenshot
 * hero.png              — Hero artwork (optional)
 * assets/css/
 *   traework.css        — Per-agent CSS
 *   qoderwork.css
 *   workbuddy.css
 *   doubao.css
 *   codex.css
 *   zcode.css
 * assets/images/        — Additional images (optional)
 * README.md             — Theme documentation (optional)
 * ```
 *
 * ### manifest.json Schema (v2)
 *
 * ```json
 * {
 *   "id": "my-theme",
 *   "name": "my-theme",
 *   "displayName": "My Theme",
 *   "version": "1.0.0",
 *   "author": { "name": "Author" },
 *   "mode": "dark",
 *   "category": "cyberpunk",
 *   "tags": ["dark", "neon"],
 *   "colors": { "accent": "#ff0080", ... },
 *   "targets": {
 *     "traework": { "css": "assets/css/traework.css" },
 *     "qoderwork": { "css": "assets/css/qoderwork.css" },
 *     ...
 *   },
 *   "assets": {
 *     "images": { "decoration1": "assets/images/deco1.png" }
 *   }
 * }
 * ```
 *
 * ## Design Notes
 *
 * This parser is the "identity" parser — it reads the format that AgentSkin
 * itself produces. It serves as:
 * 1. A reference implementation for other parsers.
 * 2. The parser used when re-importing exported themes.
 * 3. The parser for the built-in themes shipped with the app.
 */

import type { AgentId } from '../../types/agent';
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
const EXTENSIONS = ['.agentskin-theme'];

/** Required entry in the file map for detection. */
const REQUIRED_ENTRY = 'manifest.json';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the input is an agentskin-theme package.
 *
 * Detection strategy:
 * - If `files` is present, check for `manifest.json` entry.
 * - If `path` or `filename` is present, check the extension or directory name.
 */
function canParseSource(source: ParserSource): boolean {
  // File map detection
  if (source.files) {
    return source.files.has(REQUIRED_ENTRY);
  }

  // Extension-based detection
  if (source.filename && EXTENSIONS.some((ext) => source.filename!.endsWith(ext))) {
    return true;
  }
  if (source.path) {
    if (EXTENSIONS.some((ext) => source.path!.endsWith(ext))) return true;
    // Directory path ending with a theme id (no extension) — check if it's a directory
    if (!source.path.includes('.', source.path.lastIndexOf('/'))) {
      // Could be a directory — defer to content check
      return true;
    }
  }

  // JSON content detection
  if (source.json) {
    return isAgentskinManifest(source.json);
  }

  if (source.buffer) {
    try {
      const text = decodeUtf8(source.buffer);
      const json = JSON.parse(text);
      return isAgentskinManifest(json as Record<string, unknown>);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Type guard for agentskin manifest.json structure.
 */
function isAgentskinManifest(json: Record<string, unknown>): boolean {
  // Must have id and at least one of: colors, targets
  if (!json.id) return false;
  const hasColors = typeof json.colors === 'object' && json.colors !== null;
  const hasTargets = typeof json.targets === 'object' && json.targets !== null;
  return hasColors || hasTargets;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an agentskin-theme package into the unified IR.
 */
async function parseSource(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
  let manifest: Record<string, unknown>;
  let files: Map<string, Uint8Array> | undefined;

  if (source.files) {
    files = source.files;
    const manifestBuf = files.get(REQUIRED_ENTRY);
    if (!manifestBuf) {
      throw new ParserError(
        'manifest.json not found in agentskin-theme package',
        'agentskin',
        'agentskin-theme',
      );
    }
    manifest = safeParseJson(decodeUtf8(manifestBuf), 'agentskin', 'agentskin-theme');
  } else if (source.json) {
    manifest = source.json;
  } else if (source.buffer) {
    manifest = safeParseJson(decodeUtf8(source.buffer), 'agentskin', 'agentskin-theme');
  } else {
    throw new ParserError(
      'AgentSkin parser requires files, json, or buffer input',
      'agentskin',
      'agentskin-theme',
    );
  }

  if (!isAgentskinManifest(manifest)) {
    throw new ParserError(
      'Input does not conform to agentskin-theme manifest schema',
      'agentskin',
      'agentskin-theme',
    );
  }

  // --- Theme metadata ---
  const id = coerceString(manifest.id) ?? 'unknown';
  const displayName = coerceString(manifest.displayName) ?? coerceString(manifest.name) ?? id;
  const version = coerceString(manifest.version) ?? '1.0.0';
  const author = extractAuthor(manifest);
  const mode = extractMode(manifest);
  const category = coerceString(manifest.category);
  const tags = extractStringArray(manifest.tags);
  const license = coerceString(manifest.license);

  // --- Colors ---
  const colors = extractColors(manifest);

  // --- Agent CSS ---
  const agentCss = extractAgentCss(manifest, files);

  // --- Images ---
  const images = extractImages(manifest, files);

  return {
    id,
    displayName,
    version,
    author,
    mode,
    category,
    tags,
    colors,
    images,
    agentCss,
    sourceFormat: 'agentskin',
    confidence: 1.0,
    license,
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractAuthor(manifest: Record<string, unknown>): { name: string; url?: string } {
  const raw = manifest.author;
  if (!raw) return { name: 'Unknown' };

  if (typeof raw === 'string') {
    return { name: raw };
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      name: coerceString(obj.name) ?? 'Unknown',
      url: coerceString(obj.url),
    };
  }

  return { name: 'Unknown' };
}

function extractMode(manifest: Record<string, unknown>): 'light' | 'dark' {
  const mode = coerceString(manifest.mode);
  if (mode === 'light' || mode === 'dark') return mode;
  return 'dark';
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

function extractColors(
  manifest: Record<string, unknown>,
): Partial<ThemeIntermediateRepresentation['colors']> {
  const raw = manifest.colors;
  if (!raw || typeof raw !== 'object') return {};

  const src = raw as Record<string, unknown>;
  const colors: Record<string, string> = {};

  // All 14 token keys
  const tokenKeys = [
    'accent',
    'secondary',
    'background',
    'foreground',
    'muted',
    'surface',
    'surfaceElevated',
    'border',
    'codeBackground',
    'codeForeground',
    'inputBackground',
    'buttonBackground',
    'buttonForeground',
    'focusRing',
    'selection',
  ] as const;

  for (const key of tokenKeys) {
    const value = coerceString(src[key]);
    if (value) {
      colors[key] = value;
    }
  }

  // Also capture extended colors
  if (src.extended && typeof src.extended === 'object') {
    for (const [k, v] of Object.entries(src.extended as Record<string, unknown>)) {
      const str = coerceString(v);
      if (str && !colors[k]) {
        colors[k] = str;
      }
    }
  }

  return colors;
}

/**
 * Extract per-agent CSS from the manifest's `targets` field.
 *
 * The manifest stores CSS as file paths (e.g. `"assets/css/traework.css"`).
 * This function resolves those paths against the file map to read the
 * actual CSS content.
 */
function extractAgentCss(
  manifest: Record<string, unknown>,
  files: Map<string, Uint8Array> | undefined,
): Partial<Record<AgentId, string>> {
  const result: Partial<Record<AgentId, string>> = {};
  const targets = manifest.targets;

  if (!targets || typeof targets !== 'object') return result;

  for (const [key, value] of Object.entries(targets as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;

    const targetObj = value as Record<string, unknown>;
    const cssPath = coerceString(targetObj.css);
    if (!cssPath) continue;

    // Try to resolve the CSS from the file map
    if (files) {
      const cssBuf = findFileInMap(files, cssPath);
      if (cssBuf) {
        const agentId = key as AgentId;
        result[agentId] = decodeUtf8(cssBuf);
      }
    }
  }

  return result;
}

/**
 * Extract images from the package.
 *
 * Reads icon, preview, hero from the file map based on manifest references.
 * Additional images from `assets.images` are loaded as textures/decorations.
 */
function extractImages(
  manifest: Record<string, unknown>,
  files: Map<string, Uint8Array> | undefined,
): ThemeImages {
  const images: ThemeImages = {};

  if (!files) return images;

  // Icon
  const iconName = coerceString(manifest.icon);
  if (iconName) {
    const buf = findFileInMap(files, iconName);
    if (buf) {
      images.icon = {
        data: buf,
        ext: inferExt(iconName),
        filename: iconName,
        mimeType: mimeTypeForExt(iconName),
      };
    }
  }

  // Preview
  const previewName = coerceString(manifest.preview);
  if (previewName) {
    const buf = findFileInMap(files, previewName);
    if (buf) {
      images.preview = {
        data: buf,
        ext: inferExt(previewName),
        filename: previewName,
        mimeType: mimeTypeForExt(previewName),
      };
    }
  }

  // Hero
  const heroName = coerceString(manifest.hero);
  if (heroName) {
    const buf = findFileInMap(files, heroName);
    if (buf) {
      images.hero = {
        data: buf,
        ext: inferExt(heroName),
        filename: heroName,
        mimeType: mimeTypeForExt(heroName),
      };
    }
  }

  // Additional images from assets.images
  const assetsImages =
    manifest.assets && typeof manifest.assets === 'object'
      ? (manifest.assets as Record<string, unknown>).images
      : undefined;

  if (assetsImages && typeof assetsImages === 'object') {
    for (const [id, relPath] of Object.entries(assetsImages as Record<string, unknown>)) {
      const path = coerceString(relPath);
      if (!path) continue;

      const buf = findFileInMap(files, path);
      if (!buf) continue;

      const asset: ImageAsset = {
        data: buf,
        ext: inferExt(path),
        filename: path,
        mimeType: mimeTypeForExt(path),
      };

      // Skip reserved ids
      if (id === 'icon' || id === 'preview' || id === 'hero') continue;

      // Heuristic: small images are decorations, large ones are textures
      if (buf.length < 100_000) {
        images.decorations = [...(images.decorations ?? []), asset];
      } else {
        images.textures = [...(images.textures ?? []), asset];
      }
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// File map utilities
// ---------------------------------------------------------------------------

/**
 * Find a file in the map, trying both the exact path and common variations.
 */
function findFileInMap(files: Map<string, Uint8Array>, path: string): Uint8Array | undefined {
  // Exact match
  if (files.has(path)) return files.get(path);

  // Try without leading ./
  if (path.startsWith('./')) {
    const stripped = path.slice(2);
    if (files.has(stripped)) return files.get(stripped);
  }

  // Case-insensitive fallback
  const lowerPath = path.toLowerCase();
  for (const [key, value] of files) {
    if (key.toLowerCase() === lowerPath) return value;
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
 * AgentSkin native theme package parser.
 *
 * Handles `.agentskin-theme` directory packages (the format produced by
 * AgentSkin Studio and the build pipeline).
 * Registered with priority 5 (highest — native format is unambiguous).
 */
export const agentskinBuiltParser: ThemeSourceParser = {
  name: 'agentskin',
  description: 'AgentSkin native theme package (.agentskin-theme directory with manifest.json)',
  extensions: ['.agentskin-theme'],

  canParse(source: ParserSource): boolean {
    return canParseSource(source);
  },

  async parse(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
    return parseSource(source);
  },
};
