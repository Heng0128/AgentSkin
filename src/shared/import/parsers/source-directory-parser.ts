// SPDX-License-Identifier: MPL-2.0

/**
 * # Source Directory Parser
 *
 * Parses raw source theme directories — the development format used in the
 * AgentSkin `themes/` directory before packaging. This is the most flexible
 * parser, handling both structured manifests and ad-hoc CSS/color files.
 *
 * ## Source Format Structure
 *
 * A source theme directory may contain:
 *
 * ```
 * manifest.json         — Optional structured manifest (same as agentskin-theme)
 * theme.css             — Optional single CSS file (applied to all agents)
 * colors.json           — Optional color palette (14-token or custom)
 * icon.png              — Optional icon
 * preview.png           — Optional preview
 * hero.png              — Optional hero artwork
 * assets/               — Optional subdirectory with additional files
 *   css/                — Per-agent CSS files (traework.css, etc.)
 *   images/             — Additional images
 * README.md             — Optional documentation
 * ```
 *
 * ## Detection Strategy
 *
 * This parser is the "catch-all" — it accepts any directory that contains
 * at least one of: `manifest.json`, `theme.css`, `colors.json`, or any
 * `.css` file. It has the lowest priority (registered last) so that more
 * specific parsers get first chance.
 *
 * ## Color Extraction
 *
 * Colors are sourced from (in priority order):
 * 1. `manifest.colors` (14-token system)
 * 2. `colors.json` (flat key-value or nested)
 * 3. CSS custom properties (`--agentskin-*` or `--miku-*` etc.)
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

/** Required entries for detection (at least one must be present). */
const DETECTION_ENTRIES = ['manifest.json', 'theme.css', 'colors.json'];

/** CSS file patterns that indicate a theme directory. */
const CSS_PATTERNS = ['.css'];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the input is a source theme directory.
 *
 * This is a catch-all parser — it accepts any directory with recognizable
 * theme files. Returns `false` only if the input clearly isn't a theme.
 */
function canParseSource(source: ParserSource): boolean {
  // File map detection
  if (source.files) {
    return hasThemeEntries(source.files);
  }

  // Path-based detection (directory path)
  if (source.path) {
    // If it's a directory-like path (no file extension), accept it
    const lastPart = source.path.split('/').pop() ?? source.path.split('\\').pop() ?? '';
    if (!lastPart.includes('.')) return true;
  }

  // JSON detection (manifest.json content)
  if (source.json) {
    return hasManifestStructure(source.json);
  }

  if (source.buffer) {
    try {
      const text = decodeUtf8(source.buffer);
      const json = JSON.parse(text);
      return hasManifestStructure(json as Record<string, unknown>);
    } catch {
      // Not JSON — could still be a CSS file
      return false;
    }
  }

  return false;
}

function hasThemeEntries(files: Map<string, Uint8Array>): boolean {
  // Check for known theme files
  for (const entry of DETECTION_ENTRIES) {
    if (files.has(entry)) return true;
  }

  // Check for any CSS file
  for (const key of files.keys()) {
    if (CSS_PATTERNS.some((p) => key.endsWith(p))) return true;
  }

  return false;
}

function hasManifestStructure(json: Record<string, unknown>): boolean {
  // Has theme-identifying fields
  if (json.id || json.name || json.displayName) return true;
  if (json.colors && typeof json.colors === 'object') return true;
  if (json.targets && typeof json.targets === 'object') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a source theme directory into the unified IR.
 */
async function parseSource(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
  if (!source.files) {
    throw new ParserError(
      'Source directory parser requires pre-read files (Map<string, Uint8Array>)',
      'source-directory',
      'source-directory',
    );
  }

  const files = source.files;

  // 1. Try to parse manifest.json
  let manifest: Record<string, unknown> | undefined;
  const manifestBuf = files.get('manifest.json');
  if (manifestBuf) {
    try {
      manifest = safeParseJson(decodeUtf8(manifestBuf), 'source-directory', 'source-directory');
    } catch {
      // Manifest exists but is malformed — continue without it
    }
  }

  // 2. Try to parse colors.json
  let colorsJson: Record<string, unknown> | undefined;
  const colorsBuf = files.get('colors.json');
  if (colorsBuf) {
    try {
      colorsJson = safeParseJson(decodeUtf8(colorsBuf), 'source-directory', 'source-directory');
    } catch {
      // Ignore malformed colors.json
    }
  }

  // 3. Extract metadata
  const id = extractId(manifest, files);
  const displayName = extractDisplayName(manifest, id);
  const version = extractVersion(manifest);
  const author = extractAuthor(manifest);
  const mode = extractMode(manifest);
  const category = extractCategory(manifest);
  const tags = extractTags(manifest);

  // 4. Extract colors (priority: manifest > colors.json > CSS vars)
  const colors = extractColors(manifest, colorsJson);

  // 5. Extract CSS
  const agentCss = extractAgentCss(files, manifest);

  // 6. Extract images
  const images = extractImages(files);

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
    sourceFormat: 'source-directory',
    confidence: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractId(
  manifest: Record<string, unknown> | undefined,
  files: Map<string, Uint8Array>,
): string {
  if (manifest) {
    const id = coerceString(manifest.id);
    if (id) return id;
    const name = coerceString(manifest.name);
    if (name) return slugify(name);
  }

  // Derive from directory name (last path segment)
  // Since we don't have the path here, use a hash of the file list
  const fileList = [...files.keys()].sort().join(',');
  return `source-theme-${simpleHash(fileList).slice(0, 8)}`;
}

function extractDisplayName(
  manifest: Record<string, unknown> | undefined,
  fallback: string,
): string {
  if (manifest) {
    return coerceString(manifest.displayName) ?? coerceString(manifest.name) ?? fallback;
  }
  return fallback;
}

function extractVersion(manifest: Record<string, unknown> | undefined): string {
  if (manifest) {
    return coerceString(manifest.version) ?? '1.0.0';
  }
  return '1.0.0';
}

function extractAuthor(manifest: Record<string, unknown> | undefined): {
  name: string;
  url?: string;
} {
  if (!manifest) return { name: 'Unknown' };

  const raw = manifest.author;
  if (typeof raw === 'string') return { name: raw };
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      name: coerceString(obj.name) ?? 'Unknown',
      url: coerceString(obj.url),
    };
  }
  return { name: 'Unknown' };
}

function extractMode(manifest: Record<string, unknown> | undefined): 'light' | 'dark' {
  if (manifest) {
    const mode = coerceString(manifest.mode);
    if (mode === 'light' || mode === 'dark') return mode;
  }
  return 'dark';
}

function extractCategory(manifest: Record<string, unknown> | undefined): string | undefined {
  if (manifest) {
    return coerceString(manifest.category);
  }
  return undefined;
}

function extractTags(manifest: Record<string, unknown> | undefined): string[] {
  if (!manifest || !Array.isArray(manifest.tags)) return [];
  return manifest.tags.map((t) => String(t)).filter(Boolean);
}

function extractColors(
  manifest: Record<string, unknown> | undefined,
  colorsJson: Record<string, unknown> | undefined,
): Partial<ThemeIntermediateRepresentation['colors']> {
  const colors: Record<string, string> = {};

  // From manifest
  if (manifest?.colors && typeof manifest.colors === 'object') {
    const manifestColors = manifest.colors as Record<string, unknown>;
    mergeColors(colors, manifestColors);
  }

  // From colors.json (may override manifest)
  if (colorsJson) {
    // Handle flat structure: { "accent": "#ff0000", ... }
    mergeColors(colors, colorsJson);

    // Handle nested: { "colors": { "accent": "#ff0000", ... } }
    if (colorsJson.colors && typeof colorsJson.colors === 'object') {
      mergeColors(colors, colorsJson.colors as Record<string, unknown>);
    }
  }

  return colors;
}

function mergeColors(target: Record<string, string>, source: Record<string, unknown>): void {
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
  ];

  for (const key of tokenKeys) {
    const value = coerceString(source[key]);
    if (value && !target[key]) {
      target[key] = value;
    }
  }
}

/**
 * Extract per-agent CSS from the source directory.
 *
 * Strategy:
 * 1. If manifest has `targets`, resolve CSS file paths.
 * 2. Otherwise, look for `assets/css/<agent>.css` files.
 * 3. Fall back to `theme.css` for all agents.
 */
function extractAgentCss(
  files: Map<string, Uint8Array>,
  manifest: Record<string, unknown> | undefined,
): Partial<Record<AgentId, string>> {
  const result: Partial<Record<AgentId, string>> = {};

  // Strategy 1: manifest targets
  if (manifest?.targets && typeof manifest.targets === 'object') {
    for (const [key, value] of Object.entries(manifest.targets as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const cssPath = coerceString((value as Record<string, unknown>).css);
      if (!cssPath) continue;

      const buf = findFileInMap(files, cssPath);
      if (buf) {
        result[key as AgentId] = decodeUtf8(buf);
      }
    }

    if (Object.keys(result).length > 0) return result;
  }

  // Strategy 2: assets/css/<agent>.css
  for (const agentId of ALL_AGENT_IDS) {
    const candidates = [`assets/css/${agentId}.css`, `css/${agentId}.css`, `${agentId}.css`];

    for (const candidate of candidates) {
      const buf = findFileInMap(files, candidate);
      if (buf) {
        result[agentId] = decodeUtf8(buf);
        break;
      }
    }
  }

  if (Object.keys(result).length > 0) return result;

  // Strategy 3: theme.css for all agents
  const themeCss = findFileInMap(files, 'theme.css');
  if (themeCss) {
    const css = decodeUtf8(themeCss);
    for (const agentId of ALL_AGENT_IDS) {
      result[agentId] = css;
    }
  }

  return result;
}

/**
 * Extract images from the source directory.
 */
function extractImages(files: Map<string, Uint8Array>): ThemeImages {
  const images: ThemeImages = {};

  // Standard image slots
  const singleSlots: Array<{ key: string; setter: (img: ImageAsset) => void }> = [
    {
      key: 'icon.png',
      setter: (img) => {
        images.icon = img;
      },
    },
    {
      key: 'icon.jpg',
      setter: (img) => {
        images.icon = img;
      },
    },
    {
      key: 'preview.png',
      setter: (img) => {
        images.preview = img;
      },
    },
    {
      key: 'preview.jpg',
      setter: (img) => {
        images.preview = img;
      },
    },
    {
      key: 'hero.png',
      setter: (img) => {
        images.hero = img;
      },
    },
    {
      key: 'hero.jpg',
      setter: (img) => {
        images.hero = img;
      },
    },
  ];

  for (const slot of singleSlots) {
    const buf = files.get(slot.key);
    if (buf) {
      slot.setter({
        data: buf,
        ext: inferExt(slot.key),
        filename: slot.key,
        mimeType: mimeTypeForExt(slot.key),
      });
    }
  }

  // Additional images from assets/images/
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  const knownFiles = new Set([
    'icon.png',
    'icon.jpg',
    'preview.png',
    'preview.jpg',
    'hero.png',
    'hero.jpg',
  ]);

  for (const [filename, data] of files) {
    if (filename === 'manifest.json' || filename === 'colors.json') continue;
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
    if (data.length < 100_000) {
      images.decorations = [...(images.decorations ?? []), asset];
    } else {
      images.textures = [...(images.textures ?? []), asset];
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function findFileInMap(files: Map<string, Uint8Array>, path: string): Uint8Array | undefined {
  if (files.has(path)) return files.get(path);

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Exported parser instance
// ---------------------------------------------------------------------------

/**
 * Source directory theme parser (catch-all).
 *
 * Handles raw theme source directories with flexible structure.
 * Registered with priority 100 (lowest — last resort after specific parsers).
 */
export const sourceDirectoryParser: ThemeSourceParser = {
  name: 'source-directory',
  description: 'Raw source theme directory (manifest.json / theme.css / colors.json)',
  extensions: [],

  canParse(source: ParserSource): boolean {
    return canParseSource(source);
  },

  async parse(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
    return parseSource(source);
  },
};
