// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeInstaller (P3.1)
 *
 * Bridges directory-based ThemePackages into the existing ThemeLibrary pipeline.
 *
 * For each InstalledThemePackage, the installer:
 * 1. Reads the manifest and icon/preview assets
 * 2. Reads per-agent CSS files (v2) or generates a default CSS (v1 fallback)
 * 3. Maps each AgentId to its @agentskin/core adapter id (coreId) so the
 *    resulting bundle's `targets` keys are engine-compatible with the
 *    adapter ids @agentskin/core understands
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
 */
function semverGte(actual: string, required: string): boolean {
  const a = actual.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (r[i] || 0)) return true;
    if ((a[i] || 0) < (r[i] || 0)) return false;
  }
  return true;
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
 * Compute a short content hash over all CSS files referenced by a manifest.
 * Used by the seeder to detect content changes without relying on version bumps.
 */
export async function computeThemeContentHash(
  manifest: ThemeManifest,
  packagePath: string,
): Promise<string> {
  const agentIds = getSupportedAgents(manifest);
  const effectiveAgentIds = agentIds.length
    ? agentIds
    : activeAdapterIds().length
      ? activeAdapterIds()
      : FALLBACK_AGENT_IDS;

  const cssChunks: string[] = [];
  for (const agentId of effectiveAgentIds) {
    let cssPath: string | null = null;
    if (isV2Manifest(manifest) && manifest.targets && manifest.targets[agentId]) {
      cssPath = path.join(packagePath, manifest.targets[agentId].css);
    } else {
      const candidate = path.join(packagePath, 'assets', 'css', `${agentId}.css`);
      try {
        await fs.access(candidate);
        cssPath = candidate;
      } catch {
        cssPath = null;
      }
    }
    if (cssPath) {
      try {
        cssChunks.push(await fs.readFile(cssPath, 'utf8'));
      } catch {
        // skip unreadable
      }
    }
  }
  return crypto.createHash('sha1').update(cssChunks.join('\n\n')).digest('hex').slice(0, 16);
}

/**
 * Map a filename extension to an image MIME type. Mirrors the set accepted by
 * @agentskin/core's package validator (png/jpeg/webp/gif); anything else is
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
  async install(pkg: InstalledThemePackage): Promise<InstalledTheme> {
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

    // Build bundle (v1 or v2) — async because per-agent CSS is read from disk.
    const bundle = await this.buildBundle(manifest, { icon, preview, hero }, packagePath);

    // Write temporary .agentskin-theme file in OS-temp
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-theme-'));
    const tmpFile = path.join(tmpDir, `${manifest.id}${engineThemeExtension}`);
    await fs.writeFile(tmpFile, JSON.stringify(bundle), 'utf8');

    try {
      const installed = await this.library.installFile(tmpFile);
      this.onInstall?.(installed);
      return installed;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Build an agentskin-theme bundle from a directory-based manifest.
   * Handles both v1 (generate default CSS) and v2 (embed per-agent CSS) formats.
   */
  private async buildBundle(
    manifest: ThemeManifest,
    images: { icon: EmbeddedImage; preview: EmbeddedImage; hero: EmbeddedImage },
    packagePath: string,
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
      // Map AgentId → @agentskin/core adapter id (coreId). Experimental
      // adapters have an empty coreId and are skipped (not skinnable yet).
      const adapter = getAdapter(agentId);
      const coreId = adapter?.coreId || agentId;
      if (!coreId || targets[coreId]) continue; // skip if coreId already has a target

      // Determine the CSS source for this agent.
      let cssPath: string | null = null;
      let verification: unknown;
      if (isV2Manifest(manifest) && manifest.targets && manifest.targets[agentId]) {
        cssPath = path.join(packagePath, manifest.targets[agentId].css);
        verification = manifest.targets[agentId].verification;
      } else {
        const candidate = path.join(packagePath, 'assets', 'css', `${agentId}.css`);
        try {
          await fs.access(candidate);
          cssPath = candidate;
        } catch {
          cssPath = null;
        }
      }

      const css = cssPath ? await readCssWithImports(cssPath) : this.generateFallbackCSS(manifest);

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

    const copy: Record<string, unknown> = {
      tagline: manifest.description || null,
      supportedAgents: effectiveAgentIds,
      author: author ?? null,
      category: manifest.category ?? null,
      tags: manifest.tags ?? null,
      license: manifest.license ?? null,
      unofficial: manifest.unofficial ?? null,
      mode: manifest.mode ?? null,
      colors: manifest.colors ?? null,
      contentHash,
      // Flat / CSS-only themes declare art:false; consumers (seed-pipeline
      // test, catalog) use this to skip the --agentskin-art requirement.
      art: manifest.art !== false,
      // --- v2.1 extensions ---
      dynamic: manifest.dynamic ?? null,
      wallpaper: manifest.wallpaper ?? null,
      fonts: manifest.fonts ?? null,
      minAppVersion: manifest.minAppVersion ?? null,
      homepage: manifest.homepage ?? null,
      repository: manifest.repository ?? null,
    };

    return {
      // Engine-required format identifier — @agentskin/core validates this
      // field; both 'codedrobe-theme' and 'agentskin-theme' are accepted.
      format: 'codedrobe-theme',
      // The engine only understands schemaVersion 1 for the on-disk bundle.
      // The directory manifest's v2 schema is a packaging-layer concept.
      schemaVersion: 1,
      theme: {
        id: manifest.id,
        displayName: manifest.displayName || manifest.name,
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
   * Generate a minimal fallback CSS from manifest colors. Used only when a
   * theme package ships no per-agent CSS files at all.
   */
  private generateFallbackCSS(manifest: ThemeManifest): string {
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
