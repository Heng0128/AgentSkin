// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme-package
 *
 * Quality gate for AgentSkin theme packages. Complements `check-themes.mjs`
 * (which enforces the 14-token contract) with structural and budget checks:
 *
 *   1. PNG alpha channel detection — flags images in `assets/images/` whose
 *      IHDR color type lacks an alpha channel (type 4 or 6).
 *   2. Payload budget — builtin themes get 50 MB, community/imported 20 MB.
 *   3. CSS url() reference integrity — every `url(...)` in a CSS file must
 *      resolve to an existing file relative to the CSS file's directory.
 *   4. Manifest structure integrity — required fields, schemaVersion === 2,
 *      and valid hex color for `colors.accent`.
 *
 * Skips `<theme-id>.agentskin-theme/` bundle subdirectories.
 *
 * Usage:
 *   node scripts/validate-theme-package.mjs themes/academy-corridor-winter
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Constants ---

/** PNG signature: 137 80 78 71 13 10 26 10 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Color types that include an alpha channel. */
const ALPHA_COLOR_TYPES = new Set([4, 6]);

/** Byte offset of the IHDR color type field. */
// PNG signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4) + bit depth (1) = 25
const IHDR_COLOR_TYPE_OFFSET = 25;

/** Payload budget in bytes. */
const PAYLOAD_BUDGET = {
  builtin: 50 * 1024 * 1024, // 50 MB
  community: 20 * 1024 * 1024, // 20 MB
  imported: 20 * 1024 * 1024, // 20 MB
};

/** Required top-level manifest fields. */
const REQUIRED_MANIFEST_FIELDS = ['schemaVersion', 'id', 'name', 'author', 'version', 'colors'];

/** Valid hex color pattern: #xxx or #xxxxxx. */
const HEX_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Regex to extract url(...) references from CSS. */
const CSS_URL_REGEX = /url\(\s*['"]?([^'")\s]+?)['"]?\s*\)/g;

/** Known builtin theme IDs (mirrors check-themes.mjs). */
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

// --- Utility functions ---

/**
 * Detect the source/category of a theme.
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

/**
 * Recursively collect all files in a directory, skipping `.agentskin-theme`
 * bundle subdirectories. Returns an array of { relPath, absPath, size }.
 *
 * @param {string} dir
 * @param {string} baseDir
 * @param {object[]} [acc]
 * @returns {Promise<{ relPath: string, absPath: string, size: number }[]>}
 */
async function collectFiles(dir, baseDir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip .agentskin-theme bundle directories
    if (entry.isDirectory() && entry.name.endsWith('.agentskin-theme')) {
      continue;
    }
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absPath, baseDir, acc);
    } else if (entry.isFile()) {
      const stat = await fs.stat(absPath);
      acc.push({
        relPath: path.relative(baseDir, absPath),
        absPath,
        size: stat.size,
      });
    }
  }
  return acc;
}

/**
 * Check whether a PNG file has an alpha channel by reading its IHDR color type.
 *
 * @param {string} absPath  Absolute path to the PNG file.
 * @returns {Promise<{ hasAlpha: boolean, colorType: number | null }>}
 */
export async function checkPngAlpha(absPath) {
  const fd = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(26);
    const { bytesRead } = await fd.read(buf, 0, 26, 0);
    if (bytesRead < 26) {
      return { hasAlpha: false, colorType: null };
    }
    // Verify PNG signature
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { hasAlpha: false, colorType: null };
    }
    const colorType = buf[IHDR_COLOR_TYPE_OFFSET];
    return { hasAlpha: ALPHA_COLOR_TYPES.has(colorType), colorType };
  } finally {
    await fd.close();
  }
}

/**
 * Validate manifest structure integrity.
 *
 * @param {object} manifest  Parsed manifest.json.
 * @param {string} themeId  Theme identifier.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateManifest(manifest, themeId) {
  const errors = [];
  const warnings = [];

  // Required fields
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      errors.push(`${themeId}: manifest missing required field "${field}"`);
    }
  }

  // schemaVersion must be 2
  if ('schemaVersion' in manifest && manifest.schemaVersion !== 2) {
    errors.push(`${themeId}: manifest.schemaVersion must be 2, got ${manifest.schemaVersion}`);
  }

  // colors.accent must be valid hex
  const accent = manifest?.colors?.accent;
  if (accent !== undefined) {
    if (typeof accent !== 'string' || !HEX_COLOR_REGEX.test(accent)) {
      errors.push(
        `${themeId}: colors.accent "${accent}" is not a valid hex color (#xxx or #xxxxxx)`,
      );
    }
  }

  // Warn if manifest has no targets
  if (!manifest?.targets || typeof manifest.targets !== 'object') {
    warnings.push(`${themeId}: manifest has no "targets" section`);
  }

  return { errors, warnings };
}

/**
 * Check CSS url() references resolve to existing files.
 *
 * @param {string} cssAbsPath  Absolute path to the CSS file.
 * @param {string} themeDir   Absolute path to the theme root.
 * @param {string} themeId    Theme identifier.
 * @returns {Promise<{ errors: string[] }>}
 */
export async function checkCssReferences(cssAbsPath, themeDir, themeId) {
  const errors = [];
  let cssContent;
  try {
    cssContent = await fs.readFile(cssAbsPath, 'utf8');
  } catch (e) {
    errors.push(`${themeId}: cannot read CSS file "${cssAbsPath}": ${e.message}`);
    return { errors };
  }

  const cssDir = path.dirname(cssAbsPath);
  CSS_URL_REGEX.lastIndex = 0;
  let match = CSS_URL_REGEX.exec(cssContent);
  while (match !== null) {
    const ref = match[1];
    // Skip data URIs, http(s) URLs, and absolute paths
    if (
      ref.startsWith('data:') ||
      ref.startsWith('http://') ||
      ref.startsWith('https://') ||
      path.isAbsolute(ref)
    ) {
      match = CSS_URL_REGEX.exec(cssContent);
      continue;
    }
    // Resolve relative to the CSS file's directory
    const resolved = path.resolve(cssDir, ref);
    // Verify the resolved path is within the theme directory (no path traversal)
    if (!resolved.startsWith(themeDir)) {
      errors.push(
        `${themeId}: CSS url() reference "${ref}" in ${path.relative(themeDir, cssAbsPath)} escapes theme directory`,
      );
      match = CSS_URL_REGEX.exec(cssContent);
      continue;
    }
    try {
      await fs.access(resolved);
    } catch {
      errors.push(
        `${themeId}: CSS url() reference "${ref}" in ${path.relative(themeDir, cssAbsPath)} does not resolve to an existing file`,
      );
    }
    match = CSS_URL_REGEX.exec(cssContent);
  }

  return { errors };
}

// --- Main validation function ---

/**
 * Validate a theme package against quality gate criteria.
 *
 * @param {string} themeDir       Absolute path to the theme directory.
 * @param {object} [options]
 * @param {'builtin'|'community'|'imported'} [options.source]  Override theme source detection.
 * @param {boolean} [options.skipPngAlpha]        Skip PNG alpha channel checks.
 * @param {boolean} [options.skipPayloadBudget]   Skip payload budget check.
 * @param {boolean} [options.skipCssReferences]   Skip CSS url() reference integrity check.
 * @param {boolean} [options.skipManifest]        Skip manifest structure check.
 * @param {number}  [options.payloadBudgetBytes]  Override payload budget (bytes).
 * @returns {Promise<{ themeId: string, source: string, pass: boolean, errors: string[], warnings: string[], stats: { totalSizeBytes: number, imageCount: number, cssFileCount: number } }>}
 */
export async function validateThemePackage(themeDir, options = {}) {
  const {
    source: sourceOverride,
    skipPngAlpha = false,
    skipPayloadBudget = false,
    skipCssReferences = false,
    skipManifest = false,
    payloadBudgetBytes,
  } = options;

  const errors = [];
  const warnings = [];
  const themeId = path.basename(themeDir);

  // --- Read manifest ---
  let manifest;
  const manifestPath = path.join(themeDir, 'manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (e) {
    return {
      themeId,
      source: 'imported',
      pass: false,
      errors: [`${themeId}: cannot read/parse manifest.json: ${e.message}`],
      warnings: [],
      stats: { totalSizeBytes: 0, imageCount: 0, cssFileCount: 0 },
    };
  }

  // --- Detect source ---
  const source = sourceOverride ?? detectThemeSource(themeDir, manifest);

  // --- Manifest structure check ---
  if (!skipManifest) {
    const { errors: manifestErrors, warnings: manifestWarnings } = validateManifest(
      manifest,
      themeId,
    );
    errors.push(...manifestErrors);
    warnings.push(...manifestWarnings);
  }

  // --- Collect all files ---
  const files = await collectFiles(themeDir, themeDir);
  const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

  // --- Stats ---
  const imageFiles = files.filter((f) => /\.(png|jpg|jpeg|webp|gif|avif)$/i.test(f.relPath));
  const cssFiles = files.filter((f) => f.relPath.endsWith('.css'));

  // --- Payload budget check ---
  if (!skipPayloadBudget) {
    const budget = payloadBudgetBytes ?? PAYLOAD_BUDGET[source];
    if (totalSizeBytes > budget) {
      errors.push(
        `${themeId}: payload ${formatBytes(totalSizeBytes)} exceeds ${source} budget of ${formatBytes(budget)}`,
      );
    }
  }

  // --- PNG alpha channel check ---
  if (!skipPngAlpha) {
    const _pngImagesDir = path.join(themeDir, 'assets', 'images');
    const pngFiles = files.filter(
      (f) =>
        f.relPath.startsWith(`assets${path.sep}images${path.sep}`) &&
        f.relPath.toLowerCase().endsWith('.png'),
    );
    for (const pngFile of pngFiles) {
      const { hasAlpha, colorType } = await checkPngAlpha(pngFile.absPath);
      if (colorType !== null && !hasAlpha) {
        warnings.push(
          `${themeId}: PNG "${pngFile.relPath}" has no alpha channel (color type ${colorType})`,
        );
      }
    }
  }

  // --- CSS url() reference integrity check ---
  if (!skipCssReferences) {
    for (const cssFile of cssFiles) {
      const { errors: cssErrors } = await checkCssReferences(cssFile.absPath, themeDir, themeId);
      errors.push(...cssErrors);
    }
  }

  return {
    themeId,
    source,
    pass: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalSizeBytes,
      imageCount: imageFiles.length,
      cssFileCount: cssFiles.length,
    },
  };
}

// --- Helpers ---

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --- CLI entry point ---

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const targetArg = args.find((a) => !a.startsWith('--'));

  if (!targetArg) {
    console.error('Usage: node scripts/validate-theme-package.mjs <theme-dir> [--json]');
    console.error('');
    console.error('Validates a theme package against quality gate criteria:');
    console.error('  1. PNG alpha channel detection');
    console.error('  2. Payload budget (builtin 50MB, community/imported 20MB)');
    console.error('  3. CSS url() reference integrity');
    console.error('  4. Manifest structure integrity');
    process.exit(2);
  }

  const themeDir = path.resolve(targetArg);

  let stat;
  try {
    stat = await fs.stat(themeDir);
  } catch {
    console.error(`Error: directory not found: ${themeDir}`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    console.error(`Error: not a directory: ${themeDir}`);
    process.exit(2);
  }

  const result = await validateThemePackage(themeDir);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Theme: ${result.themeId} (${result.source})`);
    console.log(
      `Stats: ${formatBytes(result.stats.totalSizeBytes)}, ${result.stats.imageCount} images, ${result.stats.cssFileCount} CSS files`,
    );
    console.log('');

    if (result.warnings.length > 0) {
      console.log(`Warnings (${result.warnings.length}):`);
      for (const w of result.warnings) console.log(`  ⚠ ${w}`);
      console.log('');
    }

    if (result.errors.length > 0) {
      console.log(`Errors (${result.errors.length}):`);
      for (const e of result.errors) console.log(`  ✗ ${e}`);
      console.log('');
    }

    if (result.pass) {
      console.log(`✓ ${result.themeId}: PASS`);
    } else {
      console.log(`✗ ${result.themeId}: FAIL (${result.errors.length} error(s))`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

// Run CLI only when executed directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`validate-theme-package: unexpected error: ${e.stack ?? e}`);
    process.exit(1);
  });
}
