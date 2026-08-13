// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeInstaller (P3.1)
 *
 * Bridges directory-based ThemePackages into the existing ThemeLibrary pipeline.
 *
 * For each InstalledThemePackage, the installer:
 * 1. Reads the manifest and icon/preview assets
 * 2. Reads per-agent CSS files (v2) or generates a default CSS (v1 fallback)
 * 3. Maps each AgentId to its @agentskin/engine adapter id (coreId) so the
 *    resulting bundle's `targets` keys are engine-compatible with the
 *    adapter ids @agentskin/engine understands
 * 4. Carries rich v2 metadata (author, category, tags, license, mode,
 *    supportedAgents, colors) in `theme.copy` — the engine-safe free-form
 *    record — so it survives the round-trip into InstalledTheme → catalog → UI
 * 5. Installs the bundle into ThemeLibrary
 *
 * This keeps the UI and catalog layers untouched — the installer produces
 * the same InstalledTheme objects the rest of the app already understands.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { activeAdapterIds, getAdapter } from '../../adapters/registry';
import { engineThemeExtension } from '../../legacy/agentskin-core-runtime';
import type { InstalledTheme } from '../../shared/types';
import { AGENT_IDS } from '../../shared/types';
import { mainErrorFromCatch } from '../logger';
import type { ThemeLibraryApi } from '../services/contracts';
import { getSupportedAgents, isV2Manifest, type ThemeManifest } from './theme-manifest';
import type { InstalledThemePackage } from './theme-package-loader';

/**
 * Fallback agent id list when neither the manifest nor active adapters
 * enumerate any. Sourced from the single AGENT_IDS definition in
 * shared/types so it never drifts when new agents are registered.
 */
const FALLBACK_AGENT_IDS = AGENT_IDS as readonly string[];

/**
 * Current app version for minAppVersion compatibility checks. Read from
 * Electron's app.getVersion() at call time so it always matches package.json
 * (previously hard-coded to '2.1.34' and drifted far behind reality).
 */
function currentAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // app may be unavailable in unit tests
    return '0.0.0';
  }
}

/**
 * Compare two semver strings. Returns true if `actual >= required`.
 *
 * P1 audit #19: the previous implementation did `split('.').map(Number)`,
 * which silently dropped prerelease suffixes via `Number('0-beta.1') → NaN →
 * 0`. That made `1.0.0-beta.1` compare equal to `1.0.0`, so a prerelease
 * version would satisfy a `minAppVersion: "1.0.0"` requirement even though
 * semver spec says prereleases are *lower* than their release counterpart.
 *
 * Now follows the semver precedence rules:
 *   - Parse major.minor.patch + optional prerelease tag.
 *   - Compare numeric major/minor/patch first.
 *   - If equal, a version WITH a prerelease tag is lower than one without
 *     (e.g. `1.0.0-beta.1` < `1.0.0`).
 *   - If both have prerelease tags, compare them per semver §11
 *     (identifier-by-identifier: numeric < alphanumeric; shorter < longer
 *     when all preceding identifiers are equal).
 *
 * Non-semver strings (no dots, empty, etc.) fall back to the legacy
 * numeric-split comparison so we never regress on inputs the old code
 * accepted.
 */
function semverGte(actual: string, required: string): boolean {
  return compareSemver(actual, required) >= 0;
}

/** Parse a semver string into { major, minor, patch, prerelease: string[] }.
 *  Returns null if the string doesn't look like semver (no dot-separated
 *  numeric core).
 *
 * Exported for unit testing the documented precedence rules (see
 * `compareSemver`) without re-implementing the parser in a test harness. */
export function parseSemver(v: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
} | null {
  // Strip leading 'v' or whitespace.
  const cleaned = v.trim().replace(/^v/i, '');
  // Capture major.minor.patch and optional -prerelease.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compare two semver strings. Returns >0 if a>b, 0 if equal, <0 if a<b.
 *  Falls back to legacy numeric-split comparison if either input is not
 *  parseable semver, so we never regress on inputs the old code accepted.
 *
 * Exported for unit testing the documented prerelease precedence rules. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  // Legacy fallback: if either side isn't valid semver, use the old
  // split-and-map-Number comparison so we don't reject inputs that
  // previously worked (e.g. "5", "1.2").
  if (!pa || !pb) {
    const na = a.split('.').map(Number);
    const nb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((na[i] || 0) > (nb[i] || 0)) return 1;
      if ((na[i] || 0) < (nb[i] || 0)) return -1;
    }
    return 0;
  }
  // Compare major.minor.patch numerically.
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // Equal core versions — prerelease precedence per semver §11:
  //   - A version WITHOUT prerelease is GREATER than one WITH prerelease.
  //   - If both have prereleases, compare identifier-by-identifier.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1; // a is release, b is prerelease → a > b
  if (pb.prerelease.length === 0) return -1; // a is prerelease, b is release → a < b
  // Both have prereleases — compare identifier by identifier.
  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum !== bNum) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return aNum ? -1 : 1;
    } else {
      // Both alphanumeric — compare lexically.
      if (ai !== bi) return ai < bi ? -1 : 1;
    }
  }
  // All preceding identifiers equal — the longer prerelease wins (is greater).
  return pa.prerelease.length - pb.prerelease.length;
}

/** An image asset ready to be embedded into a theme bundle. */
interface EmbeddedImage {
  filename: string;
  mimeType: string;
  base64: string;
}

/**
 * Inline @import rules that reference shared base CSS files from
 * themes/_shared/. This lets theme packages keep only their palette
 * (variable definitions) in their per-agent CSS and @import the shared
 * structural rules, so a selector fix in one base file benefits all themes
 * without editing each theme's CSS individually.
 *
 * Only imports resolving into a `_shared/` directory and ending in
 * `.base.css` are inlined; all other @import rules are left untouched.
 * The resolved path must stay within the themes/ root (two levels above the
 * theme package) to prevent path traversal.
 */
async function inlineCssImports(css: string, cssPath: string): Promise<string> {
  const importRe = /@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?\s*;/g;
  const parts: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = importRe.exec(css)) !== null) {
    parts.push(css.slice(last, match.index));
    const importUrl = match[1];
    if (importUrl.includes('_shared/') && importUrl.endsWith('.base.css')) {
      const resolved = path.resolve(path.dirname(cssPath), importUrl);
      const themesRoot = path.resolve(path.dirname(cssPath), '..', '..');
      if (resolved.startsWith(themesRoot) && resolved.endsWith('.base.css')) {
        try {
          parts.push(await fs.readFile(resolved, 'utf8'));
        } catch {
          parts.push(match[0]); // base missing — leave import (no-op at runtime)
        }
      } else {
        parts.push(match[0]);
      }
    } else {
      parts.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  parts.push(css.slice(last));
  return parts.join('');
}

/** Read a CSS file and inline any _shared/*.base.css @import rules. */
async function readCssWithImports(cssPath: string): Promise<string> {
  const raw = await fs.readFile(cssPath, 'utf8');
  return inlineCssImports(raw, cssPath);
}

/**
 * Generate a minimal fallback CSS from manifest colors. Used when a theme
 * package ships no per-agent CSS files at all.
 */
function generateFallbackCss(manifest: ThemeManifest): string {
  const colors = manifest.colors;
  // Support both v1 (primary/text) and v2 (accent/foreground) naming.
  const accent = colors.accent || colors.primary || '#000000';
  const bg = colors.background || '#ffffff';
  const surface = colors.surface || '#f0f0f0';
  const text = colors.foreground || colors.text || '#000000';
  const border = colors.border || '#e0e0e0';
  const codeBg = colors.codeBackground || '#f5f5f5';
  const codeFg = colors.codeForeground || '#333333';

  return `:root {
  --agentskin-accent: ${accent};
  --agentskin-bg: ${bg};
  --agentskin-surface: ${surface};
  --agentskin-text: ${text};
  --agentskin-border: ${border};
  --agentskin-code-bg: ${codeBg};
  --agentskin-code-fg: ${codeFg};
}
body {
  background: ${bg} !important;
}
::selection { background: ${accent}55; }
a, .accent { color: ${accent}; }
`;
}

/**
 * Resolve per-agent CSS chunks exactly as {@link ThemeInstaller#buildBundle}
 * would build them. This single source of truth ensures the content hash
 * computed by {@link computeThemeContentHash} matches the hash stored inside
 * the built bundle, so theme content updates (including @import-inlined CSS
 * or generated fallback CSS) don't trigger false re-installs at every boot.
 *
 * P1#11: previously computeThemeContentHash used raw `fs.readFile` without
 * inlining @import, and skipped agents without CSS files instead of using
 * the color-based fallback generator. This caused a permanent mismatch
 * between the persisted contentHash and the freshly-computed one for any
 * theme that relies on @import _shared/*.base.css or has no per-agent CSS.
 */
async function resolvePerAgentCssChunks(
  manifest: ThemeManifest,
  packagePath: string,
  schemeId?: string,
): Promise<string[]> {
  const chunks: string[] = [];
  const seenCoreIds = new Set<string>();

  const agentIds = getSupportedAgents(manifest);
  const effectiveAgentIds = agentIds.length
    ? agentIds
    : activeAdapterIds().length
      ? activeAdapterIds()
      : FALLBACK_AGENT_IDS;

  for (const agentId of effectiveAgentIds) {
    const adapter = getAdapter(agentId);
    const coreId = adapter?.coreId || agentId;
    if (!coreId || seenCoreIds.has(coreId)) continue;
    seenCoreIds.add(coreId);

    let cssPath: string | null = null;
    if (isV2Manifest(manifest) && manifest.targets && manifest.targets[agentId]) {
      // Alternative schemes live at assets/css/<schemeId>/<basename>; the
      // default scheme keeps the manifest-referenced path.
      cssPath = schemeId
        ? path.join(
            packagePath,
            'assets',
            'css',
            schemeId,
            path.basename(manifest.targets[agentId].css),
          )
        : path.join(packagePath, manifest.targets[agentId].css);
    } else {
      const candidate = path.join(
        packagePath,
        'assets',
        'css',
        ...(schemeId ? [schemeId] : []),
        `${agentId}.css`,
      );
      try {
        await fs.access(candidate);
        cssPath = candidate;
      } catch {
        cssPath = null;
      }
    }

    const css = cssPath ? await readCssWithImports(cssPath) : generateFallbackCss(manifest);
    chunks.push(css);
  }

  return chunks;
}

/**
 * Resolve a theme's color-scheme list. The implicit 'default' scheme (the
 * manifest's own colors) always comes first, followed by each declared
 * `colorSchemes` id resolved from color-schemes/<id>.json. Missing or
 * malformed scheme files throw — the loader validates them at scan time, but
 * install-time reads are defensive against a stale working tree.
 */
async function resolveColorSchemes(
  manifest: ThemeManifest,
  packagePath: string,
): Promise<
  Array<{ id: string; name: string; mode?: ThemeManifest['mode']; colors: ThemeManifest['colors'] }>
> {
  const schemes: Array<{
    id: string;
    name: string;
    mode?: ThemeManifest['mode'];
    colors: ThemeManifest['colors'];
  }> = [{ id: 'default', name: 'Default', mode: manifest.mode, colors: manifest.colors }];
  for (const schemeId of manifest.colorSchemes ?? []) {
    const raw = await fs.readFile(
      path.join(packagePath, 'color-schemes', `${schemeId}.json`),
      'utf8',
    );
    const scheme = JSON.parse(raw) as {
      name?: unknown;
      mode?: unknown;
      colors?: Record<string, unknown>;
    };
    const colors = scheme.colors as unknown as ThemeManifest['colors'];
    const mode =
      scheme.mode === 'light' || scheme.mode === 'dark' || scheme.mode === 'auto'
        ? scheme.mode
        : manifest.mode;
    schemes.push({
      id: schemeId,
      name: typeof scheme.name === 'string' && scheme.name ? scheme.name : schemeId,
      mode,
      colors,
    });
  }
  return schemes;
}

/**
 * Compute a short content hash over ALL color-scheme variants of a theme
 * (default + each declared scheme). Used by the seeder to detect content
 * changes — including adding/removing/editing a scheme — without relying on
 * version bumps.
 *
 * P1#11: delegates to {@link resolvePerAgentCssChunks} so the hash algorithm
 * is byte-for-byte identical to what buildBundle uses — including inlined
 * @import _shared/*.base.css and the colors-based fallback generator.
 */
export async function computeThemeContentHash(
  manifest: ThemeManifest,
  packagePath: string,
): Promise<string> {
  const allChunks: string[] = [];
  const schemes = await resolveColorSchemes(manifest, packagePath);
  for (const scheme of schemes) {
    const chunks = await resolvePerAgentCssChunks(
      manifest,
      packagePath,
      scheme.id === 'default' ? undefined : scheme.id,
    );
    allChunks.push(...chunks);
  }
  return crypto.createHash('sha1').update(allChunks.join('\n\n')).digest('hex').slice(0, 16);
}

/**
 * Map a filename extension to an image MIME type. Mirrors the set accepted by
 * @agentskin/engine's package validator (png/jpeg/webp/gif); anything else is
 * reported as png so validation still passes for genuine PNGs with an odd
 * name, while genuinely unsupported formats fail the base64/mime checks
 * downstream rather than silently embedding a broken asset.
 */
function mimeTypeFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
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

/** Read an image file from a package directory into an embeddable asset. */
async function readImageAsset(packagePath: string, relativePath: string): Promise<EmbeddedImage> {
  const buffer = await fs.readFile(path.join(packagePath, relativePath));
  return {
    filename: path.basename(relativePath),
    mimeType: mimeTypeFor(relativePath),
    base64: buffer.toString('base64'),
  };
}

export class ThemeInstaller {
  constructor(
    private readonly library: ThemeLibraryApi,
    /** Optional callback invoked after each successful install. */
    private readonly onInstall?: (theme: InstalledTheme) => void,
  ) {}

  /**
   * Install a single directory-based theme package into the library.
   */
  async install(pkg: InstalledThemePackage, packageRoot?: string): Promise<InstalledTheme> {
    const { packagePath, manifest } = pkg;

    // v2.1: Check minimum app version requirement
    const appVersion = currentAppVersion();
    if (manifest.minAppVersion && !semverGte(appVersion, manifest.minAppVersion)) {
      throw new Error(
        `Theme "${manifest.id}" requires AgentSkin >= ${manifest.minAppVersion}, ` +
          `but current version is ${appVersion}`,
      );
    }

    // Read the icon and preview assets.
    const icon = await readImageAsset(packagePath, manifest.icon);
    const preview = await readImageAsset(packagePath, manifest.preview);

    // Hero artwork: the applied desktop background (exposed to the injected
    // CSS as --agentskin-art) and the catalog cover. Packages that ship no
    // dedicated artwork fall back to the preview screenshot.
    const hero = manifest.hero ? await readImageAsset(packagePath, manifest.hero) : preview;

    // Install one bundle per color scheme (default + each declared scheme).
    // Scheme variants are stored under `<themeId>--<schemeId>` ids; the
    // catalog merges them back into a single entry with a `schemes` list.
    const schemes = await resolveColorSchemes(manifest, packagePath);

    // Write temporary .agentskin-theme file in OS-temp
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-theme-'));

    try {
      let installed: InstalledTheme | undefined;
      for (const scheme of schemes) {
        const bundle = await this.buildBundle(
          manifest,
          { icon, preview, hero },
          packagePath,
          scheme,
          packageRoot,
        );
        const bundleThemeId = (bundle.theme as { id?: unknown }).id;
        if (typeof bundleThemeId !== 'string' || !bundleThemeId) {
          throw new Error(`Theme "${manifest.id}": bundle missing theme id`);
        }
        const tmpFile = path.join(tmpDir, `${bundleThemeId}${engineThemeExtension}`);
        await fs.writeFile(tmpFile, JSON.stringify(bundle), 'utf8');
        const result = await this.library.installFile(tmpFile);
        this.onInstall?.(result);
        if (scheme.id === 'default') installed = result;
      }
      if (!installed) throw new Error(`Theme "${manifest.id}": no scheme bundles installed`);
      return installed;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Build an agentskin-theme bundle from a directory-based manifest.
   * Handles both v1 (generate default CSS) and v2 (embed per-agent CSS) formats.
   *
   * `scheme` selects the color-scheme variant: the default scheme embeds the
   * manifest-referenced CSS under the plain `<id>` bundle id; alternative
   * schemes embed `assets/css/<schemeId>/<agent>.css` under `<id>--<schemeId>`.
   */
  private async buildBundle(
    manifest: ThemeManifest,
    images: { icon: EmbeddedImage; preview: EmbeddedImage; hero: EmbeddedImage },
    packagePath: string,
    scheme: {
      id: string;
      name: string;
      mode?: ThemeManifest['mode'];
      colors: ThemeManifest['colors'];
    },
    /** Directory-package root recorded for runtime wallpaper registration
     *  (pywal wallpaper-themes, bundle installs). Omitted for built-in
     *  themes installed by the seeder (they resolve against the app themes dir). */
    packageRoot?: string,
  ): Promise<Record<string, unknown>> {
    const targets: Record<string, { css: string; verification?: unknown }> = {};

    // Resolve the effective agent set: prefer the manifest's explicit
    // supportedAgents, else fall back to active adapters, else a hardcoded
    // baseline. This guarantees the bundle always has at least one target.
    const agentIds = getSupportedAgents(manifest);
    const effectiveAgentIds = agentIds.length
      ? agentIds
      : activeAdapterIds().length
        ? activeAdapterIds()
        : FALLBACK_AGENT_IDS;

    for (const agentId of effectiveAgentIds) {
      // Map AgentId → @agentskin/engine adapter id (coreId). Experimental
      // adapters have an empty coreId and are skipped (not skinnable yet).
      const adapter = getAdapter(agentId);
      const coreId = adapter?.coreId || agentId;
      if (!coreId || targets[coreId]) continue; // skip if coreId already has a target

      // Determine the CSS source for this agent. Alternative schemes live at
      // assets/css/<schemeId>/<basename>; the default scheme keeps the
      // manifest-referenced path.
      let cssPath: string | null = null;
      let verification: unknown;
      if (isV2Manifest(manifest) && manifest.targets && manifest.targets[agentId]) {
        cssPath =
          scheme.id === 'default'
            ? path.join(packagePath, manifest.targets[agentId].css)
            : path.join(
                packagePath,
                'assets',
                'css',
                scheme.id,
                path.basename(manifest.targets[agentId].css),
              );
        verification = manifest.targets[agentId].verification;
      } else {
        const candidate = path.join(
          packagePath,
          'assets',
          'css',
          ...(scheme.id === 'default' ? [] : [scheme.id]),
          `${agentId}.css`,
        );
        try {
          await fs.access(candidate);
          cssPath = candidate;
        } catch {
          cssPath = null;
        }
      }

      const css = cssPath ? await readCssWithImports(cssPath) : generateFallbackCss(manifest);

      targets[coreId] = { css, verification };
    }

    // Content hash over all CSS targets — detects content changes even when
    // the manifest version was not bumped. Stored in theme.copy.contentHash
    // so the seeder can decide whether a reseed is necessary.
    const contentHash = crypto
      .createHash('sha1')
      .update(
        Object.values(targets)
          .map((t) => t.css)
          .join('\n\n'),
      )
      .digest('hex')
      .slice(0, 16);

    // Collect v2 metadata into the engine-safe free-form `theme.copy` record.
    const author = manifest.author
      ? typeof manifest.author === 'string'
        ? manifest.author
        : manifest.author.name
      : undefined;

    // Every scheme bundle carries the theme's full scheme metadata so the
    // catalog can merge variants back into a single entry (the default entry
    // lists every scheme; each variant knows its own id via `scheme`).
    const schemesMeta = (await resolveColorSchemes(manifest, packagePath)).map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.mode ?? null,
    }));

    const copy: Record<string, unknown> = {
      tagline: manifest.description || null,
      supportedAgents: effectiveAgentIds,
      author: author ?? null,
      category: manifest.category ?? null,
      tags: manifest.tags ?? null,
      license: manifest.license ?? null,
      unofficial: manifest.unofficial ?? null,
      // Scheme-aware metadata: the mode/colors of THIS variant (not the whole
      // manifest), plus the scheme id so the catalog can merge variants back
      // into a single entry and the UI can label which colors are in use.
      mode: scheme.mode ?? manifest.mode ?? null,
      colors: scheme.colors ?? manifest.colors ?? null,
      scheme: scheme.id,
      colorSchemes: manifest.colorSchemes ?? null,
      schemes: schemesMeta,
      contentHash,
      // Flat / CSS-only themes declare art:false; consumers (seed-pipeline
      // test, catalog) use this to skip the --agentskin-art requirement.
      art: manifest.art !== false,
      // Directory-package root (absolute) so runtime wallpaper registration
      // can resolve theme.wallpaper.video outside the built-in themes dir.
      ...(packageRoot ? { packageRoot } : {}),
      // --- v2.1 extensions ---
      dynamic: manifest.dynamic ?? null,
      wallpaper: manifest.wallpaper ?? null,
      fonts: manifest.fonts ?? null,
      minAppVersion: manifest.minAppVersion ?? null,
      homepage: manifest.homepage ?? null,
      repository: manifest.repository ?? null,
    };

    return {
      // Engine-required format identifier — @agentskin/engine validates this
      // field; both 'agentskin-theme' and 'agentskin-theme' are accepted.
      format: 'agentskin-theme',
      // The engine only understands schemaVersion 1 for the on-disk bundle.
      // The directory manifest's v2 schema is a packaging-layer concept.
      schemaVersion: 1,
      theme: {
        id: scheme.id === 'default' ? manifest.id : `${manifest.id}--${scheme.id}`,
        displayName:
          scheme.id === 'default'
            ? manifest.displayName || manifest.name
            : `${manifest.displayName || manifest.name} · ${scheme.name}`,
        version: manifest.version,
        copy,
      },
      targets,
      assets: {
        images: {
          // Hero artwork: the engine converts it to an object URL and exposes
          // it to the injected CSS as --agentskin-art; the catalog also uses
          // it as the theme cover. Falls back to the preview when the package
          // ships no dedicated artwork.
          hero: images.hero,
          icon: images.icon,
          preview: images.preview,
        },
      },
    };
  }

  /**
   * Install all packages from a scan. Returns all installed themes.
   */
  async installAll(packages: InstalledThemePackage[]): Promise<InstalledTheme[]> {
    const results: InstalledTheme[] = [];
    for (const pkg of packages) {
      try {
        const installed = await this.install(pkg);
        results.push(installed);
      } catch (error) {
        mainErrorFromCatch('ThemeInstaller', error, `failed to install "${pkg.manifest.id}"`);
      }
    }
    return results;
  }
}
