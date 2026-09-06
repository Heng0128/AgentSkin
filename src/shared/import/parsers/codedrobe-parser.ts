// SPDX-License-Identifier: MPL-2.0

/**
 * # Codedrobe Parser
 *
 * Parses `.codedrobe-theme` files — a single-file JSON format containing:
 *
 *   - Theme metadata (id, displayName, version, catalog with i18n names)
 *   - Per-adapter CSS (targets: codex, qoderwork, traework, workbuddy, …)
 *   - Base64-encoded images (hero, texture, etc.)
 *
 * ## Source Format Structure
 *
 * ```json
 * {
 *   "format": "codedrobe-theme",
 *   "schemaVersion": "1.0",
 *   "exportedAt": "2026-01-01T00:00:00Z",
 *   "theme": {
 *     "id": "miku-future-beats",
 *     "displayName": "Hatsune Miku · Future Beats",
 *     "version": "1.2.0",
 *     "catalog": {
 *       "name": { "en": "...", "zh": "..." },
 *       "description": { "en": "...", "zh": "..." },
 *       "categories": ["character", "futuristic"]
 *     }
 *   },
 *   "targets": {
 *     "codex": { { "css": ":root.codedrobe-codex-skin { ... }" },
 *     "qoderwork": { "css": "..." },
 *     "traework": { "css": "..." },
 *     "workbuddy": { "css": "..." }
 *   },
 *   "assets": {
 *     "images": {
 *       "hero": { "filename": "hero.png", "mimeType": "image/png", "base64": "..." },
 *       "texture": { "filename": "texture.png", "mimeType": "image/png", "base64": "..." }
 *     }
 *   }
 * }
 * ```
 *
 * ## Mapping to AgentId
 *
 * Codedrobe target keys (`codex`, `qoderwork`, `traework`, `workbuddy`) map
 * directly to AgentId. CSS variable names (`--miku-*`, `--doll-*`, `--codedrobe-*`)
 * are preserved as-is in the IR — downstream normalization handles the
 * conversion to `--agentskin-*` tokens.
 */

import { createHash } from 'node:crypto';
import type { AgentId } from '../../types/agent';
import {
  coerceString,
  decodeUtf8,
  getNested,
  type ImageAsset,
  ParserError,
  type ParserSource,
  safeParseJson,
  type ThemeImages,
  type ThemeIntermediateRepresentation,
  type ThemeSourceParser,
} from '../theme-source-parser';

/** Codedrobe target key → AgentId mapping (they align 1:1). */
const CODEDROBE_TARGET_MAP: Record<string, AgentId> = {
  codex: 'codex',
  qoderwork: 'qoderwork',
  traework: 'traework',
  workbuddy: 'workbuddy',
  doubao: 'doubao',
  zcode: 'zcode',
};

/** Supported file extensions for this parser. */
const EXTENSIONS = ['.codedrobe-theme'];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the input is a valid `.codedrobe-theme` file.
 *
 * Detection strategy:
 * - If `buffer` or `json` is present, parse and check top-level keys.
 * - If `path` or `filename` is present, check the file extension.
 */
function canParseSource(source: ParserSource): boolean {
  // Extension-based detection — use local vars to preserve narrowing into callbacks
  const filename = source.filename;
  const path = source.path;
  if (filename && EXTENSIONS.some((ext) => filename.endsWith(ext))) {
    return true;
  }
  if (path && EXTENSIONS.some((ext) => path.endsWith(ext))) {
    return true;
  }

  // Content-based detection (JSON with codedrobe signature)
  if (source.json) {
    return isCodedrobeJson(source.json);
  }

  if (source.buffer) {
    try {
      const text = decodeUtf8(source.buffer);
      const json = JSON.parse(text);
      return isCodedrobeJson(json as Record<string, unknown>);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Type guard for the codedrobe JSON structure.
 */
function isCodedrobeJson(json: Record<string, unknown>): boolean {
  // Must have format field or at least theme + targets
  if (json.format === 'codedrobe-theme') return true;
  const hasTheme = typeof json.theme === 'object' && json.theme !== null;
  const hasTargets = typeof json.targets === 'object' && json.targets !== null;
  const hasAssets = typeof json.assets === 'object' && json.assets !== null;
  return hasTheme && hasTargets && hasAssets;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `.codedrobe-theme` source into the unified IR.
 */
async function parseSource(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
  let json: Record<string, unknown>;

  if (source.json) {
    json = source.json;
  } else if (source.buffer) {
    const text = decodeUtf8(source.buffer);
    json = safeParseJson(text, 'codedrobe', 'codedrobe-theme');
  } else {
    throw new ParserError(
      'Codedrobe parser requires buffer or json input',
      'codedrobe',
      'codedrobe-theme',
    );
  }

  if (!isCodedrobeJson(json)) {
    throw new ParserError(
      'Input does not conform to codedrobe-theme schema (missing theme/targets/assets)',
      'codedrobe',
      'codedrobe-theme',
    );
  }

  const theme = (json.theme ?? {}) as Record<string, unknown>;
  const targets = (json.targets ?? {}) as Record<string, unknown>;
  const assets = (json.assets ?? {}) as Record<string, unknown>;

  // --- Theme metadata ---
  const id = extractThemeId(theme);
  const displayName = extractDisplayName(theme);
  const version = coerceString(theme.version) ?? '1.0.0';
  const catalog = (theme.catalog ?? {}) as Record<string, unknown>;
  const categories = extractCategories(catalog);
  const localizedNames = extractLocalizedText(catalog, 'name');
  const localizedDescriptions = extractLocalizedText(catalog, 'description');

  // --- Agent CSS ---
  const agentCss = extractAgentCss(targets);

  // --- Images ---
  const images = extractImages(assets);

  // --- Mode detection (codedrobe themes are typically light or based on CSS) ---
  const mode = detectMode(agentCss);

  // --- Source integrity hash (SHA-256 of the raw source buffer) ---
  // Provides tamper detection for marketplace / import verification.
  const sourceIntegrity = computeSourceIntegrity(source.buffer);

  return {
    id,
    displayName,
    version,
    author: { name: 'Codedrobe' },
    mode,
    category: categories[0],
    tags: categories,
    colors: {}, // Codedrobe themes use CSS vars, not 4-token palette directly
    images,
    agentCss,
    sourceFormat: 'codedrobe',
    confidence: 0.85,
    localizedNames,
    localizedDescriptions,
    sourceIntegrity,
  };
}

// ---------------------------------------------------------------------------
// Source integrity
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a codedrobe-theme source buffer.
 * Returns undefined if no buffer is available or hashing fails.
 *
 * @param buffer - Raw bytes of the codedrobe-theme file.
 */
function computeSourceIntegrity(buffer: Uint8Array | undefined): string | undefined {
  if (!buffer || buffer.length === 0) return undefined;
  try {
    return createHash('sha256').update(buffer).digest('hex');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractThemeId(theme: Record<string, unknown>): string {
  const id = coerceString(theme.id);
  if (id) return id;

  // Fallback: derive from displayName
  const name = coerceString(theme.displayName);
  if (name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 64);
  }

  throw new ParserError(
    'Codedrobe theme missing required "id" field',
    'codedrobe',
    'codedrobe-theme',
  );
}

function extractDisplayName(theme: Record<string, unknown>): string {
  const displayName = coerceString(theme.displayName);
  if (displayName) return displayName;
  const id = coerceString(theme.id);
  if (id) return id;
  return 'Untitled Codedrobe Theme';
}

function extractCategories(catalog: Record<string, unknown>): string[] {
  const raw = catalog.categories;
  if (Array.isArray(raw)) {
    return raw.map((c) => String(c)).filter(Boolean);
  }
  return [];
}

function extractLocalizedText(
  catalog: Record<string, unknown>,
  field: string,
): Record<string, string> | undefined {
  const raw = catalog[field];
  if (!raw || typeof raw !== 'object') return undefined;

  const result: Record<string, string> = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    const str = coerceString(value);
    if (str) result[locale] = str;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractAgentCss(targets: Record<string, unknown>): Partial<Record<AgentId, string>> {
  const result: Partial<Record<AgentId, string>> = {};

  for (const [key, value] of Object.entries(targets)) {
    const agentId = CODEDROBE_TARGET_MAP[key];
    if (!agentId) continue;

    if (value && typeof value === 'object') {
      const targetObj = value as Record<string, unknown>;
      const css = coerceString(targetObj.css);
      if (css) {
        result[agentId] = css;
      }
    }
  }

  return result;
}

function extractImages(assets: Record<string, unknown>): ThemeImages {
  const images: ThemeImages = {};
  const imagesObj = getNested(assets, 'images') as Record<string, unknown> | undefined;
  if (!imagesObj || typeof imagesObj !== 'object') return images;

  // Single-slot images
  const singleSlots: Array<{ key: string; setter: (img: ImageAsset) => void }> = [
    {
      key: 'icon',
      setter: (img) => {
        images.icon = img;
      },
    },
    {
      key: 'preview',
      setter: (img) => {
        images.preview = img;
      },
    },
    {
      key: 'hero',
      setter: (img) => {
        images.hero = img;
      },
    },
  ];

  for (const slot of singleSlots) {
    const imgData = imagesObj[slot.key];
    if (!imgData || typeof imgData !== 'object') continue;
    const asset = decodeImageAsset(imgData as Record<string, unknown>);
    if (asset) slot.setter(asset);
  }

  // Texture images (texture, texture1, texture2, …)
  for (const [key, value] of Object.entries(imagesObj)) {
    if (!key.startsWith('texture') || typeof value !== 'object') continue;
    const asset = decodeImageAsset(value as Record<string, unknown>);
    if (asset) {
      images.textures = [...(images.textures ?? []), asset];
    }
  }

  // Decoration images
  for (const [key, value] of Object.entries(imagesObj)) {
    if (!key.startsWith('decoration') || typeof value !== 'object') continue;
    const asset = decodeImageAsset(value as Record<string, unknown>);
    if (asset) {
      images.decorations = [...(images.decorations ?? []), asset];
    }
  }

  return images;
}

/**
 * Decode a single image entry from the codedrobe assets object.
 *
 * Supports `{ filename, mimeType, base64 }` structure.
 */
function decodeImageAsset(data: Record<string, unknown>): ImageAsset | undefined {
  const base64 = coerceString(data.base64);
  if (!base64) return undefined;

  const ext = inferImageExt(data);
  const mimeType = coerceString(data.mimeType);

  return {
    data: base64ToBytes(base64),
    ext,
    mimeType,
    filename: coerceString(data.filename),
  };
}

function inferImageExt(data: Record<string, unknown>): string {
  const filename = coerceString(data.filename);
  if (filename) {
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx !== -1) return filename.slice(dotIdx + 1).toLowerCase();
  }

  const mimeType = coerceString(data.mimeType);
  if (mimeType) {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      case 'image/gif':
        return 'gif';
      default:
        return 'png';
    }
  }

  return 'png';
}

/**
 * Convert a base64 string to a Uint8Array.
 *
 * Works in both Node.js and browser environments.
 */
function base64ToBytes(base64: string): Uint8Array {
  // Strip data URL prefix if present
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');

  if (typeof atob === 'function') {
    // Browser / modern runtime
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js Buffer fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Buffer = (
    globalThis as { Buffer?: { from: (data: string, encoding: string) => Uint8Array } }
  ).Buffer;
  if (Buffer) {
    return Buffer.from(cleaned, 'base64');
  }

  throw new ParserError(
    'No base64 decoder available (neither atob nor Buffer)',
    'codedrobe',
    'codedrobe-theme',
  );
}

/**
 * Detect light/dark mode from the CSS content.
 *
 * Heuristic: look for `color-scheme: dark` in any agent CSS.
 */
function detectMode(agentCss: Partial<Record<AgentId, string>>): 'light' | 'dark' {
  for (const css of Object.values(agentCss)) {
    if (css?.includes('color-scheme: dark')) {
      return 'dark';
    }
  }
  return 'light';
}

// ---------------------------------------------------------------------------
// Exported parser instance
// ---------------------------------------------------------------------------

/**
 * Codedrobe theme source parser.
 *
 * Handles `.codedrobe-theme` files (JSON + base64 images).
 * Registered with priority 10 (high — single-file formats are unambiguous).
 */
export const codedrobeParser: ThemeSourceParser = {
  name: 'codedrobe',
  description: 'Codedrobe multi-agent theme package (.codedrobe-theme JSON + base64 images)',
  extensions: ['.codedrobe-theme'],

  canParse(source: ParserSource): boolean {
    return canParseSource(source);
  },

  async parse(source: ParserSource): Promise<ThemeIntermediateRepresentation> {
    return parseSource(source);
  },
};
