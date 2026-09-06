// SPDX-License-Identifier: MPL-2.0

/**
 * # Security Scanner — Theme Import Safety Layer
 *
 * Provides static analysis of CSS/JS content within theme packages to
 * detect dangerous patterns before injection. This is an **optional** safety
 * layer that does not modify the core `theme-source-parser.ts` pipeline.
 *
 * ## Detection Scope
 *
 * - CSS: `@import url(外部URL)`, `expression()`, `behavior:`, `-moz-binding`
 * - JS: `eval()`, `new Function()`, `fetch()`, `XMLHttpRequest`,
 *   `localStorage`, `sessionStorage`, `child_process`, `require()` dynamic args
 *
 * ## Architecture
 *
 *   Theme Files → scanThemePackage() → SecurityScanResult
 *                    ↓
 *              ┌─────┴─────┐
 *              ↓           ↓
 *        scanCssSource  scanJsSource
 *              ↓           ↓
 *        regex patterns  regex patterns
 *                    ↓
 *            SecurityFinding[]
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single security finding detected during scanning.
 */
export interface SecurityFinding {
  /** Type of source content where the finding was detected. */
  type: 'css' | 'js';
  /** The dangerous pattern that was matched. */
  pattern: string;
  /** Line number (1-based) where the finding occurs. */
  line: number;
  /** Column number (1-based) where the finding starts. */
  column: number;
  /** Human-readable description of the issue. */
  message: string;
  /** Severity level of the finding. */
  severity: 'warning' | 'danger';
}

/**
 * Result of scanning an entire theme package for security issues.
 */
export interface SecurityScanResult {
  /** Whether the package is considered safe (no danger findings). */
  safe: boolean;
  /** Overall risk level based on findings. */
  riskLevel: 'low' | 'medium' | 'high';
  /** All findings detected during the scan. */
  findings: SecurityFinding[];
  /** SHA-256 hash of all file contents concatenated (for integrity). */
  hash: string;
}

// ---------------------------------------------------------------------------
// CSS Dangerous Patterns
// ---------------------------------------------------------------------------

interface CssPattern {
  regex: RegExp;
  pattern: string;
  message: string;
  severity: 'warning' | 'danger';
}

const CSS_PATTERNS: CssPattern[] = [
  {
    // Matches @import url(...) pointing to external URLs (http/https/protocol-relative)
    regex: /@import\s+url\s*\(\s*(['"]?\s*https?:|\/\/)/i,
    pattern: '@import url(external)',
    message: 'External @import URL detected — can load untrusted remote CSS',
    severity: 'danger',
  },
  {
    // Matches CSS expression() — IE-specific dynamic evaluation
    regex: /expression\s*\(/i,
    pattern: 'expression()',
    message: 'CSS expression() detected — allows arbitrary script execution in IE',
    severity: 'danger',
  },
  {
    // Matches behavior: url(...) — IE-specific HTC binding
    regex: /behavior\s*:\s*url\s*\(/i,
    pattern: 'behavior:',
    message: 'CSS behavior: detected — can bind external HTC scripts in IE',
    severity: 'danger',
  },
  {
    // Matches -moz-binding — XBL binding in Firefox
    regex: /-moz-binding\s*:/i,
    pattern: '-moz-binding',
    message: '-moz-binding detected — can bind XBL components in Firefox',
    severity: 'danger',
  },
];

// ---------------------------------------------------------------------------
// JS Dangerous Patterns
// ---------------------------------------------------------------------------

interface JsPattern {
  regex: RegExp;
  pattern: string;
  message: string;
  severity: 'warning' | 'danger';
}

const JS_PATTERNS: JsPattern[] = [
  {
    // Matches eval(...) — direct code execution
    regex: /\beval\s*\(/,
    pattern: 'eval()',
    message: 'eval() detected — executes arbitrary code from strings',
    severity: 'danger',
  },
  {
    // Matches new Function(...) — indirect code execution
    regex: /new\s+Function\s*\(/,
    pattern: 'new Function()',
    message: 'new Function() detected — creates executable code from strings',
    severity: 'danger',
  },
  {
    // Matches fetch(...) — network request capability
    regex: /\bfetch\s*\(/,
    pattern: 'fetch()',
    message: 'fetch() detected — can send data to external servers',
    severity: 'danger',
  },
  {
    // Matches XMLHttpRequest — network request capability (legacy)
    regex: /new\s+XMLHttpRequest\s*\(/,
    pattern: 'XMLHttpRequest',
    message: 'XMLHttpRequest detected — can send data to external servers',
    severity: 'danger',
  },
  {
    // Matches localStorage access
    regex: /\blocalStorage\b/,
    pattern: 'localStorage',
    message: 'localStorage access detected — persistent data storage',
    severity: 'warning',
  },
  {
    // Matches sessionStorage access
    regex: /\bsessionStorage\b/,
    pattern: 'sessionStorage',
    message: 'sessionStorage access detected — session-scoped data storage',
    severity: 'warning',
  },
  {
    // Matches child_process — Node.js child process spawning
    regex: /child_process/,
    pattern: 'child_process',
    message: 'child_process reference detected — can spawn system processes',
    severity: 'danger',
  },
  {
    // Matches require(dynamic) where the argument is a variable, not a string literal
    regex: /require\s*\(\s*(?!['"`])/,
    pattern: 'require(dynamic)',
    message: 'Dynamic require() detected — can load arbitrary modules',
    severity: 'warning',
  },
];

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a string.
 *
 * @param content - The string content to hash.
 * @returns The hex-encoded SHA-256 digest.
 */
export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Line/Column Resolution
// ---------------------------------------------------------------------------

/**
 * Given a source string and a character offset, compute the 1-based line
 * and column numbers.
 */
function resolveLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// ---------------------------------------------------------------------------
// CSS Scanner
// ---------------------------------------------------------------------------

/**
 * Scan CSS source code for dangerous patterns.
 *
 * @param source - The CSS content to scan.
 * @returns An array of security findings (empty if clean).
 */
export function scanCssSource(source: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { regex, pattern, message, severity } of CSS_PATTERNS) {
    // Reset regex state for global matching
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    let match: RegExpExecArray | null = globalRegex.exec(source);

    while (match !== null) {
      const { line, column } = resolveLineColumn(source, match.index);
      findings.push({
        type: 'css',
        pattern,
        line,
        column,
        message,
        severity,
      });

      // Prevent infinite loop on zero-length matches
      if (match.index === globalRegex.lastIndex) {
        globalRegex.lastIndex++;
      }
      match = globalRegex.exec(source);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// JS Scanner
// ---------------------------------------------------------------------------

/**
 * Scan JavaScript source code for dangerous patterns.
 *
 * @param source - The JS content to scan.
 * @returns An array of security findings (empty if clean).
 */
export function scanJsSource(source: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { regex, pattern, message, severity } of JS_PATTERNS) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    let match: RegExpExecArray | null = globalRegex.exec(source);

    while (match !== null) {
      const { line, column } = resolveLineColumn(source, match.index);
      findings.push({
        type: 'js',
        pattern,
        line,
        column,
        message,
        severity,
      });

      if (match.index === globalRegex.lastIndex) {
        globalRegex.lastIndex++;
      }
      match = globalRegex.exec(source);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// File Classification
// ---------------------------------------------------------------------------

/**
 * Determine the content type of a file based on its extension.
 */
function classifyFile(path: string): 'css' | 'js' | 'other' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
  return 'other';
}

// ---------------------------------------------------------------------------
// Theme Package Scanner
// ---------------------------------------------------------------------------

/**
 * Scan all files in a theme package for security issues.
 *
 * Iterates over every file, classifies it by extension, and runs the
 * appropriate scanner. Returns a combined result with risk assessment
 * and SHA-256 integrity hash.
 *
 * @param files - Array of file entries (path + content).
 * @returns A complete security scan result.
 */
export function scanThemePackage(files: { path: string; content: string }[]): SecurityScanResult {
  const findings: SecurityFinding[] = [];
  const hash = createHash('sha256');

  for (const file of files) {
    // Update hash with relative path + content for integrity
    hash.update(file.path, 'utf-8');
    hash.update(file.content, 'utf-8');

    const fileType = classifyFile(file.path);
    if (fileType === 'css') {
      const cssFindings = scanCssSource(file.content);
      findings.push(...cssFindings);
    } else if (fileType === 'js') {
      const jsFindings = scanJsSource(file.content);
      findings.push(...jsFindings);
    }
    // Other file types are not scanned
  }

  // Determine risk level
  const dangerCount = findings.filter((f) => f.severity === 'danger').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  let riskLevel: 'low' | 'medium' | 'high';
  if (dangerCount > 0) {
    riskLevel = 'high';
  } else if (warningCount > 0) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return {
    safe: dangerCount === 0,
    riskLevel,
    findings,
    hash: hash.digest('hex'),
  };
}
