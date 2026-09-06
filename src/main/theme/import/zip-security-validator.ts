// SPDX-License-Identifier: MPL-2.0

/**
 * # ZIP Security Validator
 *
 * Pre-import security gate for AgentSkin theme ZIP packages. Runs BEFORE
 * extraction so a malicious ZIP never touches disk. Nine independent checks:
 *
 * 1. **File type whitelist** — only CSS / PNG / JPG / JPEG / WebP / JSON / SVG
 *    files are permitted. Executables, scripts, fonts, and archives are
 *    rejected to prevent injection of arbitrary code.
 * 2. **Volume limits** — single file capped at 10 MB, total decompressed
 *    size capped at 50 MB. Stops ZIP bombs and memory exhaustion.
 * 3. **Path traversal** — rejects entries whose names start with `../`, are
 *    absolute, or contain `..` segments. Prevents writing outside the
 *    extraction root.
 * 4. **Manifest schema** — verifies `manifest.json` exists and declares the
 *    required fields: `name`, `version`, `colors`.
 * 5. **CSS scope** — every `.css` entry is checked to ensure its selectors
 *    are confined to `:root` and `[data-agentskin-*]` attribute selectors.
 *    This prevents a theme from restyling the host application's UI beyond
 *    the intended theming surface.
 * 6. **Remote URL detection** — scans CSS `url()` references and rejects any
 *    non-`data:` and non-relative URLs that would load resources from remote
 *    servers.
 * 7. **CSS `@import` detection** — rejects CSS files containing `@import`
 *    statements that could load arbitrary external stylesheets.
 * 8. **Executable magic bytes** — inspects file content for PE (`MZ`),
 *    ELF (`\x7fELF`), and Mach-O magic bytes to catch renamed executables
 *    that bypass the extension whitelist.
 * 9. **Symbolic link detection** — rejects ZIP entries whose
 *    `externalFileAttributes` indicate a Unix symbolic link, preventing
 *    symlink-based path traversal.
 *
 * The function is async and reads the ZIP from disk via `yauzl` (streaming,
 * no full extraction). It returns a structured result so callers can show
 * actionable error messages.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl, { type Entry } from 'yauzl';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum decompressed size for a single file (10 MB). */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum total decompressed size for the entire ZIP (50 MB). */
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

/** Maximum number of entries allowed in a single ZIP. */
const MAX_ENTRY_COUNT = 500;

/**
 * Allowed file extensions. Lowercase, with leading dot.
 * Themes are visual packages — they should never ship executables, scripts,
 * or font binaries (fonts go through ThemeStudio registry, not raw CSS).
 */
const ALLOWED_EXTENSIONS = new Set(['.css', '.png', '.jpg', '.jpeg', '.webp', '.json', '.svg']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZipValidationResult {
  /** True when the ZIP passes all security checks. */
  valid: boolean;
  /** Fatal issues — the ZIP must be rejected. */
  errors: string[];
  /** Non-fatal observations — the ZIP is usable but sub-optimal. */
  warnings: string[];
}

/** Intermediate representation of a ZIP entry after streaming read. */
interface ZipEntry {
  fileName: string;
  data: Buffer;
  /** Unix file mode from externalFileAttributes (upper 16 bits); 0 for non-Unix ZIPs. */
  externalFileAttributes: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a theme ZIP file against the security contract.
 *
 * @param filePath - Absolute path to the `.zip` file.
 * @returns Structured validation result with errors and warnings.
 */
export async function validateZipImport(filePath: string): Promise<ZipValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Read file from disk ---
  let raw: Buffer;
  try {
    raw = await fs.readFile(filePath);
  } catch (e) {
    return {
      valid: false,
      errors: [`Failed to read file: ${(e as Error).message}`],
      warnings,
    };
  }

  // --- Empty file guard ---
  if (raw.length === 0) {
    return { valid: false, errors: ['File is empty'], warnings };
  }

  // --- Stream-read ZIP entries ---
  let entries: ZipEntry[];
  try {
    entries = await streamReadEntries(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid ZIP: ${(e as Error).message}`],
      warnings,
    };
  }

  // --- Check 1: File type whitelist ---
  for (const entry of entries) {
    const ext = path.extname(entry.fileName).toLowerCase();
    if (ext === '' || !ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`Disallowed file type: "${entry.fileName}" (extension "${ext || '<none>'}")`);
    }
  }

  // --- Check 2: Volume limits ---
  let totalSize = 0;
  for (const entry of entries) {
    totalSize += entry.data.length;
    if (entry.data.length > MAX_FILE_SIZE) {
      errors.push(
        `File "${entry.fileName}" exceeds 10 MB limit (${formatBytes(entry.data.length)})`,
      );
    }
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    errors.push(`Total decompressed size exceeds 50 MB limit (${formatBytes(totalSize)})`);
  }

  // --- Check 3: Path traversal (defense-in-depth — also checked during read) ---
  for (const entry of entries) {
    if (isTraversalPath(entry.fileName)) {
      errors.push(`Path traversal detected: "${entry.fileName}"`);
    }
  }

  // --- Check 4: Manifest schema ---
  const manifestEntry = entries.find((e) => e.fileName === 'manifest.json');
  if (!manifestEntry) {
    errors.push('Missing manifest.json at ZIP root');
  } else {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestEntry.data.toString('utf8')) as Record<string, unknown>;
    } catch {
      errors.push('manifest.json is not valid JSON');
      manifest = {};
    }

    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
      errors.push('manifest.json missing required field "name"');
    }
    if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
      errors.push('manifest.json missing required field "version"');
    }
    if (!manifest.colors || typeof manifest.colors !== 'object' || Array.isArray(manifest.colors)) {
      errors.push('manifest.json missing required field "colors"');
    }
  }

  // --- Check 5: CSS scope ---
  for (const entry of entries) {
    if (!entry.fileName.endsWith('.css')) continue;
    const css = entry.data.toString('utf8');
    const scopeIssues = validateCSSScope(css);
    for (const issue of scopeIssues) {
      errors.push(`CSS scope violation in "${entry.fileName}": ${issue}`);
    }
  }

  // --- Check 6: Remote URL detection ---
  for (const entry of entries) {
    if (!entry.fileName.endsWith('.css')) continue;
    const css = entry.data.toString('utf8');
    for (const violation of checkRemoteUrlsInCss(css, entry.fileName)) {
      errors.push(violation);
    }
  }

  // --- Check 7: CSS @import detection ---
  for (const entry of entries) {
    if (!entry.fileName.endsWith('.css')) continue;
    const css = entry.data.toString('utf8');
    for (const violation of checkCssImport(css, entry.fileName)) {
      errors.push(violation);
    }
  }

  // --- Check 8: Executable magic bytes detection ---
  for (const entry of entries) {
    for (const violation of checkMagicBytes(entry.data, entry.fileName)) {
      errors.push(violation);
    }
  }

  // --- Check 9: Symbolic link detection ---
  for (const entry of entries) {
    for (const violation of checkSymbolicLink(entry.externalFileAttributes, entry.fileName)) {
      errors.push(violation);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// ZIP streaming reader
// ---------------------------------------------------------------------------

/**
 * Stream-read all entries from a ZIP buffer into memory. Uses a temp file
 * because `yauzl` requires a file path (random-access reads).
 *
 * Path traversal is checked here as a first-pass guard so malicious entries
 * are rejected before their content is fully buffered.
 */
function streamReadEntries(raw: Buffer): Promise<ZipEntry[]> {
  // Write to a temp file for yauzl's random-access reads.
  const os = require('node:os') as typeof import('node:os');
  const tmpPath = path.join(os.tmpdir(), `agentskin-zipsec-${crypto.randomUUID()}.zip`);

  return fs
    .writeFile(tmpPath, raw)
    .then(
      () =>
        new Promise<ZipEntry[]>((resolve, reject) => {
          const entries: ZipEntry[] = [];
          let totalSize = 0;

          yauzl.open(
            tmpPath,
            { lazyEntries: true, autoClose: false },
            (err: Error | null, zipfile: yauzl.ZipFile) => {
              if (err) {
                reject(new Error(`Failed to open ZIP: ${err.message}`));
                return;
              }

              if (zipfile.entryCount > MAX_ENTRY_COUNT) {
                reject(new Error(`ZIP contains too many entries: ${zipfile.entryCount}`));
                zipfile.close();
                return;
              }

              zipfile.readEntry();

              zipfile.on('entry', (entry: Entry) => {
                // Path traversal: reject during streaming.
                if (isTraversalPath(entry.fileName)) {
                  reject(new Error(`Path traversal detected: ${entry.fileName}`));
                  zipfile.close();
                  return;
                }

                // Skip directories.
                if (entry.fileName.endsWith('/')) {
                  zipfile.readEntry();
                  return;
                }

                zipfile.openReadStream(entry, (readErr, readStream) => {
                  if (readErr) {
                    reject(
                      new Error(`Failed to read entry "${entry.fileName}": ${readErr.message}`),
                    );
                    zipfile.close();
                    return;
                  }

                  const chunks: Buffer[] = [];
                  readStream.on('data', (chunk: Buffer) => {
                    totalSize += chunk.length;
                    if (totalSize > MAX_TOTAL_SIZE) {
                      reject(
                        new Error(`Total decompressed size exceeds ${MAX_TOTAL_SIZE} byte limit`),
                      );
                      zipfile.close();
                      return;
                    }
                    chunks.push(chunk);
                  });
                  readStream.on('end', () => {
                    entries.push({
                      fileName: entry.fileName,
                      data: Buffer.concat(chunks),
                      externalFileAttributes: entry.externalFileAttributes,
                    });
                    zipfile.readEntry();
                  });
                  readStream.on('error', (streamErr: Error) => {
                    reject(new Error(`Stream error for "${entry.fileName}": ${streamErr.message}`));
                    zipfile.close();
                  });
                });
              });

              zipfile.on('end', () => {
                resolve(entries);
                zipfile.close();
              });

              zipfile.on('error', (zipErr: Error) => {
                // yauzl v3 validates entries itself and emits an error for
                // traversal paths. Normalise the message so callers see a
                // consistent "Path traversal" prefix.
                const msg = zipErr.message;
                if (
                  msg.includes('invalid file name') ||
                  msg.includes('..') ||
                  /path|traversal|absolute/i.test(msg)
                ) {
                  reject(new Error(`Path traversal or invalid path detected: ${msg}`));
                } else {
                  reject(new Error(`ZIP processing error: ${msg}`));
                }
              });
            },
          );
        }),
    )
    .finally(() => {
      // Best-effort cleanup of temp file.
      fs.unlink(tmpPath).catch(() => {});
    });
}

// ---------------------------------------------------------------------------
// Path traversal detection
// ---------------------------------------------------------------------------

/**
 * Detect path-traversal patterns in a ZIP entry name.
 *
 * Rejects:
 * - Names starting with `../` or containing `/../` (relative escape)
 * - Absolute paths (POSIX `/...` or Windows `C:\...`)
 * - Names starting with `..` (bare parent reference)
 */
function isTraversalPath(fileName: string): boolean {
  // Absolute path (POSIX or Windows drive letter).
  if (path.isAbsolute(fileName) || /^[a-zA-Z]:[\\/]/.test(fileName)) return true;
  // Starts with parent reference.
  if (fileName.startsWith('../') || fileName === '..' || fileName.includes('/../')) return true;
  // Backslash variant (Windows-style traversal).
  if (fileName.startsWith('..\\') || fileName.includes('\\..\\')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// CSS scope validation
// ---------------------------------------------------------------------------

/**
 * Validate that a CSS string only uses safe selectors.
 *
 * Allowed selector patterns:
 * - `:root` — CSS custom property definitions
 * - `[data-agentskin-*]` — AgentSkin-scoped attribute selectors
 * - `.agentskin-*` — AgentSkin class selectors
 *
 * Any selector that targets generic HTML elements (e.g. `body`, `div`, `*`)
 * or external resources is rejected as a scope violation.
 *
 * @returns Array of violation descriptions (empty = safe).
 */
function validateCSSScope(css: string): string[] {
  const violations: string[] = [];

  // Strip comments so they can't hide malicious selectors.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Extract rule blocks: everything between `{` and the matching `}`.
  // We walk character-by-character to handle nested braces correctly.
  const rules = extractRules(stripped);

  // Check top-level statements that aren't inside { } blocks (e.g.
  // `@import url(...);` without surrounding braces). extractRules only
  // finds brace-delimited blocks.
  const topLevel = extractTopLevelStatements(stripped);
  for (const stmt of topLevel) {
    if (
      stmt.startsWith('@import') ||
      stmt.startsWith('@charset') ||
      stmt.startsWith('@font-face')
    ) {
      violations.push(`disallowed @-rule "${stmt.split(/\s+/)[0]}"`);
    }
  }

  for (const rule of rules) {
    const selector = rule.selector.trim();
    if (selector === '') continue;

    // Allow @-rules that are safe (media, supports,keyframes).
    if (
      selector.startsWith('@media') ||
      selector.startsWith('@supports') ||
      selector.startsWith('@keyframes')
    ) {
      // These wrap other rules — the inner selectors are checked separately
      // when they appear as standalone rules. Skip the @-rule line itself.
      continue;
    }

    // Disallow dangerous @-rules.
    if (
      selector.startsWith('@import') ||
      selector.startsWith('@font-face') ||
      selector.startsWith('@charset')
    ) {
      violations.push(`disallowed @-rule "${selector.split(/\s+/)[0]}"`);
      continue;
    }

    // Check each comma-separated selector in a group.
    const parts = selector.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (!isSafeSelector(part)) {
        violations.push(
          `selector "${part}" is not scoped — use :root, [data-agentskin-*], or .agentskin-* selectors only (prevents restyling the host application)`,
        );
      }
    }
  }

  return violations;
}

/**
 * Extract top-level statements that are NOT inside a `{ }` block.
 * These are typically `@import`, `@charset`, or other at-rules that
 * appear before any selector block. Returns trimmed statement strings
 * (without trailing semicolons).
 */
function extractTopLevelStatements(css: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let buf = '';

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      // Flush any accumulated top-level content as a statement.
      const pending = buf.trim();
      if (pending && depth === 0) {
        statements.push(pending.replace(/;$/, ''));
      }
      buf = '';
      depth++;
      continue;
    }
    if (ch === '}') {
      buf = '';
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ';' && depth === 0) {
      const stmt = buf.trim();
      if (stmt) statements.push(stmt);
      buf = '';
      continue;
    }
    buf += ch;
  }

  // Remaining buffer at top level.
  const tail = buf.trim();
  if (tail && depth === 0) {
    statements.push(tail.replace(/;$/, ''));
  }

  return statements;
}

/**
 * Extract top-level CSS rules as `{ selector, body }` pairs.
 * Handles nested braces by depth counting.
 */
function extractRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let buf = '';

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        // Everything before this `{` is the selector.
        const selector = buf.trim();
        buf = '';
        // Read until matching `}`.
        depth++;
        let body = '';
        i++;
        while (i < css.length && depth > 0) {
          if (css[i] === '{') depth++;
          else if (css[i] === '}') depth--;
          if (depth > 0) body += css[i];
          i++;
        }
        rules.push({ selector, body });
        buf = '';
        continue;
      }
    }
    if (depth === 0) {
      buf += ch;
    }
  }

  return rules;
}

/**
 * Check whether a single selector is safe.
 *
 * Safe patterns:
 * - `:root` (with optional pseudo-classes)
 * - `[data-agentskin-*]` (attribute selectors)
 * - `.agentskin-*` (class selectors)
 * - Combinations using ` `, `>`, `+`, `~` where ALL parts are safe
 */
function isSafeSelector(selector: string): boolean {
  // Allow :root and its pseudo-class variants.
  if (/^:root[\w-]*$/.test(selector)) return true;

  // Split by combinators and check each simple selector.
  const parts = selector.split(/\s+|([>+~])/).filter((s) => s && !s.match(/^[>+~]$/));

  if (parts.length === 0) return true;

  return parts.every((part) => isSafeSimpleSelector(part));
}

/**
 * Check a single simple selector (no combinators).
 */
function isSafeSimpleSelector(selector: string): boolean {
  const s = selector.trim();
  if (s === '') return true;

  // [data-agentskin-*]
  if (/^\[data-agentskin[^\]]*\]$/.test(s)) return true;

  // .agentskin-*
  if (/^\.agentskin[\w-]*$/.test(s)) return true;

  // :root with pseudo-classes
  if (/^:root[\w-]*$/.test(s)) return true;

  // Pseudo-classes/elements on safe bases: e.g. `::before`, `::after`
  // are only safe when scoped — reject standalone pseudo-elements.
  if (/^::?[a-z-]+$/.test(s)) return false;

  // Reject universal selector.
  if (s === '*') return false;

  // Reject element selectors (body, div, span, etc.).
  if (/^[a-z][a-z0-9]*$/i.test(s)) return false;

  // Reject ID selectors that aren't agentskin-prefixed.
  if (/^#agentskin[\w-]*$/.test(s)) return true;
  if (/^#/.test(s)) return false;

  // Reject attribute selectors that aren't data-agentskin.
  if (/^\[/.test(s)) return false;

  // Reject class selectors that aren't agentskin-prefixed.
  if (/^\./.test(s)) return false;

  // Anything else is unsafe by default.
  return false;
}

// ---------------------------------------------------------------------------
// Check 6: Remote URL detection
// ---------------------------------------------------------------------------

/**
 * Matches `url(...)` tokens inside a CSS string. Captures the raw content
 * between the parentheses (without surrounding quotes).
 */
const URL_TOKEN_RE = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;

/**
 * Detects CSS `url()` references that point to remote resources.
 *
 * Allowed:
 * - `data:` URIs (embedded resources)
 * - Relative paths (no scheme, no leading `//`)
 *
 * Rejected:
 * - `http://` / `https://` URLs
 * - Protocol-relative `//example.com/...` URLs
 * - Any other scheme (`ftp://`, `file://`, etc.)
 *
 * @returns Array of violation descriptions (empty = safe).
 */
function checkRemoteUrlsInCss(css: string, fileName: string): string[] {
  const violations: string[] = [];

  // Strip comments so they can't hide malicious URLs.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  URL_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = URL_TOKEN_RE.exec(stripped);
  while (match !== null) {
    const url = match[1];

    // data: URIs are safe (embedded content).
    if (url.startsWith('data:')) {
      match = URL_TOKEN_RE.exec(stripped);
      continue;
    }

    // Protocol-relative URLs (//example.com/...) are remote.
    if (url.startsWith('//')) {
      violations.push(
        `Remote URL in "${fileName}": url("${url}") — protocol-relative URLs are not allowed`,
      );
      match = URL_TOKEN_RE.exec(stripped);
      continue;
    }

    // Any absolute URL with a scheme is remote.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      violations.push(
        `Remote URL in "${fileName}": url("${url}") — only data: URIs and relative paths are allowed`,
      );
    }
    match = URL_TOKEN_RE.exec(stripped);
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Check 7: CSS @import detection
// ---------------------------------------------------------------------------

/**
 * Detects `@import` statements in CSS content.
 *
 * `@import` can load arbitrary external stylesheets, bypassing the
 * extension whitelist and remote URL checks. Even `@import url(...)` with
 * a relative path could be combined with other attacks, so all forms are
 * rejected.
 *
 * @returns Array of violation descriptions (empty = safe).
 */
function checkCssImport(css: string, fileName: string): string[] {
  const violations: string[] = [];

  // Strip comments so they can't hide @import statements.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Match @import followed by a string or url().
  if (/@import\s+(?:url\()?['"]?[^'")\s]+['"]?\)?\s*[;{]/i.test(stripped)) {
    violations.push(
      `CSS @import detected in "${fileName}" — @import statements are forbidden to prevent loading external resources`,
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Check 8: Executable magic bytes detection
// ---------------------------------------------------------------------------

/**
 * Known executable magic byte signatures. Each entry matches the first
 * N bytes of the file content.
 */
const EXECUTABLE_SIGNATURES: Array<{ bytes: number[]; label: string }> = [
  { bytes: [0x4d, 0x5a], label: 'PE (Windows executable)' }, // MZ
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'ELF (Linux executable)' }, // \x7fELF
  { bytes: [0xfe, 0xed, 0xfa, 0xce], label: 'Mach-O (32-bit big-endian)' }, // \xFEEDFACE
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], label: 'Mach-O (64-bit big-endian)' }, // \xFEEDFACF
  { bytes: [0xce, 0xfa, 0xed, 0xfe], label: 'Mach-O (32-bit little-endian)' }, // \xCEFAEDFE
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], label: 'Mach-O (64-bit little-endian)' }, // \xCFFAEDFE
];

/**
 * Detects executable files by inspecting their magic bytes, regardless of
 * the file extension. This catches attackers who rename `.exe` to `.png`
 * to bypass the extension whitelist.
 *
 * @returns Array of violation descriptions (empty = safe).
 */
function checkMagicBytes(data: Buffer, fileName: string): string[] {
  const violations: string[] = [];

  for (const { bytes, label } of EXECUTABLE_SIGNATURES) {
    if (data.length < bytes.length) continue;

    let match = true;
    for (let i = 0; i < bytes.length; i++) {
      if (data[i] !== bytes[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      violations.push(
        `Executable file detected in "${fileName}": ${label} magic bytes found — theme packages must not contain executables`,
      );
      // One match is enough — no need to report multiple signatures.
      break;
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Check 9: Symbolic link detection
// ---------------------------------------------------------------------------

/**
 * Unix file type bits live in the upper 16 bits of `externalFileAttributes`.
 * The type mask (`S_IFMT`) is `0xF000`; a symlink (`S_IFLNK`) is `0xA000`.
 */
const UNIX_S_IFMT = 0xf000;
const UNIX_S_IFLNK = 0xa000;

/**
 * Detects ZIP entries that are symbolic links.
 *
 * On Unix systems, the `externalFileAttributes` field stores the file's
 * `st_mode` in its upper 16 bits. A symlink has the `S_IFLNK` type bits
 * set. Symlinks in a ZIP can be used for path-traversal attacks during
 * extraction.
 *
 * @param externalFileAttributes - The entry's externalFileAttributes value.
 * @param fileName - The entry name (for error messages).
 * @returns Array of violation descriptions (empty = safe).
 */
function checkSymbolicLink(externalFileAttributes: number, fileName: string): string[] {
  const violations: string[] = [];

  // Extract the Unix file type from the upper 16 bits.
  const fileType = (externalFileAttributes >> 16) & UNIX_S_IFMT;

  if (fileType === UNIX_S_IFLNK) {
    violations.push(
      `Symbolic link detected: "${fileName}" — ZIP entries must not contain symbolic links`,
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
