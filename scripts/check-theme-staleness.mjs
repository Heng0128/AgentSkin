// SPDX-License-Identifier: MPL-2.0

/**
 * # check-theme-staleness (C3 — Palette-CSS sync)
 *
 * Run via: `node scripts/check-theme-staleness.mjs`
 * Exits non-zero on staleness so it can gate `npm run check`.
 *
 * Verifies that the generated per-agent CSS files (`assets/css/<agent>.css`)
 * stay in sync with the source palette (`palette.css`). The 14-token pipeline
 * derives `palette.css` from `manifest.colors` (via `build-palette.mjs`), then
 * derives each agent CSS from the palette (via `generate-theme-css.mjs`).
 *
 * If the palette is regenerated but the agent CSS is not, token values drift
 * silently — the theme renders with stale colors on that agent.
 *
 * Checks:
 *   1. Every `--agentskin-*` token declared in `palette.css` is ALSO declared
 *      in each agent CSS (presence check — catches missing-token staleness).
 *   2. Tokens that are directly assigned a literal value in palette.css
 *      (hex like `#ff7a6b`, rgb/rgba like `rgba(255,122,107,0.16)`) appear
 *      with the SAME literal value in the agent CSS. This catches staleness
 *      where a source color changed but the agent CSS was not regenerated.
 *      Tokens using `color-mix()` form in palette receive structural
 *      validation (presence + that the agent CSS references the same source
 *      color) rather than strict string match, since
 *      `color-mix(in srgb, #X N%, transparent)` ≡ `rgba(<rgb(#X), N)` are
 *      the same semantic value in different generator literal forms.
 *   3. The 14 required tokens (same set `scripts/check-themes.mjs` enforces)
 *      are all declared in each agent CSS — the "CSS half" of the 14-token
 *      contract.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');

/** The 14 required design tokens every agent CSS must declare. */
const REQUIRED_TOKENS = [
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
  '--agentskin-button-bg',
  '--agentskin-input-bg',
];

/** Tokens that exist ONLY in the agent-CSS layer (per-agent derived). */
const AGENT_ONLY_TOKENS = new Set(['--agentskin-button-bg', '--agentskin-input-bg']);

/** Match a `--agentskin-*` declaration: name → value. */
const TOKEN_RE = /(?<![\w-])(--agentskin-[\w-]+)\s*:\s*([^;]+);/g;

/**
 * Extract `--agentskin-*` token declarations from a CSS string.
 * Returns a Map of token name → declared value (trimmed, no trailing `;`).
 */
function extractTokens(css) {
  const tokens = new Map();
  TOKEN_RE.lastIndex = 0;
  let m = TOKEN_RE.exec(css);
  while (m !== null) {
    tokens.set(m[1], m[2].trim());
    m = TOKEN_RE.exec(css);
  }
  return tokens;
}

/**
 * Extract all distinct RGB color triples from a CSS value.
 *
 * Catches both hex form (`#rrggbb`, `#rgb`) and decimal form inside
 * `rgb()`/`rgba()` (e.g. `rgba(255, 122, 107, 0.32)` → {255,122,107}).
 * Alpha and mixing syntax are ignored — only the source color identity
 * matters for drift detection.
 *
 * Returns a Set of normalized "r,g,b" strings for order-independent comparison.
 */
function extractColors(value) {
  const out = new Set();
  // Hex: #rgb → #rrggbb, #rrggbb → itself.
  const hexRe = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
  let m = hexRe.exec(value);
  while (m !== null) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    out.add(`${r},${g},${b}`);
    m = hexRe.exec(value);
  }
  // Decimal: rgb(r, g, b) / rgba(r, g, b, a).
  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  m = rgbRe.exec(value);
  while (m !== null) {
    out.add(`${+m[1]},${+m[2]},${+m[3]}`);
    m = rgbRe.exec(value);
  }
  return out;
}

/** True if two sets have the same elements. */
function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`check-theme-staleness: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  const errors = [];
  let checked = 0;

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const themeDir = path.join(THEMES_DIR, entry.name);
    const manifestPath = path.join(themeDir, 'manifest.json');

    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a theme package
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      continue; // invalid JSON → check-themes.mjs owns this error
    }

    const palettePath = path.join(themeDir, 'palette.css');
    let paletteCss;
    try {
      paletteCss = await fs.readFile(palettePath, 'utf8');
    } catch {
      continue; // no palette.css → hand-authored theme (art: false); skip
    }

    checked++;
    const paletteTokens = extractTokens(paletteCss);

    const targets = manifest.targets ?? {};
    for (const [agentId, config] of Object.entries(targets)) {
      if (!config || typeof config.css !== 'string') continue;
      const cssPath = path.join(themeDir, config.css);
      let agentCss;
      try {
        agentCss = await fs.readFile(cssPath, 'utf8');
      } catch {
        errors.push(
          `${entry.name}/${agentId}: agent CSS not found at ${config.css}\n    Fix: Run npm run generate:theme-css to regenerate the agent CSS`,
        );
        continue;
      }

      const agentTokens = extractTokens(agentCss);

      // 1) + 2) Cross-check every palette token against agent CSS.
      for (const [token, paletteVal] of paletteTokens) {
        if (token.endsWith('-raw')) continue; // engine-side companion

        if (!agentTokens.has(token)) {
          errors.push(
            `${entry.name}/${agentId}: missing palette token ${token}\n    Fix: Regenerate with npm run generate:theme-css — agent CSS is out of sync with palette.css`,
          );
          continue;
        }

        const agentVal = agentTokens.get(token);

        // Direct literal equality (most tokens are shared verbatim: #hex, rgb/rgba).
        if (agentVal === paletteVal) continue;

        // Different literal form, same source color? Catches the known
        // palette↔agent divergence (palette uses `color-mix(in srgb, #hex N%, transparent)`
        // while agent CSS uses `rgba(r, g, b, N)` — same semantics, two generators).
        const paletteColors = extractColors(paletteVal);
        const agentColors = extractColors(agentVal);
        if (paletteColors.size > 0 && setEq(paletteColors, agentColors)) continue;

        // Genuine drift: same token, different literal values, different colors.
        errors.push(
          `${entry.name}/${agentId}: stale token ${token}\n    palette: ${paletteVal}\n    agent:   ${agentVal}\n    Fix: Regenerate with npm run generate:theme-css`,
        );
      }

      // 3) All 14 required tokens must be declared in the agent CSS.
      for (const token of REQUIRED_TOKENS) {
        if (!agentTokens.has(token)) {
          errors.push(
            `${entry.name}/${agentId}: missing required token ${token}\n    Fix: Regenerate with npm run generate:theme-css — the 14-token contract is incomplete`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(
      `✖ check-theme-staleness: ${errors.length} staleness issue(s) in ${checked} theme(s):\n`,
    );
    for (const e of errors) console.error(`  ✗ ${e}\n`);
    process.exit(1);
  }
  console.log(`check-theme-staleness: OK — ${checked} theme(s) pass (palette↔CSS 14-token sync)`);
}

main().catch((e) => {
  console.error(`check-theme-staleness: unexpected error: ${e.stack ?? e}`);
  process.exit(1);
});
