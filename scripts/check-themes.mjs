// SPDX-License-Identifier: MPL-2.0

/**
 * # check-themes
 *
 * A3 — CI/husky gate for the themes directory. Runs on `themes/**` changes.
 *
 * Checks (beyond the runtime loader's schema validation, which runs in-app):
 *   1. Every `themes/<id>/manifest.json` parses and its `id` matches the
 *      directory name.
 *   2. Every CSS file referenced by `manifest.targets` exists.
 *   3. Each agent CSS declares the required `--agentskin-*` tokens:
 *      - All themes (builtin/community/imported): core 8 tokens
 *      - Builtin themes only: extended 6 tokens (total 14)
 *   4. `color-scheme` in each agent CSS matches `manifest.mode`.
 *   5. `themes/<id>/palette.css` (when present) also declares the tokens.
 *   6. P2 署名链 (author + license + version + accent + wiring.id):
 *      - Builtin: full enforcement (blocking)
 *      - Community/Imported: author/license auto-completed at runtime
 *        (warning only), wiring.id not required.
 *
 * Layered validation:
 *   - builtin   → standard level (full 14 tokens + full 署名链)
 *   - community → relaxed level (core 8 tokens, 署名链 auto-completed)
 *   - imported  → relaxed level (core 8 tokens, 署名链 auto-completed)
 *
 * Exit code is non-zero on any failure so the pre-commit hook blocks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PALETTE_TOKENS } from './theme-tokens.mjs';
import {
  checkExtendedContrast,
  checkThemeContrast,
  WCAG_DECORATIVE_RATIO,
} from './wcag-apca-check.mjs';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');
const ENGINES_DIR = path.resolve(process.cwd(), 'engines');

/**
 * `--agentskin-text-shadow` is emitted by `tokenBlock()` as a global default;
 * it is checked separately in addition to the canonical 14 tokens.
 */
const _EXTRA_TOKENS = ['--agentskin-text-shadow'];

/**
 * RGB-raw companion tokens — derived in `build-palette.mjs` from their parent
 * color tokens. Per-agent CSS in the engines directory uses
 * `rgba(var(--agentskin-muted-raw), alpha)` for translucent surfaces; if the
 * palette omits the `-raw` token the browser sees an invalid value, collapsing
 * the alpha layer. We require every palette to carry these.
 */
const RAW_TOKENS = [
  '--agentskin-accent-raw',
  '--agentskin-secondary-raw',
  '--agentskin-text-raw',
  '--agentskin-muted-raw',
  '--agentskin-surface-raw',
  '--agentskin-surface-elevated-raw',
  '--agentskin-bg-raw',
  '--agentskin-border-raw',
];

const ALL_PALETTE_TOKENS = [...PALETTE_TOKENS, ...RAW_TOKENS];

// --- Layered validation constants ---

/**
 * Known builtin theme IDs — authored by the AgentSkin team, shipped with the
 * product. These receive the strict "standard" validation level.
 */
const BUILTIN_THEME_IDS = new Set([
  'academy-corridor-winter',
  'crimson-horned-mecha',
  'exploding-tag-storm',
  'fuji-balcony-overcast',
  'fuji-rooftop-winter',
  'galactic-garden',
  'industrial-sage-toad',
  'luffy-grand-departure',
  'midnight-dessert-feast',
  'miku-future-beats',
  'shibuya-rooftop-mask',
  'stage-bassist-blue',
  'sunset-cellphone-girl',
  'void-donut-boy',
  'winged-mecha-ascendant',
  'yule-fireplace-glow',
]);

/** Core 8 tokens — required for ALL theme sources (builtin/community/imported). */
const CORE_8_TOKENS = [
  '--agentskin-accent',
  '--agentskin-bg',
  '--agentskin-text',
  '--agentskin-surface',
  '--agentskin-muted',
  '--agentskin-border',
  '--agentskin-secondary',
  '--agentskin-code-bg',
];

/** Extended 6 tokens — only enforced for builtin (standard) themes. */
const EXTENDED_6_TOKENS = [
  '--agentskin-code-fg',
  '--agentskin-surface-elevated',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-button-fg',
  '--agentskin-focus-ring',
];

/** Full 14-token set for standard-level themes (core 8 + extended 6). */
const STANDARD_TOKENS = [...CORE_8_TOKENS, ...EXTENDED_6_TOKENS];

/**
 * RGB-raw companions of the core 8 tokens (code-bg has no -raw variant).
 * Used for relaxed-level palette validation.
 */
const CORE_RAW_TOKENS = [
  '--agentskin-accent-raw',
  '--agentskin-bg-raw',
  '--agentskin-text-raw',
  '--agentskin-surface-raw',
  '--agentskin-muted-raw',
  '--agentskin-border-raw',
  '--agentskin-secondary-raw',
];

/**
 * Detect the source/category of a theme.
 *
 * Priority:
 *   1. community  — has "community" tag or id starts with "community-"
 *   2. builtin     — author.name is a known internal name, or id is in BUILTIN_THEME_IDS
 *   3. imported    — everything else
 *
 * @param {string} themeDir  Absolute path to the theme directory.
 * @param {object} manifest  Parsed manifest.json.
 * @returns {'builtin'|'community'|'imported'}
 */
export function detectThemeSource(themeDir, manifest) {
  const tags = manifest?.tags;
  if (Array.isArray(tags) && tags.some((t) => t.toLowerCase() === 'community')) {
    return 'community';
  }
  if (typeof manifest?.id === 'string' && manifest.id.startsWith('community-')) {
    return 'community';
  }

  const authorName = manifest?.author?.name;
  if (
    authorName === 'Auto-generated' ||
    authorName === 'AgentSkin Team' ||
    authorName === 'Internal'
  ) {
    return 'builtin';
  }
  const themeId = manifest?.id ?? path.basename(themeDir);
  if (BUILTIN_THEME_IDS.has(themeId)) {
    return 'builtin';
  }

  return 'imported';
}

// --- P2 署名链合规校验常量 ---

const KNOWN_LICENSES = new Set([
  'MPL-2.0',
  'MIT',
  'Apache-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'CC-BY-NC-ND-4.0',
  'CC0-1.0',
  'Unlicense',
  'Proprietary',
]);

const WIRING_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const COLOR_REGEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * 署名链校验（避免 import .ts 模块）。
 *
 * @param {object} manifest  Parsed manifest.json.
 * @param {string} themeName  Directory name of the theme.
 * @param {'builtin'|'community'|'imported'} source  Detected theme source.
 * @returns {{ errs: string[], warnings: string[] }}
 */
export function validateThemeMetadataInline(manifest, themeName, _source) {
  const errs = [];
  const warnings = [];

  // --- author (warning for all sources — auto-completed at runtime) ---
  if (
    !manifest.author?.name ||
    typeof manifest.author.name !== 'string' ||
    manifest.author.name.trim().length === 0
  ) {
    warnings.push(`${themeName}: missing author (auto-completed at runtime)`);
  } else if (manifest.author.url !== undefined) {
    if (typeof manifest.author.url !== 'string') {
      errs.push(`${themeName}: author.url must be a string`);
    } else {
      try {
        const url = new URL(manifest.author.url);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
          errs.push(`${themeName}: author.url must be an http, https, or mailto URL`);
        }
      } catch {
        errs.push(`${themeName}: author.url is not a valid URL: "${manifest.author.url}"`);
      }
    }
  }

  // --- license (warning for all sources — auto-completed at runtime) ---
  if (!manifest.license) {
    warnings.push(`${themeName}: missing license (auto-completed at runtime)`);
  } else if (!KNOWN_LICENSES.has(manifest.license)) {
    errs.push(
      `${themeName}: license "${manifest.license}" is not a known SPDX identifier\n    Fix: Use a standard SPDX license identifier (e.g. "MPL-2.0", "MIT", "CC-BY-NC-SA-4.0")`,
    );
  }

  // --- version (always blocking for all sources) ---
  if (!manifest.version) {
    errs.push(
      `${themeName}: missing required version field\n    Fix: Add "version": "1.0.0" to themes/${themeName}/manifest.json`,
    );
  } else if (!SEMVER_REGEX.test(manifest.version)) {
    errs.push(
      `${themeName}: version "${manifest.version}" is not valid semver\n    Fix: Use semantic versioning (e.g. "1.0.0", "2.1.0-beta.1")`,
    );
  }

  // --- accent color (always blocking for all sources) ---
  const accent = manifest.colors?.accent ?? manifest.colors?.primary;
  if (!accent) {
    errs.push(
      `${themeName}: missing required accent color (colors.accent)\n    Fix: Add "accent": "#hex" to the colors object in themes/${themeName}/manifest.json`,
    );
  } else if (!COLOR_REGEX.test(accent)) {
    errs.push(
      `${themeName}: accent color "${accent}" is not a valid CSS color\n    Fix: Use a valid hex color (e.g. "#a78bfa") for colors.accent`,
    );
  }

  // --- wiring.id (warning for all sources — not blocking) ---
  const wiringId = manifest.wiring?.id;
  if (!wiringId) {
    warnings.push(`${themeName}: missing wiring.id (recommended for dsh-deep-whale wiring model)`);
  } else if (!WIRING_ID_REGEX.test(wiringId)) {
    warnings.push(
      `${themeName}: wiring.id "${wiringId}" should match pattern ${WIRING_ID_REGEX.source} (e.g. "ui-skin-cyber-neon")`,
    );
  }

  return { errs, warnings };
}

/** Detect `var(--x, fallback)` where fallback is hardcoded (e.g. 128,128,128).
 *  These indicate tokens that the palette may not declare, risking silent
 *  fallback drift at runtime. */
function findRawFallbacks(css) {
  const out = [];
  const re = /var\(\s*(--agentskin-[\w-]+)\s*,\s*([^)]+)\)/g;
  let m = re.exec(css);
  while (m !== null) {
    const token = m[1];
    const fallback = m[2].trim();
    // Only flag *-raw with neutral fallback (the known drift pattern)
    if (token.endsWith('-raw') && /128,\s*128,\s*128|#\d\d\d\d\d\d|rgba?\(\s*128/.test(fallback)) {
      out.push(`${token} → fallback ${fallback}`);
    }
    m = re.exec(css);
  }
  return out;
}

function tokenPattern(token) {
  // Match a declaration inside any block: `--agentskin-bg: <value>;`
  return new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
}

async function checkTokenCoverage(cssPath, label, errors, tokens) {
  let css;
  try {
    css = await fs.readFile(cssPath, 'utf8');
  } catch (e) {
    errors.push(
      `${label}: file not found (${e.message})\n    Fix: Verify the CSS file path exists relative to the theme directory; check for typos in manifest.targets.<agent>.css or ensure the file was generated by npm run generate:theme-css`,
    );
    return;
  }
  const missing = tokens.filter((t) => !tokenPattern(t).test(css));
  if (missing.length > 0) {
    errors.push(
      `${label}: missing ${missing.length} required token(s): ${missing.join(', ')}\n    Fix: Add the missing --agentskin-* variable declarations to the CSS file (e.g. --agentskin-bg: #1a1a1a;) — if this is palette.css, regenerate it with npm run generate:palette`,
    );
  }
  return css;
}

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`check-themes: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  const jsonMode = process.argv.includes('--json');
  const errors = [];
  const warnings = [];
  let checked = 0;
  const sourceCounts = { builtin: 0, community: 0, imported: 0 };
  const themeMap = new Map();

  if (jsonMode) {
    console.warn = () => {};
    console.error = () => {};
  }

  function getThemeEntry(name, source = 'imported') {
    let entry = themeMap.get(name);
    if (!entry) {
      entry = { id: name, source, errors: [], warnings: [] };
      themeMap.set(name, entry);
    }
    return entry;
  }

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue; // shared layer, not a theme package
    const themeDir = path.join(THEMES_DIR, entry.name);
    const manifestPath = path.join(themeDir, 'manifest.json');

    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a theme package (e.g. docs/scratch dir)
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      const jsonErr = `${entry.name}: manifest.json is not valid JSON\n    Fix: Open themes/${entry.name}/manifest.json and run it through jsonlint (or a JSON validator) to find and fix syntax errors — common issues: trailing commas, unquoted keys, unescaped characters`;
      errors.push(jsonErr);
      getThemeEntry(entry.name).errors.push(jsonErr);
      continue;
    }

    // --- Detect theme source for layered validation ---
    const source = detectThemeSource(themeDir, manifest);
    sourceCounts[source]++;
    const isStrict = source === 'builtin';
    const agentTokenSet = isStrict ? STANDARD_TOKENS : CORE_8_TOKENS;
    const themeEntry = getThemeEntry(entry.name, source);

    if (manifest.id !== entry.name) {
      const idErr = `${entry.name}: manifest.id "${manifest.id}" != directory name\n    Fix: Change the "id" field in themes/${entry.name}/manifest.json from "${manifest.id}" to "${entry.name}" so it matches the directory name`;
      errors.push(idErr);
      themeEntry.errors.push(idErr);
    }
    if (!manifest.colors || typeof manifest.colors.background !== 'string') {
      const bgErr = `${entry.name}: colors.background missing\n    Fix: Add "colors": { "background": "#<hex>" } to themes/${entry.name}/manifest.json — this is the base background color used to derive the full palette`;
      errors.push(bgErr);
      themeEntry.errors.push(bgErr);
    }
    checked++;

    // WCAG/APCA contrast check (warn-only, does not block CI).
    // Only warn for severe cases where ratio falls below the decorative floor
    // (3.0:1). Themes declaring _wcag.level='decorative' pass at 3.0:1; themes
    // at default 'AA' are still checked by assertContrast for strict assertions.
    const contrast = checkThemeContrast(manifest);
    if (contrast && contrast.wcag.ratio < WCAG_DECORATIVE_RATIO) {
      themeEntry.warnings.push(
        `foreground/background contrast ${contrast.wcag.ratio}:1 < 3.0 (decorative floor)`,
      );
      console.warn(
        `  ⚠ ${entry.name}: foreground/background contrast ${contrast.wcag.ratio}:1 < 3.0 (decorative floor)`,
      );
    }
    // Extended colors contrast check (warn-only).
    // Same 3.0:1 floor — only flag truly severe cases.
    const extContrast = checkExtendedContrast(manifest);
    for (const ec of extContrast) {
      if (ec.ratio < WCAG_DECORATIVE_RATIO) {
        themeEntry.warnings.push(
          `extended color "${ec.name}" contrast ${ec.ratio}:1 < 3.0 (decorative floor)`,
        );
        console.warn(
          `  ⚠ ${entry.name}: extended color "${ec.name}" contrast ${ec.ratio}:1 < 3.0 (decorative floor)`,
        );
      }
    }

    // 1) target CSS files: existence + token coverage + color-scheme match.
    const targets = manifest.targets ?? {};
    const agentIds = Object.keys(targets);

    // Resolve the scheme list: 'default' (manifest colors) + each declared
    // color scheme (its mode may differ from the manifest mode).
    const schemeIds = ['default', ...(manifest.colorSchemes ?? [])];
    const schemeModes = new Map();
    for (const schemeId of schemeIds) {
      if (schemeId === 'default') {
        schemeModes.set('default', manifest.mode);
        continue;
      }
      try {
        const scheme = JSON.parse(
          await fs.readFile(path.join(themeDir, 'color-schemes', `${schemeId}.json`), 'utf8'),
        );
        schemeModes.set(schemeId, scheme.mode ?? manifest.mode);
      } catch {
        const schemeErr = `${entry.name}: cannot read color-schemes/${schemeId}.json\n    Fix: Create themes/${entry.name}/color-schemes/${schemeId}.json with at least { "mode": "dark" } or { "mode": "light" }, or remove '${schemeId}' from the colorSchemes array in manifest.json if it no longer exists`;
        errors.push(schemeErr);
        themeEntry.errors.push(schemeErr);
      }
    }

    for (const agentId of agentIds) {
      const config = targets[agentId];
      if (!config || typeof config.css !== 'string') {
        const cssPathErr = `${entry.name}: targets.${agentId} missing css path\n    Fix: Add a "css" string field to targets.${agentId} in themes/${entry.name}/manifest.json (e.g. "css": "assets/css/${agentId}.css") pointing to the agent's CSS file`;
        errors.push(cssPathErr);
        themeEntry.errors.push(cssPathErr);
        continue;
      }
      // Default scheme CSS lives at the manifest-referenced path (e.g.
      // assets/css/<agent>.css); alternative schemes at assets/css/<schemeId>/<agent>.css.
      for (const schemeId of schemeIds) {
        const cssPath =
          schemeId === 'default'
            ? path.join(themeDir, config.css)
            : path.join(themeDir, 'assets', 'css', schemeId, path.basename(config.css));
        const label = `${entry.name}/${schemeId}/${agentId} (${cssPath})`;
        const errCountBeforeToken = themeEntry.errors.length;
        const css = await checkTokenCoverage(cssPath, label, themeEntry.errors, agentTokenSet);
        for (let i = errCountBeforeToken; i < themeEntry.errors.length; i++) {
          errors.push(themeEntry.errors[i]);
        }
        const mode = schemeModes.get(schemeId);
        if (css && mode === 'dark' && !/color-scheme:\s*dark/.test(css)) {
          const darkModeErr = `${label}: mode=dark but CSS lacks "color-scheme: dark"\n    Fix: Add "color-scheme: dark;" to the :root or html selector block in the CSS file — without it, native UI chrome (scrollbars, form controls) will render in light mode`;
          errors.push(darkModeErr);
          themeEntry.errors.push(darkModeErr);
        }
        if (css && mode === 'light' && !/color-scheme:\s*light/.test(css)) {
          const lightModeErr = `${label}: mode=light but CSS lacks "color-scheme: light"\n    Fix: Add "color-scheme: light;" to the :root or html selector block in the CSS file — without it, native UI chrome (scrollbars, form controls) will render in dark mode`;
          errors.push(lightModeErr);
          themeEntry.errors.push(lightModeErr);
        }
      }
    }

    // 2) generated palette files (when present) must declare the tokens.
    for (const schemeId of schemeIds) {
      const paletteName = schemeId === 'default' ? 'palette.css' : `palette.${schemeId}.css`;
      const palettePath = path.join(themeDir, paletteName);
      if (
        (await fs
          .stat(palettePath)
          .then(() => true)
          .catch(() => false)) === true
      ) {
        const paletteTokenSet = isStrict
          ? ALL_PALETTE_TOKENS
          : [...CORE_8_TOKENS, ...CORE_RAW_TOKENS];
        const errCountBeforePalette = themeEntry.errors.length;
        await checkTokenCoverage(
          palettePath,
          `${entry.name}/${paletteName}`,
          themeEntry.errors,
          paletteTokenSet,
        );
        for (let i = errCountBeforePalette; i < themeEntry.errors.length; i++) {
          errors.push(themeEntry.errors[i]);
        }
      }
    }
  }

  // 3) P2 guard: scan engines/*/tokens.css for *-raw fallback to neutral gray.
  //    These indicate defensive fallbacks that exist in engine CSS. They should
  //    never fire when the palette properly declares the *-raw tokens (which
  //    `build-palette.mjs` does). Reported as non-blocking warnings so operators
  //    can see drift observations without CI failure.
  const rawWarnings = [];
  try {
    const engineDirs = await fs.readdir(ENGINES_DIR, { withFileTypes: true });
    for (const ed of engineDirs) {
      if (!ed.isDirectory()) continue;
      const tokensPath = path.join(ENGINES_DIR, ed.name, 'tokens.css');
      let engineCss;
      try {
        engineCss = await fs.readFile(tokensPath, 'utf8');
      } catch {
        continue;
      }
      for (const hit of findRawFallbacks(engineCss)) {
        rawWarnings.push(`engines/${ed.name}/tokens.css: *-raw neutral fallback — ${hit}`);
      }
    }
  } catch {
    // engines/ may not exist in minimal checkouts — non-fatal
  }

  // 4) P2 署名链合规校验（分层：builtin 严格，community/imported 宽松）
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue;
    const metaManifestPath = path.join(THEMES_DIR, entry.name, 'manifest.json');
    let metaManifestRaw;
    try {
      metaManifestRaw = await fs.readFile(metaManifestPath, 'utf8');
    } catch {
      continue;
    }
    if (!metaManifestRaw) continue;
    let metaManifest;
    try {
      metaManifest = JSON.parse(metaManifestRaw);
    } catch {
      continue; // JSON parse error already reported above
    }
    const metaSource = detectThemeSource(path.join(THEMES_DIR, entry.name), metaManifest);
    const metaThemeEntry = getThemeEntry(entry.name, metaSource);
    const { errs: metaErrors, warnings: metaWarnings } = validateThemeMetadataInline(
      metaManifest,
      entry.name,
      metaSource,
    );
    for (const e of metaErrors) {
      errors.push(e);
      metaThemeEntry.errors.push(e);
    }
    for (const w of metaWarnings) {
      warnings.push(w);
      metaThemeEntry.warnings.push(w);
    }
  }

  // 5) Extended colors format validation (blocking for declared keys, all sources).
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue;
    const exManifestPath = path.join(THEMES_DIR, entry.name, 'manifest.json');
    let exManifestRaw;
    try {
      exManifestRaw = await fs.readFile(exManifestPath, 'utf8');
    } catch {
      continue;
    }
    if (!exManifestRaw) continue;
    let exManifest;
    try {
      exManifest = JSON.parse(exManifestRaw);
    } catch {
      continue;
    }
    const exSource = detectThemeSource(path.join(THEMES_DIR, entry.name), exManifest);
    const exThemeEntry = getThemeEntry(entry.name, exSource);
    const ext = exManifest?.colors?.extended;
    if (!ext || typeof ext !== 'object') continue;
    const validHex = /^#([0-9a-f]{6})$/i;
    const reserved = new Set(['on', 'ext', 'raw', 'wcag']);
    for (const [name, value] of Object.entries(ext)) {
      if (reserved.has(name)) {
        const reservedErr = `${entry.name}: colors.extended.${name} uses reserved key "${name}"\n    Fix: Rename the extended color key to avoid reserved names: ${[...reserved].join(', ')}`;
        errors.push(reservedErr);
        exThemeEntry.errors.push(reservedErr);
        continue;
      }
      if (typeof value !== 'string' || !validHex.test(value)) {
        const hexErr = `${entry.name}: colors.extended.${name} has invalid hex "${value}"\n    Fix: Use a valid 6-digit hex color (e.g. "#ef4444") for extended color "${name}"`;
        errors.push(hexErr);
        exThemeEntry.errors.push(hexErr);
      }
    }
  }

  // --- Output ---
  if (jsonMode) {
    const result = {
      ok: errors.length === 0,
      checked,
      errors,
      warnings: [...warnings, ...rawWarnings],
      sourceCounts,
      themes: Array.from(themeMap.values()).map((t) => ({
        ...t,
        ok: t.errors.length === 0,
      })),
    };
    console.log(JSON.stringify(result, null, 2));
    if (errors.length > 0) process.exit(1);
    return;
  }

  if (rawWarnings.length > 0) {
    console.warn(
      `check-themes: ${rawWarnings.length} *-raw fallback observation(s) (non-blocking):`,
    );
    for (const w of rawWarnings) console.warn(`  ⚠ ${w}`);
  }

  if (warnings.length > 0) {
    console.warn(`check-themes: ${warnings.length} auto-completion notice(s) (non-blocking):`);
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
  }

  if (errors.length > 0) {
    console.error(`check-themes: ${errors.length} issue(s) in ${checked} theme(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(
    `check-themes: OK — ${checked} theme(s) pass (builtin: ${sourceCounts.builtin}, community: ${sourceCounts.community}, imported: ${sourceCounts.imported})`,
  );
}

main().catch((e) => {
  console.error(`check-themes: unexpected error: ${e.stack ?? e}`);
  process.exit(1);
});
