// SPDX-License-Identifier: MIT
//
// # theme-distribution.mjs — Theme Store Distribution Protocol
//
// Provides integrity verification and deep-link handling for the AgentSkin
// theme store distribution pipeline. The architecture it enables is:
//
//   theme bundle (file on disk)
//        │
//        ▼
//   generateManifest(bundlePath)  →  DistributionManifest
//        │                              │  .sha256  — integrity fingerprint
//        │                              │  .size    — byte length
//        │                              │  .agents  — supported adapters
//        ▼
//   verifyIntegrity(bundlePath, expectedSha256)  →  boolean
//        │
//        ▼
//   generateDeepLink(themeId, agent?)  →  "agentskin://themes/apply?theme=<id>&app=<agent>"
//        │
//        ▼
//   parseDeepLink(url)  →  { action, themeId, agent? }
//
// No third-party deps: uses Node.js built-in `crypto` for SHA-256 and
// `node:fs` for file reads. The deep-link protocol `agentskin://` is
// registered at the OS level by the Electron main process.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types (JSDoc — consumed by IDEs / tsc --checkJs, not enforced at runtime)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DistributionManifest
 * @property {string} version        Semantic version of the theme package.
 * @property {string} themeId        Unique identifier (matches directory name).
 * @property {string} themeName      Human-readable display name.
 * @property {string} author         Author name or handle.
 * @property {string} sha256         Lowercase hex SHA-256 digest of the bundle.
 * @property {number} size           File size in bytes.
 * @property {string} createdAt      ISO-8601 timestamp of manifest generation.
 * @property {string[]} agents       List of supported agent IDs.
 */

/**
 * @typedef {'traework'|'qoderwork'|'workbuddy'|'doubao'|'codex'|'zcode'} AgentId
 */

/**
 * @typedef {Object} DeepLinkInfo
 * @property {string} action         The path segment (e.g. "themes/apply").
 * @property {string} themeId        The theme identifier extracted from the URL.
 * @property {string} [agent]        Optional target agent ID.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported agent identifiers — aligned with the 6-adapter contract. */
export const SUPPORTED_AGENTS = Object.freeze([
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
]);

/** Deep-link protocol scheme. */
export const DEEP_LINK_SCHEME = 'agentskin';

/** Deep-link action path for theme application. */
export const DEEP_LINK_ACTION_APPLY = 'themes/apply';

// ---------------------------------------------------------------------------
// SHA-256 integrity
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file's contents.
 *
 * Reads the file in streaming mode to handle large bundles without
 * loading the entire content into memory at once.
 *
 * @param {string} filePath — absolute or relative path to the file.
 * @returns {Promise<string>} Lowercase hex-encoded SHA-256 digest.
 * @throws {Error} If the file cannot be read (e.g. not found, permission denied).
 */
export async function computeSha256(filePath) {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/**
 * Verify a bundle's integrity by comparing its SHA-256 digest against
 * an expected value. Comparison is timing-safe via `crypto.timingSafeEqual`
 * to mitigate timing attacks on the digest comparison.
 *
 * @param {string} bundlePath — path to the bundle file.
 * @param {string} expectedSha256 — expected lowercase hex SHA-256 digest.
 * @returns {Promise<boolean>} `true` if the digests match, `false` otherwise.
 * @throws {Error} If the file cannot be read.
 */
export async function verifyIntegrity(bundlePath, expectedSha256) {
  const actual = await computeSha256(bundlePath);
  const actualBuf = Buffer.from(actual, 'hex');
  const expectedBuf = Buffer.from(expectedSha256, 'hex');

  // Guard against length mismatch (timingSafeEqual requires equal lengths).
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return actualBuf.equals(expectedBuf);
}

// ---------------------------------------------------------------------------
// Manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate a {@link DistributionManifest} for a theme bundle.
 *
 * The function reads the bundle file to compute its SHA-256 digest and
 * byte size. For `.agentskin-theme` or `.json` bundle paths, it attempts
 * to parse the manifest to extract metadata (version, themeId, themeName,
 * author, agents). For other bundle formats (e.g. `.zip`, `.tar.gz`),
 * metadata fields are populated from the filename and defaults.
 *
 * @param {string} bundlePath — path to the theme bundle file.
 * @returns {Promise<DistributionManifest>} The structured distribution manifest.
 * @throws {Error} If the bundle file does not exist or cannot be read.
 *
 * @example
 * const manifest = await generateManifest('./themes/midnight-dessert-feast.manifest.json');
 * console.log(manifest.sha256); // 'a1b2c3...'
 */
export async function generateManifest(bundlePath) {
  // Compute integrity metadata from the file itself.
  const sha256 = await computeSha256(bundlePath);
  const stat = await fs.stat(bundlePath);
  const size = stat.size;

  // Attempt to extract structured metadata from known bundle formats.
  const ext = extname(bundlePath).toLowerCase();
  let metadata = {};

  if (ext === '.json') {
    try {
      const raw = await fs.readFile(bundlePath, 'utf8');
      const parsed = JSON.parse(raw);
      metadata = extractMetadata(parsed);
    } catch {
      // JSON parse failed — fall back to filename-based defaults.
      metadata = {};
    }
  }

  const now = new Date().toISOString();

  return {
    version: metadata.version ?? '1.0.0',
    themeId: metadata.themeId ?? stripExtension(bundlePath),
    themeName: metadata.themeName ?? metadata.themeId ?? stripExtension(bundlePath),
    author: metadata.author ?? 'unknown',
    sha256,
    size,
    createdAt: now,
    agents: metadata.agents ?? [...SUPPORTED_AGENTS],
  };
}

/**
 * Extract distribution-relevant metadata from a parsed theme manifest JSON.
 *
 * Handles both the full manifest format (with `id`, `displayName`, `author.name`,
 * `supportedAgents`) and minimal formats.
 *
 * @param {object} parsed — parsed JSON object from a theme manifest.
 * @returns {Partial<DistributionManifest>} Extracted metadata fields.
 */
function extractMetadata(parsed) {
  if (!parsed || typeof parsed !== 'object') return {};

  const author =
    typeof parsed.author === 'object'
      ? (parsed.author?.name ?? 'unknown')
      : (parsed.author ?? 'unknown');

  const agents = Array.isArray(parsed.supportedAgents)
    ? parsed.supportedAgents.filter((a) => SUPPORTED_AGENTS.includes(a))
    : [...SUPPORTED_AGENTS];

  return {
    version: parsed.version,
    themeId: parsed.id,
    themeName: parsed.displayName ?? parsed.name,
    author,
    agents,
  };
}

// ---------------------------------------------------------------------------
// Deep-link protocol
// ---------------------------------------------------------------------------

/**
 * Generate an `agentskin://` deep link for applying a theme.
 *
 * Format: `agentskin://themes/apply?theme=<themeId>&app=<agent>`
 *
 * The `agent` parameter is optional. When omitted, the link applies the
 * theme to the currently active agent.
 *
 * @param {string} themeId — the theme identifier.
 * @param {string} [agent] — optional target agent ID.
 * @returns {string} The fully-formed deep-link URL.
 *
 * @example
 * generateDeepLink('midnight-dessert-feast');
 * // → 'agentskin://themes/apply?theme=midnight-dessert-feast'
 *
 * @example
 * generateDeepLink('midnight-dessert-feast', 'traework');
 * // → 'agentskin://themes/apply?theme=midnight-dessert-feast&app=traework'
 */
export function generateDeepLink(themeId, agent) {
  const params = new URLSearchParams({ theme: themeId });
  if (agent) {
    params.set('app', agent);
  }
  return `${DEEP_LINK_SCHEME}://${DEEP_LINK_ACTION_APPLY}?${params.toString()}`;
}

/**
 * Parse an `agentskin://` deep-link URL into its structured components.
 *
 * Extracts the action (path), themeId (required query param), and agent
 * (optional query param). Throws if the URL uses the wrong scheme or is
 * missing the required `theme` parameter.
 *
 * @param {string} url — the deep-link URL to parse.
 * @returns {DeepLinkInfo} Parsed deep-link information.
 * @throws {Error} If the URL scheme is not `agentskin://` or `theme` param is missing.
 *
 * @example
 * parseDeepLink('agentskin://themes/apply?theme=midnight-dessert-feast&app=traework');
 * // → { action: 'themes/apply', themeId: 'midnight-dessert-feast', agent: 'traework' }
 */
export function parseDeepLink(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
    throw new Error(`Invalid scheme: expected '${DEEP_LINK_SCHEME}:' but got '${parsed.protocol}'`);
  }

  const themeId = parsed.searchParams.get('theme');
  if (!themeId) {
    throw new Error("Missing required 'theme' query parameter in deep link");
  }

  // The "action" is the pathname without the leading slash.
  const action = parsed.pathname.replace(/^\//, '') || DEEP_LINK_ACTION_APPLY;

  const agent = parsed.searchParams.get('app') ?? undefined;

  return { action, themeId, agent };
}

// ---------------------------------------------------------------------------
// ThemeDistribution class — unified facade
// ---------------------------------------------------------------------------

/**
 * Unified facade for the theme distribution protocol.
 *
 * Wraps the standalone functions into a class for callers that prefer
 * an object-oriented interface. All methods are available as static
 * members for convenience.
 */
export class ThemeDistribution {
  /**
   * Generate a distribution manifest for a bundle.
   * @param {string} bundlePath
   * @returns {Promise<DistributionManifest>}
   */
  static async generateManifest(bundlePath) {
    return generateManifest(bundlePath);
  }

  /**
   * Verify a bundle's SHA-256 integrity.
   * @param {string} bundlePath
   * @param {string} expectedSha256
   * @returns {Promise<boolean>}
   */
  static async verifyIntegrity(bundlePath, expectedSha256) {
    return verifyIntegrity(bundlePath, expectedSha256);
  }

  /**
   * Parse an agentskin:// deep link.
   * @param {string} url
   * @returns {DeepLinkInfo}
   */
  static parseDeepLink(url) {
    return parseDeepLink(url);
  }

  /**
   * Generate an agentskin:// deep link.
   * @param {string} themeId
   * @param {string} [agent]
   * @returns {string}
   */
  static generateDeepLink(themeId, agent) {
    return generateDeepLink(themeId, agent);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip the directory path and extension from a filename to produce
 * a bare identifier (e.g. `/foo/bar/baz.json` → `baz`).
 *
 * @param {string} filePath
 * @returns {string}
 */
function stripExtension(filePath) {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}
