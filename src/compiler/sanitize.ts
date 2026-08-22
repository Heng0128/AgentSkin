// SPDX-License-Identifier: MPL-2.0

/**
 * # Keyframes Sanitizer (λ P0-2)
 *
 * PEG-lite character scanner that sanitizes `@keyframes` CSS blocks before
 * they reach the compiler emit pipeline. Guards against:
 *
 *   - `url()` data exfiltration (background → remote GET).
 *   - `expression()` / `behavior` script execution (IE / old Edge).
 *   - `@import` remote stylesheet loading.
 *   - `var(--external-*)` variable escape.
 *   - `@supports` conditional bypass.
 *   - Unicode-encoded payloads (`\0075 rl` → `url`).
 *
 * ## Approach
 *
 * Fail-closed: any violation returns `isBlocked=true` + `clean=""` (the raw
 * malicious input is never echoed back). Non-blocking issues (frame count,
 * naming conflicts) produce warnings while still emitting cleaned CSS.
 *
 * Zero external dependencies — pure TypeScript, compatible with Node 22+.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeOptions {
  /** Allowlist of permitted CSS properties (lowercased). */
  allowedProperties?: Set<string>;
  /** Denylist of forbidden CSS properties (lowercased). */
  forbiddenProperties?: Set<string>;
  /** Maximum number of keyframe stops before truncation (default 100). */
  maxKeyframeStops?: number;
  /** Allowlist of permitted CSS function names (lowercased). */
  allowedFunctions?: Set<string>;
  /** Prefix appended when renaming conflicting keyframes. */
  namespacePrefix?: string;
  /** When true, `var(--agentskin-*)` references are permitted. */
  allowPaletteTokens?: boolean;
}

export interface SanitizeResult {
  /** Sanitized CSS safe to inject. */
  clean: string;
  /** Human-readable violation / warning descriptions. */
  violations: string[];
  /** True when the input must be rejected entirely. */
  isBlocked: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_PROPERTIES = new Set([
  'background',
  'background-color',
  'background-position',
  'background-size',
  'color',
  'opacity',
  'transform',
  'box-shadow',
  'border-color',
  'outline-color',
  'text-shadow',
  'filter',
  'clip-path',
]);

const DEFAULT_FORBIDDEN_PROPERTIES = new Set([
  'behavior',
  '-ms-behavior',
  'binding',
  'content',
  '-moz-binding',
]);

const DEFAULT_ALLOWED_FUNCTIONS = new Set([
  'rgba',
  'rgb',
  'hsl',
  'hsla',
  'var',
  'calc',
  'min',
  'max',
  'clamp',
  'translate',
  'translatex',
  'translatey',
  'rotate',
  'rotatex',
  'rotatey',
  'scale',
  'scalex',
  'scaley',
  'skew',
  'skewx',
  'skewy',
  'matrix',
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'saturate',
  'sepia',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'cubic-bezier',
  'steps',
]);

const PALETTE_PREFIX = '--agentskin-';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a single `@keyframes <name> { ... }` block.
 *
 * If the input lacks the `@keyframes` wrapper (raw frames only), it is
 * treated as the block body and sanitized directly.
 */
export function sanitizeKeyframes(raw: string, opts: SanitizeOptions = {}): SanitizeResult {
  const violations: string[] = [];

  if (!raw?.trim()) {
    return { clean: '', violations: [], isBlocked: false };
  }

  // Strip comments first — attackers hide payloads in `/* ... */`.
  const stripped = stripComments(raw);

  // Fast-fail: @import anywhere in the input (it's an at-rule, not a decl).
  if (/@import/i.test(stripped)) {
    violations.push('Blocked: @import rule detected');
    return { clean: '', violations, isBlocked: true };
  }

  // Decode CSS unicode escapes (\0075 → "u") to defeat encoding bypass.
  const decoded = decodeCssUnicode(stripped);

  // Global url() scan — catches url() regardless of wrapper (@supports, etc.).
  if (/url\s*\(/i.test(decoded)) {
    violations.push('Blocked: url() reference detected');
    return { clean: '', violations, isBlocked: true };
  }

  // Parse the (optional) @keyframes wrapper.
  const parsed = parseKeyframeBlock(decoded);
  if (!parsed) {
    // Not a @keyframes wrapper — treat the whole input as raw frames.
    return sanitizeRawFrames(decoded, opts, violations);
  }

  // Resolve naming conflicts.
  const nameResult = resolveName(parsed.name, opts, violations);

  // Sanitize the frame body.
  const bodyResult = sanitizeRawFrames(parsed.body, opts, violations);
  if (bodyResult.isBlocked) {
    return { clean: '', violations: bodyResult.violations, isBlocked: true };
  }

  const clean = `@keyframes ${nameResult} { ${bodyResult.clean} }`;
  return { clean, violations, isBlocked: false };
}

/**
 * Sanitize a plain declaration block (no `@keyframes` wrapper).
 * Useful for `@supports` bodies and free-form CSS properties.
 */
export function sanitizeDeclarationBlock(raw: string, opts: SanitizeOptions = {}): SanitizeResult {
  const violations: string[] = [];

  if (!raw?.trim()) {
    return { clean: '', violations: [], isBlocked: false };
  }

  const stripped = stripComments(raw);
  if (/@import/i.test(stripped)) {
    violations.push('Blocked: @import rule detected');
    return { clean: '', violations, isBlocked: true };
  }

  const decoded = decodeCssUnicode(stripped);

  // Global url() scan.
  if (/url\s*\(/i.test(decoded)) {
    violations.push('Blocked: url() reference detected');
    return { clean: '', violations, isBlocked: true };
  }

  return sanitizeRawFrames(decoded, opts, violations);
}

/**
 * Sanitize multiple `@keyframes` blocks in a single pass.
 * Iterates over every `@keyframes` declaration found in the input.
 */
export function sanitizeKeyframesBatch(raw: string, opts: SanitizeOptions = {}): SanitizeResult {
  const violations: string[] = [];

  if (!raw?.trim()) {
    return { clean: '', violations: [], isBlocked: false };
  }

  const stripped = stripComments(raw);
  if (/@import/i.test(stripped)) {
    violations.push('Blocked: @import rule detected');
    return { clean: '', violations, isBlocked: true };
  }

  const decoded = decodeCssUnicode(stripped);

  // Global url() scan.
  if (/url\s*\(/i.test(decoded)) {
    violations.push('Blocked: url() reference detected');
    return { clean: '', violations, isBlocked: true };
  }

  const blocks = extractKeyframeBlocks(decoded);
  if (blocks.length === 0) {
    // No @keyframes wrappers — treat as raw frames.
    return sanitizeRawFrames(decoded, opts, violations);
  }

  const cleanBlocks: string[] = [];
  for (const block of blocks) {
    const nameResult = resolveName(block.name, opts, violations);
    const bodyResult = sanitizeRawFrames(block.body, opts, violations);
    if (bodyResult.isBlocked) {
      return { clean: '', violations: bodyResult.violations, isBlocked: true };
    }
    cleanBlocks.push(`@keyframes ${nameResult} { ${bodyResult.clean} }`);
  }

  return { clean: cleanBlocks.join('\n'), violations, isBlocked: false };
}

// ---------------------------------------------------------------------------
// Internal — block parsing
// ---------------------------------------------------------------------------

interface KeyframeBlock {
  name: string;
  body: string;
}

/**
 * Parse a single `@keyframes <name> { <body> }`.
 * Returns null if the input does not start with `@keyframes`.
 */
function parseKeyframeBlock(input: string): KeyframeBlock | null {
  const match = input.match(/^@keyframes\s+([^{\s]+)\s*\{([\s\S]*)\}\s*$/i);
  if (!match) return null;
  return { name: match[1].trim(), body: match[2] };
}

/**
 * Extract all `@keyframes` blocks from a multi-block input.
 * Handles nested braces correctly.
 */
function extractKeyframeBlocks(input: string): KeyframeBlock[] {
  const blocks: KeyframeBlock[] = [];
  const re = /@keyframes\s+([^{\s]+)\s*\{/g;

  for (let m = re.exec(input); m !== null; m = re.exec(input)) {
    const name = m[1].trim();
    const braceStart = m.index + m[0].length - 1;
    const body = matchBraces(input, braceStart);
    if (body !== null) {
      blocks.push({ name, body });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Internal — frame sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize raw frame content (the part inside `@keyframes name { ... }`).
 * Parses individual `<stop> { <declarations> }` segments.
 */
function sanitizeRawFrames(
  raw: string,
  opts: SanitizeOptions,
  violations: string[],
): SanitizeResult {
  const stops = parseStops(raw);
  const maxStops = opts.maxKeyframeStops ?? 100;

  if (stops.length > maxStops) {
    violations.push(`Warning: exceeded maxKeyframeStops (${stops.length}/${maxStops}), truncated`);
    stops.splice(maxStops);
  }

  const allowedProps = opts.allowedProperties ?? DEFAULT_ALLOWED_PROPERTIES;
  const forbiddenProps = opts.forbiddenProperties ?? DEFAULT_FORBIDDEN_PROPERTIES;
  const allowedFns = opts.allowedFunctions ?? DEFAULT_ALLOWED_FUNCTIONS;

  const cleanStops: string[] = [];

  for (const stop of stops) {
    const declResult = sanitizeDeclarations(stop.declarations, {
      allowedProps,
      forbiddenProps,
      allowedFns,
      allowPaletteTokens: opts.allowPaletteTokens ?? false,
      violations,
    });

    if (declResult.isBlocked) {
      return { clean: '', violations: declResult.violations, isBlocked: true };
    }

    cleanStops.push(`${stop.selector} { ${declResult.clean} }`);
  }

  return { clean: cleanStops.join(' '), violations, isBlocked: false };
}

interface ParsedStop {
  selector: string;
  declarations: string;
}

/**
 * Split frame body into individual stop segments.
 * Each segment is `<selector> { <declarations> }`.
 */
function parseStops(body: string): ParsedStop[] {
  const stops: ParsedStop[] = [];
  let i = 0;
  const len = body.length;

  while (i < len) {
    // Skip whitespace.
    while (i < len && /\s/.test(body[i])) i++;
    if (i >= len) break;

    // Find opening brace.
    const braceOpen = body.indexOf('{', i);
    if (braceOpen === -1) break;

    const selector = body.slice(i, braceOpen).trim();
    const inner = matchBraces(body, braceOpen);
    if (inner === null) break;

    stops.push({ selector, declarations: inner });
    i = braceOpen + inner.length + 2; // skip past '{' and '}'
  }

  return stops;
}

// ---------------------------------------------------------------------------
// Internal — declaration sanitization
// ---------------------------------------------------------------------------

interface DeclOpts {
  allowedProps: Set<string>;
  forbiddenProps: Set<string>;
  allowedFns: Set<string>;
  allowPaletteTokens: boolean;
  violations: string[];
}

function sanitizeDeclarations(declStr: string, opts: DeclOpts): SanitizeResult {
  const cleanDecls: string[] = [];
  const declarations = splitDeclarations(declStr);
  let blocked = false;

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;

    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const value = decl.slice(colonIdx + 1).trim();
    const declBlocked: string[] = [];

    // 1. Denylist check (blocking).
    if (opts.forbiddenProps.has(prop)) {
      declBlocked.push(`Blocked: forbidden property "${prop}"`);
    }

    // 2. Allowlist check (non-blocking, only if not already denylisted).
    if (declBlocked.length === 0 && opts.allowedProps.size > 0 && !opts.allowedProps.has(prop)) {
      opts.violations.push(`Warning: property "${prop}" not in allowlist, dropped`);
      continue;
    }

    // 3. var() reference check (always run).
    const varViolation = checkVarReferences(value, opts);
    if (varViolation) {
      declBlocked.push(varViolation);
    }

    // 4. Function allowlist check — catches expression(), theme(), @apply().
    const fnViolation = checkFunctions(value, opts);
    if (fnViolation) {
      declBlocked.push(fnViolation);
    }

    if (declBlocked.length > 0) {
      opts.violations.push(...declBlocked);
      blocked = true;
      break;
    }

    cleanDecls.push(`${prop}: ${value}`);
  }

  if (blocked) {
    return { clean: '', violations: opts.violations, isBlocked: true };
  }

  return { clean: cleanDecls.join('; '), violations: opts.violations, isBlocked: false };
}

/**
 * Split a declaration block on ';' while respecting parentheses.
 */
function splitDeclarations(declStr: string): string[] {
  const result: string[] = [];
  let buf = '';
  let parenDepth = 0;

  for (const ch of declStr) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === ';' && parenDepth === 0) {
      if (buf.trim()) result.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) result.push(buf.trim());
  return result;
}

/**
 * Ensure `var()` references only use permitted palette tokens.
 * Returns a violation string on failure, null on success.
 */
function checkVarReferences(value: string, opts: DeclOpts): string | null {
  const varRe = /var\s*\(\s*(--[\w-]+)/g;

  for (let m = varRe.exec(value); m !== null; m = varRe.exec(value)) {
    const varName = m[1];
    if (varName.startsWith(PALETTE_PREFIX)) {
      if (!opts.allowPaletteTokens) {
        return `Blocked: palette token "${varName}" requires allowPaletteTokens=true`;
      }
    } else {
      return `Blocked: external CSS variable "${varName}"`;
    }
  }

  return null;
}

/**
 * Check function calls against the allowlist.
 * Catches expression(), theme(), @apply(), etc.
 * Returns a violation string on failure, null on success.
 */
function checkFunctions(value: string, opts: DeclOpts): string | null {
  const fnRe = /([\w-]+)\s*\(/g;

  for (let m = fnRe.exec(value); m !== null; m = fnRe.exec(value)) {
    const fnName = m[1].toLowerCase();
    if (opts.allowedFns.has(fnName)) continue;
    return `Blocked: disallowed function "${m[1]}()"`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal — naming
// ---------------------------------------------------------------------------

function resolveName(name: string, opts: SanitizeOptions, violations: string[]): string {
  if (name.startsWith('agentskin-')) {
    const hash = simpleHash(name);
    const prefix = opts.namespacePrefix ?? 'agentskin-usr-';
    const renamed = `${prefix}${hash}-${name}`;
    violations.push(`Warning: renamed conflicting keyframes "${name}" → "${renamed}"`);
    return renamed;
  }
  return name;
}

/**
 * FNV-1a 32-bit → 4-char hex. Deterministic, no dependencies.
 */
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).slice(0, 4).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Internal — string utilities
// ---------------------------------------------------------------------------

/** Strip `/* ... *\/` comments (non-greedy). */
function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Decode CSS unicode escapes: `\0075` → "u", `\0075 rl` → "url".
 * Per spec: 1-6 hex digits followed by optional whitespace.
 */
function decodeCssUnicode(input: string): string {
  return input.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    const cp = parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff) return '';
    return String.fromCodePoint(cp);
  });
}

/**
 * Given an opening brace position, return the inner content up to the
 * matching closing brace. Returns null on mismatch.
 */
function matchBraces(input: string, openPos: number): string | null {
  if (input[openPos] !== '{') return null;
  let depth = 1;
  let i = openPos + 1;
  while (i < input.length && depth > 0) {
    if (input[i] === '{') depth++;
    else if (input[i] === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return input.slice(openPos + 1, i - 1);
}
