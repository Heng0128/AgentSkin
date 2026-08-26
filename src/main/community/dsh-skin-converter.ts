// SPDX-License-Identifier: MPL-2.0

/**
 * # DSH Skin Converter
 *
 * Converts a DSH (DreamShell) skin repository into an AgentSkin-compatible
 * theme package. DSH skins use CSS custom properties (`--dsw-alias-*`) for
 * theming; this converter extracts those variables, maps them to AgentSkin's
 * 14-token system, and assembles a complete theme manifest with hero assets.
 *
 * ## Conversion Pipeline
 *
 *   1. Locate and parse the primary CSS file (`maid-atelier.module.css`).
 *   2. Extract `--dsw-alias-*` semantic variables.
 *   3. Map extracted variables to AgentSkin's 14-token palette.
 *   4. Derive missing tokens (code, input, button, focus) via brightness
 *      adjustment and contrast calculation.
 *   5. Locate character hero images in `public/images/`.
 *   6. Generate v1 `.agentskin-theme` package JSON + icon thumbnail.
 *
 * ## Output Format
 *
 * Outputs a v1 `.agentskin-theme` JSON string (consistent with
 * community-theme-converter.ts), with the hero image embedded as base64.
 * Files are also written to the configured output directory for disk-based
 * consumption.
 *
 * ## DSH Variable Mapping
 *
 * | DSH `--dsw-alias-*`          | AgentSkin token        | Derivation                        |
 * |------------------------------|------------------------|-----------------------------------|
 * | accent                       | accent                 | Direct                            |
 * | accent-secondary             | secondary              | Direct                            |
 * | background                   | background             | Direct                            |
 * | surface                      | surface                | Direct                            |
 * | surface-elevated             | surfaceElevated        | Direct                            |
 * | text                         | foreground             | Direct                            |
 * | text-muted                   | muted                  | Direct                            |
 * | border                       | border                 | Direct                            |
 * | —                            | codeBackground         | surface ± brightness              |
 * | —                            | codeForeground         | foreground (passthrough)          |
 * | —                            | inputBackground        | surface (passthrough)             |
 * | —                            | buttonBackground       | accent (passthrough)              |
 * | —                            | buttonForeground       | contrast color of accent          |
 * | —                            | focusRing              | color-mix(accent 40%, transparent)|
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mainError } from '../logger';
import type { AgentSkinTokenKey, AgentSkinTokens } from './shared-color-utils';
import { adjustBrightness, getContrastColor, hexToRgb, wcagLuminance } from './shared-color-utils';
import { normalizeTitle } from './shared-utils';

// Re-exports for consumers that import these types from this module.
export type { AgentSkinTokenKey, AgentSkinTokens } from './shared-color-utils';
export { AGENTSKIN_TOKEN_KEYS } from './shared-color-utils';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Normalized DSH variable → AgentSkin token mapping.
 * Only the 8 direct mappings; the remaining 6 are derived.
 */
const DSH_TO_AGENTSKIN_MAP: Record<string, string> = {
  'dsw-alias-accent': 'accent',
  'dsw-alias-accent-secondary': 'secondary',
  'dsw-alias-background': 'background',
  'dsw-alias-surface': 'surface',
  'dsw-alias-surface-elevated': 'surfaceElevated',
  'dsw-alias-text': 'foreground',
  'dsw-alias-text-muted': 'muted',
  'dsw-alias-border': 'border',
};

/** Brightness adjustment (±RGB units) for derived code background. */
const CODE_BG_BRIGHTNESS_SHIFT = 2;

/** Focus ring opacity for color-mix (40% accent, 60% transparent). */
const FOCUS_RING_MIX_PERCENT = 40;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options for DSH skin conversion. */
export interface DshConvertOptions {
  /** Override theme id (derived from repo name by default). */
  themeId?: string;
  /** Override display name (derived from repo name by default). */
  displayName?: string;
  /** Theme version (defaults to "1.0.0"). */
  version?: string;
  /** Author name (defaults to "DSH Community"). */
  author?: string;
  /** Category for the theme. */
  category?: string;
  /**
   * Output directory for generated files.
   * Defaults to `<tmpdir>/agentskin-dsh/<themeId>`.
   */
  outputDir?: string;
}

/** Result of a successful DSH skin conversion. */
export interface DshConvertedTheme {
  /** AgentSkin theme id (prefixed with "dsh-"). */
  themeId: string;
  /**
   * v1 `.agentskin-theme` package JSON string — ready for
   * `ThemeLibrary.installFile` after being written to disk.
   */
  manifestJson: string;
  /** 14-token color palette. */
  colors: AgentSkinTokens;
  /** Absolute path to the output directory. */
  outputDir: string;
}

// ---------------------------------------------------------------------------
// CSS Parsing
// ---------------------------------------------------------------------------

/**
 * Extract CSS custom properties from a string.
 *
 * Parses all `--var-name: value;` declarations, stripping whitespace and
 * trailing semicolons. Returns a map of variable name → value.
 *
 * @param cssContent - Raw CSS text.
 * @returns Map of CSS variable names to their values.
 */
export function parseCssVariables(cssContent: string): Map<string, string> {
  const variables = new Map<string, string>();
  const regex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null = regex.exec(cssContent);

  while (match !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    variables.set(name, value);
    match = regex.exec(cssContent);
  }

  return variables;
}

/**
 * Resolve CSS variable references (`var(--name)`) in a value string.
 *
 * Performs a single pass of substitution using the provided variable map.
 * Nested `var()` fallbacks are not supported (DSH does not use them).
 *
 * @param value - CSS value potentially containing `var(--name)`.
 * @param variables - Map of known CSS variables.
 * @returns Resolved value with references substituted.
 */
function resolveVarReferences(value: string, variables: Map<string, string>): string {
  return value.replace(/var\((--[a-zA-Z0-9_-]+)\)/g, (_full, varName: string) => {
    return variables.get(varName) ?? '';
  });
}

// ---------------------------------------------------------------------------
// DSH Discovery
// ---------------------------------------------------------------------------

/**
 * Locate the primary CSS file in a DSH skin repository.
 *
 * Searches in order:
 *   1. `src/styles/maid-atelier.module.css` (primary skin CSS)
 *   2. `src/styles/globals.css` (fallback)
 *   3. Any `.module.css` file in `src/styles/`
 *
 * @param repoRoot - Absolute path to the DSH skin repository root.
 * @returns Absolute path to the CSS file.
 * @throws Error if no CSS file is found.
 */
function locatePrimaryCss(repoRoot: string): string {
  const candidates = [
    path.join(repoRoot, 'src', 'styles', 'maid-atelier.module.css'),
    path.join(repoRoot, 'src', 'styles', 'globals.css'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Fallback: find any .module.css in src/styles/
  const stylesDir = path.join(repoRoot, 'src', 'styles');
  if (fs.existsSync(stylesDir) && fs.statSync(stylesDir).isDirectory()) {
    const entries = fs.readdirSync(stylesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.module.css')) {
        return path.join(stylesDir, entry.name);
      }
    }
  }

  throw new Error(
    `No DSH skin CSS file found in ${repoRoot} (expected src/styles/maid-atelier.module.css or similar)`,
  );
}

/**
 * Locate character hero images in the DSH skin repository.
 *
 * Searches `public/images/` for files matching `character-*.webp`.
 *
 * @param repoRoot - Absolute path to the DSH skin repository root.
 * @returns Array of absolute paths to character images (sorted by name).
 */
function locateHeroImages(repoRoot: string): string[] {
  const imagesDir = path.join(repoRoot, 'public', 'images');
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
  const heroes: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('character-') && entry.name.endsWith('.webp')) {
      heroes.push(path.join(imagesDir, entry.name));
    }
  }

  return heroes.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

// ---------------------------------------------------------------------------
// Mode Detection
// ---------------------------------------------------------------------------

/**
 * Detect the theme mode (light/dark) from CSS background luminance.
 *
 * Uses the resolved `--dsw-alias-background` value to determine if the theme
 * is light or dark. Falls back to `dark` if detection fails.
 *
 * @param backgroundValue - Resolved CSS value for the background variable.
 * @returns `'light'` or `'dark'`.
 */
function detectMode(backgroundValue: string): 'light' | 'dark' {
  const rgb = hexToRgb(backgroundValue);
  if (!rgb) return 'dark';

  const luminance = wcagLuminance(rgb.r, rgb.g, rgb.b);
  return luminance > 0.5 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Core Conversion
// ---------------------------------------------------------------------------

/**
 * Parse DSH CSS variables and map them to AgentSkin's 14-token system.
 *
 * Extracts `--dsw-alias-*` variables, resolves any `var()` references,
 * and derives the 6 missing tokens (codeBackground, codeForeground,
 * inputBackground, buttonBackground, buttonForeground, focusRing).
 *
 * @param cssContent - Raw CSS text from the DSH skin.
 * @returns A complete `AgentSkinTokens` map with all 14 keys populated.
 */
export function parseDSSH(cssContent: string): AgentSkinTokens {
  const rawVars = parseCssVariables(cssContent);

  // Build a resolved variable map (resolve var() references).
  const resolved = new Map<string, string>();
  for (const [name, value] of rawVars) {
    resolved.set(name, resolveVarReferences(value, rawVars));
  }

  // Extract the 8 direct mappings.
  const base: Partial<AgentSkinTokens> = {};
  for (const [dshKey, agentskinKey] of Object.entries(DSH_TO_AGENTSKIN_MAP)) {
    const value = resolved.get(dshKey);
    if (value && value.length > 0) {
      base[agentskinKey as AgentSkinTokenKey] = value;
    }
  }

  // Apply defaults for any missing direct mappings.
  const accent = base.accent ?? '#4f8cff';
  const secondary = base.secondary ?? '#7ba7d8';
  const background = base.background ?? '#f8fafc';
  const foreground = base.foreground ?? '#1f2937';
  const muted = base.muted ?? '#6b7280';
  const surface = base.surface ?? '#ffffff';
  const surfaceElevated = base.surfaceElevated ?? '#f8fafc';
  const border = base.border ?? '#e5e7eb';

  // Detect mode for derivation logic.
  const mode = detectMode(background);

  // Derive the remaining 6 tokens.
  return {
    accent,
    secondary,
    background,
    foreground,
    muted,
    surface,
    surfaceElevated,
    border,
    codeBackground: adjustBrightness(
      surface,
      mode === 'dark' ? -CODE_BG_BRIGHTNESS_SHIFT : CODE_BG_BRIGHTNESS_SHIFT,
    ),
    codeForeground: foreground,
    inputBackground: surface,
    buttonBackground: accent,
    buttonForeground: getContrastColor(accent),
    focusRing: `color-mix(in srgb, ${accent} ${FOCUS_RING_MIX_PERCENT}%, transparent)`,
  };
}

// ---------------------------------------------------------------------------
// CSS Generation
// ---------------------------------------------------------------------------

/**
 * Generate a CSS custom property block from the 14-token palette.
 *
 * Produces a `:root` selector with all 14 tokens as `--agentskin-*`
 * custom properties. This CSS is embedded in each agent target of the
 * v1 `.agentskin-theme` package.
 *
 * @param colors - The 14-token color palette.
 * @returns CSS string with custom property declarations.
 */
function generateAgentCss(colors: AgentSkinTokens): string {
  return `:root {
  --agentskin-accent: ${colors.accent};
  --agentskin-secondary: ${colors.secondary};
  --agentskin-background: ${colors.background};
  --agentskin-foreground: ${colors.foreground};
  --agentskin-muted: ${colors.muted};
  --agentskin-surface: ${colors.surface};
  --agentskin-surface-elevated: ${colors.surfaceElevated};
  --agentskin-border: ${colors.border};
  --agentskin-code-background: ${colors.codeBackground};
  --agentskin-code-foreground: ${colors.codeForeground};
  --agentskin-input-background: ${colors.inputBackground};
  --agentskin-button-background: ${colors.buttonBackground};
  --agentskin-button-foreground: ${colors.buttonForeground};
  --agentskin-focus-ring: ${colors.focusRing};
}`;
}

// ---------------------------------------------------------------------------
// MIME helper
// ---------------------------------------------------------------------------

/**
 * MIME type for a given image extension (whitelist-aligned with the engine).
 */
function mimeTypeForExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

// ---------------------------------------------------------------------------
// Icon Generation
// ---------------------------------------------------------------------------

/**
 * Generate a simple SVG icon for the theme.
 *
 * Creates a minimal 256x256 SVG with the theme's accent color as a
 * background and a simplified window/monitor shape in the foreground.
 * The SVG is saved as `icon.svg` alongside the manifest.
 *
 * @param themeDir - Absolute path to the theme output directory.
 * @param colors - The 14-token color palette.
 * @returns Absolute path to the generated icon, or `null` on failure.
 */
function generateIcon(themeDir: string, colors: AgentSkinTokens): string | null {
  const iconPath = path.join(themeDir, 'icon.svg');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="32" fill="${colors.background}"/>
  <rect x="32" y="48" width="192" height="144" rx="8" fill="${colors.surface}" stroke="${colors.border}" stroke-width="2"/>
  <rect x="32" y="48" width="192" height="24" rx="8" fill="${colors.surfaceElevated}"/>
  <circle cx="48" cy="60" r="4" fill="${colors.accent}" opacity="0.6"/>
  <circle cx="62" cy="60" r="4" fill="${colors.accent}" opacity="0.4"/>
  <circle cx="76" cy="60" r="4" fill="${colors.accent}" opacity="0.2"/>
  <rect x="48" y="88" width="80" height="8" rx="4" fill="${colors.foreground}" opacity="0.8"/>
  <rect x="48" y="104" width="120" height="6" rx="3" fill="${colors.muted}" opacity="0.6"/>
  <rect x="48" y="116" width="100" height="6" rx="3" fill="${colors.muted}" opacity="0.4"/>
  <rect x="48" y="140" width="64" height="24" rx="4" fill="${colors.accent}" opacity="0.15"/>
  <rect x="48" y="140" width="64" height="24" rx="4" fill="none" stroke="${colors.accent}" stroke-width="1" opacity="0.5"/>
</svg>`;

  try {
    fs.writeFileSync(iconPath, svg, { encoding: 'utf-8' });
    return iconPath;
  } catch (err) {
    mainError('dsh-converter', `Failed to generate icon: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convert Function
// ---------------------------------------------------------------------------

/**
 * Convert a DSH skin repository into an AgentSkin theme package.
 *
 * The repo is expected to follow the DSH skin structure:
 * ```
 * dsh-skin-repo/
 * ├── src/styles/maid-atelier.module.css
 * ├── public/images/character-*.webp
 * └── package.json
 * ```
 *
 * The function creates a theme directory, writes `manifest.json`, copies
 * the hero image, and generates an icon. The returned `manifestJson` follows
 * the v1 `.agentskin-theme` format (consistent with community-theme-converter.ts).
 *
 * @param repoRoot - Absolute path to the DSH skin repository root.
 * @param options - Optional overrides for theme metadata.
 * @returns Conversion result with manifest, colors, and output directory.
 * @throws Error if the repo structure is invalid or CSS parsing fails.
 */
export function convertDSHSkin(
  repoRoot: string,
  options: DshConvertOptions = {},
): DshConvertedTheme {
  // 1. Validate repo root.
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    throw new Error(`DSH skin repository root does not exist or is not a directory: ${repoRoot}`);
  }

  // 2. Locate and read the primary CSS file.
  const cssPath = locatePrimaryCss(repoRoot);
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // 3. Parse DSH variables → 14-token palette.
  const colors = parseDSSH(cssContent);

  // 4. Derive theme id and display name.
  const repoName = path.basename(repoRoot);
  const themeId = options.themeId ?? `dsh-${normalizeTitle(repoName, 'dsh-skin')}`;
  const displayName = options.displayName ?? repoName;
  const version = options.version ?? '1.0.0';
  const author = options.author ?? 'DSH Community';
  const category = options.category ?? 'creative';

  // 5. Locate hero images.
  const heroImages = locateHeroImages(repoRoot);
  const heroImagePath = heroImages.length > 0 ? heroImages[0] : null;

  // 6. Create theme output directory.
  const themeDir = options.outputDir ?? path.join(os.tmpdir(), 'agentskin-dsh', themeId);
  fs.mkdirSync(themeDir, { recursive: true });

  // 7. Copy hero image if found (with error protection + cleanup).
  let heroExt = '';
  let heroBase64: string | null = null;
  if (heroImagePath) {
    heroExt = path.extname(heroImagePath);
    const heroFileName = `hero${heroExt}`;
    const destHeroPath = path.join(themeDir, 'assets', heroFileName);
    fs.mkdirSync(path.join(themeDir, 'assets'), { recursive: true });
    try {
      fs.copyFileSync(heroImagePath, destHeroPath);
      heroBase64 = fs.readFileSync(heroImagePath).toString('base64');
    } catch (err) {
      // Clean up the created themeDir to avoid partial output.
      fs.rmSync(themeDir, { recursive: true, force: true });
      throw new Error(
        `Failed to copy hero image from ${heroImagePath} to ${destHeroPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 8. Generate icon.
  generateIcon(themeDir, colors);

  // 9. Build v1 `.agentskin-theme` package (consistent with community-theme-converter.ts).
  const generatedCss = generateAgentCss(colors);
  const themePackage = {
    format: 'agentskin-theme',
    schemaVersion: 1 as const,
    theme: {
      id: themeId,
      displayName,
      version,
      author,
      catalog: {
        categories: [category],
        name: {
          en: displayName,
          zh: displayName,
        },
      },
      colors: {
        accent: colors.accent,
        secondary: colors.secondary,
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        surface: colors.surface,
      },
    },
    targets: {
      traework: { css: generatedCss },
      qoderwork: { css: generatedCss },
      workbuddy: { css: generatedCss },
      doubao: { css: generatedCss },
      codex: { css: generatedCss },
      zcode: { css: generatedCss },
    },
    assets: {
      images: {
        hero: heroBase64
          ? {
              filename: `hero${heroExt}`,
              mimeType: mimeTypeForExt(heroExt),
              base64: heroBase64,
            }
          : null,
      },
    },
  };

  // 10. Write manifest.json.
  const manifestPath = path.join(themeDir, 'manifest.json');
  const manifestJson = JSON.stringify(themePackage, null, 2);
  fs.writeFileSync(manifestPath, manifestJson, { encoding: 'utf-8' });

  return {
    themeId,
    manifestJson,
    colors,
    outputDir: themeDir,
  };
}
