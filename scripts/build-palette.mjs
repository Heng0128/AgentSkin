/**
 * build-palette.mjs — Generate palette.css from theme manifest.json
 *
 * Usage:
 *   node scripts/build-palette.mjs [themeId|all]
 *
 * Reads themes/{themeId}/manifest.json (or theme.json), extracts the 14
 * unified --agentskin-* colors + derived raw values, and outputs a tiny
 * palette.css (~1KB) that defines those custom properties on :root.
 *
 * This replaces the 72-file generation step: engines/ provides the shared
 * structure, palette.css provides the per-theme color identity.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
// Note: readFileSync is already imported above; verify mode reuses it.
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const THEMES_DIR = join(ROOT, 'themes');

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function buildPaletteCss(colors, themeId, meta = {}) {
  const c = colors;
  const lines = [
    `/* palette.css — ${themeId} (${meta.displayName || themeId}) */`,
    `/* Auto-generated from manifest.json — do not edit. */`,
    `:root {`,
    `  --agentskin-bg: ${c.background};`,
    `  --agentskin-surface: ${c.surface};`,
    `  --agentskin-surface-elevated: ${c.surfaceElevated};`,
    `  --agentskin-text: ${c.foreground};`,
    `  --agentskin-muted: ${c.muted};`,
    `  --agentskin-accent: ${c.accent};`,
    `  --agentskin-secondary: ${c.secondary};`,
    `  --agentskin-border: ${c.border || c.accent};`,
    `  --agentskin-code-bg: ${c.codeBg || c.background};`,
    `  --agentskin-code-fg: ${c.codeFg || c.foreground};`,
    `  --agentskin-focus-ring: ${c.focusRing || `color-mix(in srgb, ${c.accent} 40%, transparent)`};`,
    `  --agentskin-selection: ${c.selection || `color-mix(in srgb, ${c.accent} 32%, transparent)`};`,
    ``,
    `  /* Derived raw RGB values for agents using rgba(var(--raw), alpha) pattern */`,
    `  --agentskin-accent-raw: ${hexToRgb(c.accent)};`,
    `  --agentskin-secondary-raw: ${hexToRgb(c.secondary)};`,
    `  --agentskin-text-raw: ${hexToRgb(c.foreground)};`,
    `  --agentskin-muted-raw: ${hexToRgb(c.muted)};`,
    `  --agentskin-surface-raw: ${hexToRgb(c.surface)};`,
    `  --agentskin-surface-elevated-raw: ${hexToRgb(c.surfaceElevated)};`,
    `  --agentskin-bg-raw: ${hexToRgb(c.background)};`,
    `  --agentskin-border-raw: ${hexToRgb(c.border || c.accent)};`,
    `}`,
  ];
  return lines.join('\n') + '\n';
}

function loadManifest(themeDir) {
  // Try manifest.json first, then theme.json
  for (const name of ['manifest.json', 'theme.json']) {
    const p = join(themeDir, name);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  return null;
}

function extractColorsFromManifest(manifest) {
  // Manifest format: { colors: { background, surface, ... } }
  // or nested: { theme: { colors: {...} } }
  if (manifest.colors) return manifest.colors;
  if (manifest.theme?.colors) return manifest.theme.colors;
  // Legacy: palette field
  if (manifest.palette) return manifest.palette;
  return null;
}

function processTheme(themeId) {
  const themeDir = join(THEMES_DIR, themeId);
  if (!existsSync(themeDir)) {
    console.error(`[build-palette] theme dir not found: ${themeDir}`);
    return false;
  }

  const manifest = loadManifest(themeDir);
  if (!manifest) {
    console.error(`[build-palette] no manifest.json/theme.json in ${themeId}`);
    return false;
  }

  const colors = extractColorsFromManifest(manifest);
  if (!colors) {
    console.error(`[build-palette] no colors found in ${themeId} manifest`);
    return false;
  }

  const meta = { displayName: manifest.displayName || manifest.theme?.displayName || themeId };
  const css = buildPaletteCss(colors, themeId, meta);
  const outPath = join(themeDir, 'palette.css');
  writeFileSync(outPath, css, 'utf8');
  console.log(`[build-palette] ${themeId} → palette.css (${css.length} bytes)`);
  return true;
}

/**
 * Verify mode: compare generated palette.css with the on-disk file.
 * Exits non-zero on staleness so it can gate `npm run check`.
 */
function verifyTheme(themeId) {
  const themeDir = join(THEMES_DIR, themeId);
  if (!existsSync(themeDir)) return true;
  const manifest = loadManifest(themeDir);
  if (!manifest) return true;
  const colors = extractColorsFromManifest(manifest);
  if (!colors) return true;

  const meta = { displayName: manifest.displayName || manifest.theme?.displayName || themeId };
  const expected = buildPaletteCss(colors, themeId, meta);
  const outPath = join(themeDir, 'palette.css');
  if (!existsSync(outPath)) {
    console.error(`[build-palette:verify] ${themeId}: palette.css MISSING — run 'npm run generate:palette'`);
    return false;
  }
  const actual = readFileSync(outPath, 'utf8');
  if (actual !== expected) {
    console.error(`[build-palette:verify] ${themeId}: palette.css STALE — run 'npm run generate:palette'`);
    return false;
  }
  return true;
}

// --- Main ---
const args = process.argv.slice(2);
const verifyMode = args.includes('--verify') || args.includes('-v');
const themeArg = args.find((a) => !a.startsWith('-')) || 'all';

if (verifyMode) {
  const dirs = readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name);
  let stale = 0;
  for (const id of dirs) {
    if (!verifyTheme(id)) stale++;
  }
  if (stale > 0) {
    console.error(`\n[build-palette:verify] ${stale} palette(s) stale or missing.`);
    process.exit(1);
  }
  console.log(`[build-palette:verify] all ${dirs.length} palette(s) up-to-date.`);
} else if (themeArg === 'all') {
  const dirs = readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map(d => d.name);
  let ok = 0, fail = 0;
  for (const id of dirs) {
    if (processTheme(id)) ok++; else fail++;
  }
  console.log(`\n[build-palette] done: ${ok} ok, ${fail} failed, ${dirs.length} total`);
} else {
  processTheme(themeArg);
}
