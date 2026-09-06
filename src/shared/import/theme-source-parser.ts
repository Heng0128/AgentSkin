// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Source Parser — Unified Import Pipeline
 *
 * Provides a common interface for parsing external theme formats
 * (Codedrobe, DreamSkin, agentskin-theme, source directories) into a
 * unified intermediate representation (IR). The IR is then consumed by
 * downstream stages (normalization, CSS generation, packaging).
 *
 * ## Architecture
 *
 *   External Format → Parser → ThemeIntermediateRepresentation → Pipeline
 *
 * Each parser implements `ThemeSourceParser` and registers with the
 * global `parserRegistry`. Callers use `parserRegistry.findParser(input)`
 * to locate the correct parser, then call `.parse(input)` to produce the IR.
 *
 * ## Input Types
 *
 * Parsers accept `ParserSource` — a discriminated union covering:
 * - `path`: filesystem path (main process only)
 * - `buffer`: in-memory bytes (cross-platform)
 * - `json`: pre-parsed JSON object (for single-file formats)
 */

import { type ProbeResult, probeThemeCompatibility } from '../theme/theme-probe';
import type { AgentId } from '../types/agent';
import type { ThemeManifest, ThemeManifestColors } from '../types/theme';

// ---------------------------------------------------------------------------
// Image asset types
// ---------------------------------------------------------------------------

/**
 * A single image asset extracted from a theme source.
 *
 * `data` holds the raw bytes (PNG/JPEG/WebP/GIF). `width`/`height` are
 * optional — populated when the parser can cheaply determine dimensions
 * (e.g. from PNG IHDR) without a full image decode.
 */
export interface ImageAsset {
  /** Raw image bytes. */
  data: Uint8Array;
  /** File extension without dot (e.g. 'png', 'jpg', 'webp'). */
  ext: string;
  /** Image width in pixels (if known). */
  width?: number;
  /** Image height in pixels (if known). */
  height?: number;
  /** MIME type (e.g. 'image/png'). */
  mimeType?: string;
  /** Original filename from the source package. */
  filename?: string;
}

/**
 * Collection of images bundled with a theme.
 *
 * Not every theme provides all slots. `textures` and `decorations` are
 * arrays because a theme may ship multiple texture/decoration images.
 */
export interface ThemeImages {
  /** Small square icon (typically 64-128px). */
  icon?: ImageAsset;
  /** Preview screenshot for catalog display. */
  preview?: ImageAsset;
  /** Hero artwork — the primary backdrop image. */
  hero?: ImageAsset;
  /** Texture images (patterns, gradients, etc.). */
  textures?: ImageAsset[];
  /** Decoration images (character art, accents, etc.). */
  decorations?: ImageAsset[];
}

// ---------------------------------------------------------------------------
// Unified Intermediate Representation
// ---------------------------------------------------------------------------

/**
 * Unified intermediate representation (IR) produced by every parser.
 *
 * This is the single canonical shape that all downstream pipeline stages
 * consume. Parsers are responsible for mapping their source format's
 * idiosyncrasies into this structure; they must NOT preserve source-specific
 * field names or conventions.
 */
export interface ThemeIntermediateRepresentation {
  /** Stable theme identifier (lowercase alphanumeric + hyphens). */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /** Semantic version string. */
  version: string;
  /** Theme author information. */
  author: { name: string; url?: string };
  /** Preferred color mode. */
  mode: 'light' | 'dark';
  /** Optional theme category slug. */
  category?: string;
  /** Optional tags for search/filter. */
  tags?: string[];
  /**
   * 14-token color palette (partial — missing tokens are derived by the
   * downstream normalization stage).
   */
  colors: Partial<ThemeManifestColors>;
  /** Bundled images. */
  images: ThemeImages;
  /**
   * Per-agent CSS strings keyed by AgentId.
   *
   * Parsers that extract CSS from the source populate this directly.
   * Parsers that only extract colors leave it empty — the downstream
   * CSS generation stage fills it.
   */
  agentCss: Partial<Record<AgentId, string>>;
  /** Source format identifier (e.g. 'codedrobe', 'dreamskin', 'agentskin'). */
  sourceFormat: string;
  /** Optional confidence score (0-1) indicating parse quality. */
  confidence?: number;
  /** Optional locale-specific display names (e.g. { en: '...', zh: '...' }). */
  localizedNames?: Record<string, string>;
  /** Optional locale-specific descriptions. */
  localizedDescriptions?: Record<string, string>;
  /** Optional license identifier. */
  license?: string;
  /** Whether this is an unofficial/community theme. */
  unofficial?: boolean;
  /**
   * SHA-256 integrity hash of the source package (for single-file formats
   * like codedrobe-theme). Set by parsers that can compute it cheaply.
   * Used for marketplace verification and tamper detection.
   */
  sourceIntegrity?: string;
  /**
   * Compatibility probe results per agent, populated by {@link runThemeProbe}.
   *
   * Each entry contains the result of checking the theme's CSS selectors
   * against the agent's verification contract. Warnings indicate potential
   * compatibility issues but do **not** block installation.
   */
  probeResults?: Partial<Record<AgentId, ProbeResult>>;
}

// ---------------------------------------------------------------------------
// Parser input types
// ---------------------------------------------------------------------------

/**
 * Input to a parser. At least one variant must be provided.
 *
 * `path` is for main-process filesystem access. `buffer` is for in-memory
 * bytes (works in both main and renderer). `json` is for pre-parsed objects.
 */
export interface ParserSource {
  /** Filesystem path to the theme source (file or directory). */
  path?: string;
  /** Raw bytes of a single-file theme package. */
  buffer?: Uint8Array;
  /** Pre-parsed JSON object (for formats that are pure JSON). */
  json?: Record<string, unknown>;
  /** Original filename (used for format sniffing when path is absent). */
  filename?: string;
  /** File entries for multi-file formats (ZIP-extracted, directory-read). */
  files?: Map<string, Uint8Array>;
}

// ---------------------------------------------------------------------------
// Parser interface
// ---------------------------------------------------------------------------

/**
 * Interface that every theme source parser must implement.
 *
 * `canParse` should be cheap — it only inspects metadata (filenames,
 * magic bytes, top-level keys), never the full content. `parse` does the
 * heavy lifting and may throw `ParserError` on failure.
 */
export interface ThemeSourceParser {
  /** Unique parser identifier (e.g. 'codedrobe', 'dreamskin'). */
  readonly name: string;
  /** Human-readable description for UI display. */
  readonly description: string;
  /** File extensions this parser handles (e.g. ['.codedrobe-theme']). */
  readonly extensions: string[];
  /**
   * Determine whether this parser can handle the given input.
   *
   * Must return `false` (not throw) for any unrecognized input.
   */
  canParse(source: ParserSource): boolean | Promise<boolean>;
  /**
   * Parse the input into the unified intermediate representation.
   *
   * Throws `ParserError` on structural failures (missing required fields,
   * malformed JSON, etc.).
   */
  parse(source: ParserSource): Promise<ThemeIntermediateRepresentation>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Error thrown by parsers when input is structurally invalid.
 */
export class ParserError extends Error {
  constructor(
    message: string,
    /** Parser that raised the error. */
    public readonly parserName: string,
    /** Source format identifier. */
    public readonly sourceFormat: string,
  ) {
    super(message);
    this.name = 'ParserError';
  }
}

/**
 * Error thrown when no parser can handle the given input.
 */
export class UnsupportedSourceError extends Error {
  constructor(
    message: string,
    public readonly filename?: string,
  ) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}

// ---------------------------------------------------------------------------
// Parser Registry
// ---------------------------------------------------------------------------

/**
 * Registry for theme source parsers.
 *
 * Parsers are registered with a priority (lower = higher priority). When
 * `findParser` is called, parsers are tried in priority order and the first
 * one that returns `true` from `canParse` wins.
 */
export class ParserRegistry {
  private parsers: Array<{ parser: ThemeSourceParser; priority: number }> = [];

  /**
   * Register a parser with the given priority.
   *
   * @param parser - The parser to register.
   * @param priority - Lower number = higher priority (default 100).
   */
  register(parser: ThemeSourceParser, priority = 100): void {
    this.parsers.push({ parser, priority });
    this.parsers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister a parser by name.
   *
   * @param name - The parser identifier to remove.
   * @returns `true` if the parser was found and removed.
   */
  unregister(name: string): boolean {
    const idx = this.parsers.findIndex((p) => p.parser.name === name);
    if (idx === -1) return false;
    this.parsers.splice(idx, 1);
    return true;
  }

  /**
   * Find the first parser that can handle the given input.
   *
   * @param source - The parser input to probe.
   * @returns The matching parser, or `undefined` if none match.
   */
  async findParser(source: ParserSource): Promise<ThemeSourceParser | undefined> {
    for (const { parser } of this.parsers) {
      try {
        if (await parser.canParse(source)) {
          return parser;
        }
      } catch {
        // canParse threw — skip this parser
      }
    }
    return undefined;
  }

  /**
   * Find a parser by exact name.
   *
   * @param name - The parser identifier.
   * @returns The parser, or `undefined` if not registered.
   */
  getParser(name: string): ThemeSourceParser | undefined {
    return this.parsers.find((p) => p.parser.name === name)?.parser;
  }

  /**
   * List all registered parsers (in priority order).
   */
  listParsers(): ReadonlyArray<{ name: string; description: string; extensions: string[] }> {
    return this.parsers.map(({ parser }) => ({
      name: parser.name,
      description: parser.description,
      extensions: parser.extensions,
    }));
  }

  /**
   * Clear all registered parsers.
   */
  clear(): void {
    this.parsers = [];
  }
}

/**
 * Global singleton parser registry.
 *
 * Import this in your application entry point and register parsers at startup:
 *
 * ```typescript
 * import { parserRegistry } from '@shared/import/theme-source-parser';
 * import { codedrobeParser } from '@shared/import/parsers/codedrobe-parser';
 *
 * parserRegistry.register(codedrobeParser, 10);
 * ```
 */
export const parserRegistry = new ParserRegistry();

// ---------------------------------------------------------------------------
// Theme compatibility probe integration
// ---------------------------------------------------------------------------

/**
 * Run compatibility pre-check on a parsed theme's intermediate representation.
 *
 * For each agent that has CSS in `ir.agentCss`, this function calls
 * {@link probeThemeCompatibility} to validate the CSS selectors against
 * the agent's verification contract. Results are stored in
 * `ir.probeResults`.
 *
 * This function is **non-blocking**: even when the probe reports
 * incompatibility, the IR is returned unchanged (except for the added
 * `probeResults` field). Callers are responsible for surfacing warnings
 * to the user.
 *
 * Idempotent — calling multiple times overwrites previous results.
 *
 * @param ir  The parsed theme intermediate representation.
 * @returns The same IR with `probeResults` populated.
 *
 * @example
 * ```typescript
 * const ir = await parser.parse(source);
 * const irWithProbe = runThemeProbe(ir);
 * for (const [agentId, result] of Object.entries(irWithProbe.probeResults ?? {})) {
 *   if (!result.compatible) {
 *     console.warn(`Theme may not be fully compatible with ${agentId}:`);
 *     result.warnings.forEach(w => console.warn(`  - ${w}`));
 *   }
 * }
 * ```
 */
export function runThemeProbe(
  ir: ThemeIntermediateRepresentation,
): ThemeIntermediateRepresentation {
  // Build a minimal manifest-like structure for the probe.
  // The probe needs targets[agentId].css, which maps to agentCss.
  const targets: Record<string, { css: string }> = {};
  for (const [agentId, css] of Object.entries(ir.agentCss)) {
    if (css) {
      targets[agentId] = { css };
    }
  }

  // Construct a minimal ThemeManifest with just the fields probeThemeCompatibility uses.
  const minimalManifest = { targets } as ThemeManifest;

  // Run probe for each agent.
  const probeResults: Partial<Record<AgentId, ProbeResult>> = {};
  for (const agentId of Object.keys(targets)) {
    const result = probeThemeCompatibility(minimalManifest, agentId as AgentId);
    probeResults[agentId as AgentId] = result;
  }

  return { ...ir, probeResults };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Decode a Uint8Array to a UTF-8 string.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  // Use TextDecoder when available (all modern environments)
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Fallback for older environments
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return decodeURIComponent(escape(result));
}

/**
 * Extract the file extension from a filename (lowercase, without dot).
 */
export function getExtension(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return '';
  return filename.slice(dotIdx + 1).toLowerCase();
}

/**
 * Extract the basename (filename without directory path).
 */
export function getBasename(filepath: string): string {
  const sepIdx = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
  return sepIdx === -1 ? filepath : filepath.slice(sepIdx + 1);
}

/**
 * Safely parse JSON from a string, throwing ParserError on failure.
 */
export function safeParseJson(
  json: string,
  parserName: string,
  sourceFormat: string,
): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    throw new ParserError(`Invalid JSON: ${(e as Error).message}`, parserName, sourceFormat);
  }
}

/**
 * Coerce a value to string safely.
 */
export function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Extract a nested property from an object using a dot-separated path.
 */
export function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
