// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-string-format
 *
 * AgentSkin theme share-string format (`agentskin-theme-v1:`). Encodes a
 * ThemeManifest into a compact, copy-paste-friendly string for quick sharing
 * between users without ZIP file exchange.
 *
 * Format: `agentskin-theme-v1:<base64(JSON)>`
 *
 * The JSON payload is a slim subset of ThemeManifest containing only the
 * fields needed to reconstruct a working theme: id, name, version, tokens
 * (at minimum primary/accent/background), and optional colors.
 *
 * Versioning: the `v` field inside the JSON tracks the wire-format version.
 * Currently only `"1"` is supported. Future versions add a new `v` value and
 * a new prefix (e.g. `agentskin-theme-v2:`); decoders reject unknown versions.
 */

import type { ThemeManifest } from '../types/theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix that identifies an AgentSkin theme share string. */
export const THEME_STRING_PREFIX = 'agentskin-theme-v1:';

/** Wire-format versions currently supported by this module. */
const SUPPORTED_FORMAT_VERSIONS = new Set<string>(['1']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * JSON payload inside the share string. `v` is the wire-format version
 * (independent of the theme's own `version` semver). `tokens` carries the
 * essential color tokens; `colors` carries the full 14-token palette when
 * available.
 */
export interface ThemeStringPayload {
  /** Wire-format version (currently "1"). */
  v: string;
  id: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  author?: string;
  mode?: 'dark' | 'light' | 'auto';
  /** Essential color tokens (primary/accent/background at minimum). */
  tokens: {
    primary: string;
    accent: string;
    background: string;
    [key: string]: string;
  };
  /** Full 14-token palette (optional). */
  colors?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Base64 helpers (cross-environment: browser + Node.js)
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string to base64. Uses `btoa` with a TextEncoder-based
 * binary conversion so that non-ASCII content (e.g. Chinese theme names)
 * round-trips correctly in both browser and Node.js.
 */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string back to UTF-8. Uses `atob` + TextDecoder for
 * correct handling of multi-byte characters.
 */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a ThemeManifest into an `agentskin-theme-v1:` share string.
 *
 * The function extracts the essential fields and the three required tokens
 * (primary, accent, background) from the manifest's `colors`. If any of
 * those tokens are missing they fall back to sensible defaults so the string
 * is always producible.
 */
export function encodeThemeToString(theme: ThemeManifest): string {
  const colors = theme.colors ?? {};
  const tokens = {
    primary: colors.primary ?? colors.accent ?? '#3B82F6',
    accent: colors.accent ?? colors.primary ?? '#3B82F6',
    background: colors.background ?? '#1E1E2E',
    ...Object.fromEntries(
      Object.entries(colors).filter(
        ([key]) => key !== 'primary' && key !== 'accent' && key !== 'background',
      ),
    ),
  };

  const payload: ThemeStringPayload = {
    v: '1',
    id: theme.id,
    name: theme.name,
    version: theme.version,
    displayName: (theme as { displayName?: string }).displayName,
    description: theme.description ?? undefined,
    author: typeof theme.author === 'string' ? theme.author : undefined,
    mode: theme.mode,
    tokens,
    colors: Object.keys(colors).length > 0 ? colors : undefined,
  };

  const json = JSON.stringify(payload);
  return `${THEME_STRING_PREFIX}${utf8ToBase64(json)}`;
}

/**
 * Decode an `agentskin-theme:` share string back into a ThemeManifest.
 *
 * Returns `null` when:
 *  - the prefix is missing or the version is unsupported
 *  - the base64 payload cannot be decoded
 *  - the JSON cannot be parsed
 *  - required fields (id, name, version, tokens with primary/accent/background) are missing
 */
export function decodeThemeFromString(str: string): ThemeManifest | null {
  if (!str || typeof str !== 'string') return null;

  const prefixIndex = str.indexOf(THEME_STRING_PREFIX);
  if (prefixIndex === -1) return null;

  const b64 = str.slice(prefixIndex + THEME_STRING_PREFIX.length).trim();
  if (!b64) return null;

  let json: string;
  try {
    json = base64ToUtf8(b64);
  } catch {
    return null;
  }

  let payload: ThemeStringPayload;
  try {
    payload = JSON.parse(json) as ThemeStringPayload;
  } catch {
    return null;
  }

  // Version check — unsupported wire-format version returns null.
  if (!SUPPORTED_FORMAT_VERSIONS.has(payload.v)) return null;

  // Required fields check.
  if (!payload.id || !payload.name || !payload.version) return null;
  if (!payload.tokens || typeof payload.tokens !== 'object') return null;
  if (!payload.tokens.primary || !payload.tokens.accent || !payload.tokens.background) {
    return null;
  }

  return {
    id: payload.id,
    name: payload.name,
    version: payload.version,
    author: payload.author ?? null,
    description: payload.description ?? null,
    supportedAgents: [],
    preview: null,
    mode: payload.mode,
    colors: payload.colors ?? payload.tokens,
  };
}

/**
 * Validate a theme share string without fully decoding it into a manifest.
 * Returns a `ValidationResult` with a `valid` flag and a list of human-readable
 * error messages (empty when valid).
 */
export function validateThemeString(str: string): ValidationResult {
  const errors: string[] = [];

  if (!str || typeof str !== 'string') {
    return { valid: false, errors: ['Input is empty or not a string'] };
  }

  if (!str.includes(THEME_STRING_PREFIX)) {
    return {
      valid: false,
      errors: [`Missing required prefix "${THEME_STRING_PREFIX}"`],
    };
  }

  const b64 = str.slice(str.indexOf(THEME_STRING_PREFIX) + THEME_STRING_PREFIX.length).trim();
  if (!b64) {
    return { valid: false, errors: ['No payload after prefix'] };
  }

  let json: string;
  try {
    json = base64ToUtf8(b64);
  } catch {
    return { valid: false, errors: ['Base64 decoding failed'] };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { valid: false, errors: ['JSON parsing failed'] };
  }

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, errors: ['Payload is not a JSON object'] };
  }

  const p = payload as Record<string, unknown>;

  // Version check.
  if (!SUPPORTED_FORMAT_VERSIONS.has(p.v as string)) {
    errors.push(
      `Unsupported format version "${String(p.v)}" (supported: ${[...SUPPORTED_FORMAT_VERSIONS].join(', ')})`,
    );
  }

  // Required fields.
  for (const field of ['id', 'name', 'version']) {
    if (!p[field] || typeof p[field] !== 'string') {
      errors.push(`Missing or invalid required field "${field}"`);
    }
  }

  // Tokens check.
  if (!p.tokens || typeof p.tokens !== 'object' || Array.isArray(p.tokens)) {
    errors.push('Missing or invalid "tokens" object');
  } else {
    const tokens = p.tokens as Record<string, unknown>;
    for (const token of ['primary', 'accent', 'background']) {
      if (!tokens[token] || typeof tokens[token] !== 'string') {
        errors.push(`Missing required token "${token}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
