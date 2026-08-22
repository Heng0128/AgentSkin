// SPDX-License-Identifier: MPL-2.0

/**
 * # Palette CSS Generator
 *
 * Pure transformation functions that convert per-agent theme CSS into a
 * `palette.css` string with derived `--agentskin-*-raw` RGB triplets.
 *
 * Extracted from the former `palette-builder.ts` (P3 of the god-object
 * teardown) to separate the **generation** concern (this module) from the
 * **orchestration** concern (`orchestrator.ts` — loads engine files and
 * delegates to `injectThemeViaEngine`).
 *
 * Both functions here are pure: no I/O, no side effects, no dependencies on
 * CDP sessions, `applyEpoch`, or filesystem state. This makes them trivial
 * to unit-test in isolation.
 *
 * @see {@link orchestrator.ts} for the engine-injection orchestration that
 *      consumes the output of {@link buildPaletteCss}.
 */

// ---------------------------------------------------------------------------
// Hex → RGB triplet conversion (for engine tokens.css var(--agentskin-*-raw))
// ---------------------------------------------------------------------------

/**
 * Convert a hex color (`#rgb` or `#rrggbb`) to an `r, g, b` triplet string.
 * Returns null for non-hex values so callers can skip deriving a `-raw` var
 * when the source color is itself a `var()` or `color-mix()`.
 *
 * Exported for direct unit testing — the function is pure and has no
 * side effects, so testing it in isolation is more valuable than only
 * covering it indirectly through {@link buildPaletteCss}.
 */
export function hexToRgbTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1];
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// Palette CSS construction
// ---------------------------------------------------------------------------

/**
 * Build a palette.css from the per-agent theme CSS's `--agentskin-*` tokens.
 *
 * Extracts `--agentskin-*` variables from the resolved per-agent CSS (not the
 * first target) so agent-specific palette overrides (e.g. doubao's darker
 * `--agentskin-code-bg`) are respected. Also derives `--agentskin-*-raw` RGB
 * triplets from hex colors when missing — these are required by engine
 * `tokens.css` which uses `var(--agentskin-accent-raw)` for `rgba()` patterns.
 *
 * Returns null if the input is empty or has fewer than 6 `--agentskin-*`
 * declarations (treated as a malformed theme → caller falls back).
 */
export function buildPaletteCss(agentCss: string): string | null {
  if (!agentCss) return null;

  const varRe = /--agentskin-([\w-]+)\s*:\s*([^;]+)/g;
  const tokens = new Map<string, string>();
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = varRe.exec(agentCss)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    if (!tokens.has(name)) tokens.set(name, value);
  }
  if (tokens.size < 6) return null;

  // Derive -raw RGB triplets from hex colors when missing. Engine tokens.css
  // references var(--agentskin-accent-raw) etc. for rgba(var(--...-raw), alpha)
  // patterns; without these, native token overrides using -raw variants break.
  const rawBases = [
    'accent',
    'secondary',
    'text',
    'muted',
    'surface',
    'surface-elevated',
    'bg',
    'border',
  ];
  for (const base of rawBases) {
    const rawKey = `${base}-raw`;
    if (tokens.has(rawKey)) continue;
    const hexVal = tokens.get(base);
    if (!hexVal) continue;
    const rgb = hexToRgbTriple(hexVal);
    if (rgb) tokens.set(rawKey, rgb);
  }

  const declarations = [...tokens.entries()].map(
    ([name, value]) => `  --agentskin-${name}: ${value};`,
  );
  return `:root {\n${declarations.join('\n')}\n}\n`;
}
