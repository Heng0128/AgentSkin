// SPDX-License-Identifier: MPL-2.0

/**
 * # CSS Variable Bridge (S3 root fix)
 *
 * Agents compute a large share of their styling from their **own** CSS custom
 * properties — and some derive styles at runtime in JS by reading those vars
 * (e.g. `getComputedStyle(document.documentElement).getPropertyValue('--cb-*')`).
 * Theme injection that only defines `--agentskin-*` tokens therefore leaves the
 * agent's CSS *and* JS-computed styles untouched, which is why AgentSkin once
 * relied on the `AdaptiveMutationObserver` + 5s self-heal loop.
 *
 * The bridge removes that dependency: each native variable the agent reads is
 * **re-routed** (declaratively, not by editing the agent's stylesheets) onto an
 * AgentSkin token role, so both the agent's own CSS rules and any JS
 * `getComputedStyle()` reads resolve to the active theme.
 *
 * This module is **pure** (no DOM, no CDP, no adapter imports). It compiles a
 * set of bridge entries into CSS custom-property declarations and can resolve
 * them against a concrete theme palette without a browser, which powers the
 * "JS 动态算样式" path and offline tests.
 *
 * ## Entry shape
 * ```js
 * { var: '--cb-bg-primary',  role: 'surface', alpha: 1 }   // → var(--agentskin-surface)
 * { var: '--cb-text-secondary', role: 'text', alpha: 0.70 }// → color-mix(in srgb, var(--agentskin-text) 70%, transparent)
 * ```
 *
 * `alpha` is optional (defaults to 1 = direct token reference); when `< 1` the
 * value is wrapped in `color-mix(in srgb, var(--agentskin-<role>) <pct>%, transparent)`,
 * matching the convention already used across the engine `tokens.css` files.
 */

/** Semantic token roles the bridge can route onto (the AgentSkin token soap). */
export const TOKEN_ROLES = [
  "accent",
  "secondary",
  "bg",
  "surface",
  "surface-elevated",
  "text",
  "muted",
  "border",
  "focus-ring",
  "code-bg",
  "code-fg",
];

export function isTokenRole(role) {
  return TOKEN_ROLES.includes(role);
}

function invariant(condition, message) {
  if (!condition) throw new Error(`css-var-bridge: ${message}`);
}

/**
 * Normalize a raw entry (`{ var, role, alpha }`) and validate it. Throws on a
 * malformed entry so a bad bridge config fails loudly at compile time.
 */
export function normalizeEntry(entry) {
  invariant(entry && typeof entry === "object", "bridge entry must be an object");
  invariant(typeof entry.var === "string" && entry.var.startsWith("--"), `bridge entry.var must be a CSS custom property, got ${String(entry.var)}`);
  invariant(isTokenRole(entry.role), `bridge entry role '${entry.role}' is not a known AgentSkin token role`);
  const alpha = entry.alpha ?? 1;
  invariant(typeof alpha === "number" && alpha > 0 && alpha <= 1, `bridge entry alpha must be in (0, 1], got ${alpha}`);
  return { var: entry.var, role: entry.role, alpha };
}

/** Build the `var(--agentskin-<role>)` reference for a role. */
export function tokenVar(role) {
  return `var(--agentskin-${role})`;
}

/** A single declaration `--native: <value> !important;`. */
export function compileVarDeclaration(entry, { important = true } = {}) {
  const norm = normalizeEntry(entry);
  const importantSuffix = important ? " !important" : "";
  if (norm.alpha >= 1) {
    return `  ${norm.var}: ${tokenVar(norm.role)}${importantSuffix};`;
  }
  const pct = Math.round(norm.alpha * 100);
  return `  ${norm.var}: color-mix(in srgb, ${tokenVar(norm.role)} ${pct}%, transparent)${importantSuffix};`;
}

/**
 * Compile bridge entries into:
 * - `css`: newline-joined declarations (caller wraps them in their host rule).
 * - `index`: a Map of nativeVar → normalized entry for lookups / JS resolution.
 */
export function compileBridge(entries, options) {
  const list = Array.isArray(entries) ? entries : [];
  const index = new Map();
  const declarations = [];
  for (const entry of list) {
    const norm = normalizeEntry(entry);
    index.set(norm.var, norm);
    declarations.push(compileVarDeclaration(norm, options));
  }
  return { css: declarations.join("\n"), index };
}

/** Wrap bridge declarations inside a CSS rule for a given selector. */
export function wrapBridgeRule(selector, css) {
  if (!css) return "";
  return `${selector} {\n${css}\n}\n`;
}

// ---------------------------------------------------------------------------
// Pure palette resolution — supports the JS-computed-style path and offline tests
// ---------------------------------------------------------------------------

/**
 * Parse a CSS color into `{ r, g, b, a }` (0-255 scale, a in [0,1]).
 * Supports `#rgb`, `#rrggbb`, `rgb()`, `rgba()`. Returns null for anything else
 * (e.g. `var()`, `color-mix`, named colors) so callers can choose a fallback.
 */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (m) {
    const hex = m[1];
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (m) {
    const hex = m[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(trimmed);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4]?.endsWith("%")) a /= 100;
    if (a > 1) a /= 255;
    return { r: Math.round(Number(m[1])), g: Math.round(Number(m[2])), b: Math.round(Number(m[3])), a };
  }
  return null;
}

function rgbaString({ r, g, b, a }) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Overlay `color(e.g. 180,230,255)` at `alpha` over `rgb` background. */
function mixLinear(fg, alpha, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  const eff = a * alpha;
  if (eff >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  const inv = 1 - eff;
  return {
    r: Math.round(fg.r * eff + bg.r * inv),
    g: Math.round(fg.g * eff + bg.g * inv),
    b: Math.round(fg.b * eff + bg.b * inv),
    a: eff + bg.a * inv,
  };
}

/**
 * Resolve a bridge entry's native variable to a concrete color string against a
 * theme palette `{ [role]: colorString }`. Produces the value the agent's
 * runtime would see, so JS-computed styles and offline checks stay consistent.
 * Returns `null` when the referenced token is missing from `palette` or is not
 * parseable (e.g. an image/url token).
 */
export function resolveBridgeColor(entry, palette) {
  if (!palette || typeof palette !== "object") return null;
  const norm = normalizeEntry(entry);
  const base = parseColor(palette[norm.role]);
  if (!base) return null;
  if (norm.alpha >= 1) return palette[norm.role]; // exact token value
  return rgbaString(mixLinear(base, norm.alpha, { r: 0, g: 0, b: 0, a: 0 }));
}

/** Resolve every bridge entry to a `{ [nativeVar]: concreteColor }` map. */
export function resolveBridgePalette(entries, palette, { skipUnresolvable = true } = {}) {
  const out = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const norm = normalizeEntry(entry);
    const resolved = resolveBridgeColor(norm, palette);
    if (resolved === null && skipUnresolvable) continue;
    out[norm.var] = resolved;
  }
  return out;
}

/**
 * Resolve a *native variable name* (not an entry) against a compiled index and a
 * palette — the harness-side mirror of the agent's own JS read. Returns the
 * concrete color the agent would compute for `--cb-text-secondary`, or null if
 * the variable is not bridged / its token is unresolvable.
 */
export function resolveVariable(variable, bridgeIndex, palette) {
  if (!bridgeIndex || typeof bridgeIndex.get !== "function") return null;
  const entry = bridgeIndex.get(variable);
  if (!entry) return null;
  return resolveBridgeColor(entry, palette);
}