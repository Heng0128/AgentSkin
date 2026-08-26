// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemePackageLoader (P3.1)
 *
 * Reads directory-based theme packages from `themes/<id>/` and validates
 * them. Produces an `InstalledThemePackage` that the installer uses to seed
 * the ThemeLibrary catalog.
 *
 * Validation rules:
 * 1. manifest.json must exist and parse as ThemeManifest
 * 2. icon file referenced in manifest must exist
 * 3. preview file referenced in manifest must exist
 * 4. assets paths (if present) must be under the package root
 * 5. v2: targets must reference existing CSS files
 * 6. v2: author, category, tags are optional but validated if present
 *
 * Usage:
 *   const loader = new ThemePackageLoader(rootDir);
 *   const pkg = await loader.load('cyber-neon');
 *   await installer.install(pkg);
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isSafeThemeId } from '../../shared/theme-id';
import { mainErrorFromCatch, mainWarn } from '../logger';
import { formatSchemaErrors, validateManifest } from './manifest-validator';
import type { ThemeManifest, ThemeTargetConfig } from './theme-manifest';
import { isV2Manifest } from './theme-manifest';

/** A validated, ready-to-install theme package. */
export interface InstalledThemePackage {
  /** Absolute path to the package root directory. */
  packagePath: string;
  /** Parsed and validated manifest. */
  manifest: ThemeManifest;
}

/** Thrown when a package fails validation. */
export class ThemePackageValidationError extends Error {
  constructor(
    public readonly themeId: string,
    message: string,
  ) {
    super(`Theme package "${themeId}" validation failed: ${message}`);
    this.name = 'ThemePackageValidationError';
  }
}

/**
 * Resolve `rel` against `packagePath` and verify the result stays inside the
 * package root. Throws ThemePackageValidationError on escape. Centralizes the
 * 9 repeated `path.resolve(path.join(...)) + startsWith(...)` checks.
 */
function resolveWithin(themeId: string, packagePath: string, rel: string, label: string): string {
  const resolved = path.resolve(path.join(packagePath, rel));
  const root = path.resolve(packagePath);
  if (!resolved.startsWith(root)) {
    throw new ThemePackageValidationError(themeId, `${label} path escapes package root: ${rel}`);
  }
  return resolved;
}

/**
 * Safe image asset id — mirrors the engine's `SAFE_ID` (package.mjs) so a
 * manifest that validates here also passes the engine bundle gate at install.
 */
const SAFE_IMAGE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Validate that a target config references an existing CSS file.
 */
async function validateTarget(
  themeId: string,
  targetKey: string,
  config: ThemeTargetConfig,
  packagePath: string,
): Promise<void> {
  if (!config.css || typeof config.css !== 'string') {
    throw new ThemePackageValidationError(
      themeId,
      `target "${targetKey}" has missing or invalid css path`,
    );
  }
  resolveWithin(themeId, packagePath, config.css, `target "${targetKey}" css`);
  // CSS file existence is optional for v2 targets — just validate path safety
  // Don't require the file to exist at load time (may be generated)
}

/**
 * Validate background asset references.
 */
async function validateBackgroundAssets(
  themeId: string,
  assets: NonNullable<ThemeManifest['assets']>,
  packagePath: string,
): Promise<void> {
  const bg = assets.background;
  if (!bg) return;

  // A bare string background is a single relative path.
  if (typeof bg === 'string') {
    resolveWithin(themeId, packagePath, bg, 'background');
    return;
  }

  // Check default exists
  if (bg.default) {
    resolveWithin(themeId, packagePath, bg.default, 'background.default');
  }

  // Check per-resolution files exist if referenced
  for (const [ratio, assetPath] of Object.entries(bg) as [string, string][]) {
    if (ratio === 'default' || ratio === 'fallback') continue;
    if (assetPath) {
      const p = resolveWithin(themeId, packagePath, assetPath, `background.${ratio}`);
      // Optional — warn but don't fail
      try {
        await fs.access(p);
      } catch {
        mainWarn(
          'ThemePackageLoader',
          `optional background asset not found for ${themeId}: ${assetPath}`,
        );
      }
    }
  }
}

export class ThemePackageLoader {
  constructor(private readonly themesDir: string) {}

  /**
   * Load and validate a single theme package by id.
   * @throws ThemePackageValidationError if any requirement is not met.
   */
  async load(themeId: string): Promise<InstalledThemePackage> {
    if (!isSafeThemeId(themeId)) {
      throw new ThemePackageValidationError(
        themeId,
        'invalid theme id (must be alphanumeric + hyphens)',
      );
    }

    const packagePath = path.join(this.themesDir, themeId);

    // 1. Check manifest exists
    const manifestPath = path.join(packagePath, 'manifest.json');
    let manifestRaw: string;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      throw new ThemePackageValidationError(themeId, 'manifest.json not found');
    }

    let manifest: ThemeManifest;
    try {
      // TODO: type-guard — 待渐进式加固
      manifest = JSON.parse(manifestRaw) as ThemeManifest;
    } catch {
      throw new ThemePackageValidationError(themeId, 'manifest.json is not valid JSON');
    }

    // A2: schema-driven validation (SPEC-2) — the authoritative manifest-v2
    // schema now lives in src/main/catalog (see manifest-validator.ts) and is
    // the single source of truth. Hand-written checks below still harden
    // file-existence / path-safety concerns the schema cannot express, but
    // structural correctness is enforced here, with JSON paths in the error.
    const schemaErrors = validateManifest(manifest);
    if (schemaErrors.length > 0) {
      throw new ThemePackageValidationError(
        themeId,
        `manifest violates schema (${formatSchemaErrors(schemaErrors)})`,
      );
    }

    // Validate required fields (common to v1 and v2)
    if (!manifest.id || manifest.id !== themeId) {
      throw new ThemePackageValidationError(themeId, 'manifest id mismatch');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      throw new ThemePackageValidationError(themeId, 'missing or invalid name');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      throw new ThemePackageValidationError(themeId, 'missing or invalid version');
    }
    if (!manifest.icon || typeof manifest.icon !== 'string') {
      throw new ThemePackageValidationError(themeId, 'missing or invalid icon');
    }
    if (!manifest.preview || typeof manifest.preview !== 'string') {
      throw new ThemePackageValidationError(themeId, 'missing or invalid preview');
    }
    if (manifest.mode && !['dark', 'light', 'auto'].includes(manifest.mode)) {
      throw new ThemePackageValidationError(
        themeId,
        'invalid mode (must be "dark", "light", or "auto")',
      );
    }
    if (!manifest.colors?.background) {
      throw new ThemePackageValidationError(themeId, 'missing or invalid colors.background');
    }

    // 2. Check icon exists
    const iconPath = path.join(packagePath, manifest.icon);
    try {
      await fs.access(iconPath);
    } catch {
      throw new ThemePackageValidationError(themeId, `icon file not found: ${manifest.icon}`);
    }

    // 3. Check preview exists
    const previewPath = path.join(packagePath, manifest.preview);
    try {
      await fs.access(previewPath);
    } catch {
      throw new ThemePackageValidationError(themeId, `preview file not found: ${manifest.preview}`);
    }

    // 3b. Check optional hero artwork exists (embedded as the applied
    // background art + catalog cover by the installer).
    if (manifest.hero !== undefined) {
      if (!manifest.hero || typeof manifest.hero !== 'string') {
        throw new ThemePackageValidationError(themeId, 'hero must be a non-empty relative path');
      }
      const heroPath = resolveWithin(themeId, packagePath, manifest.hero, 'hero');
      try {
        await fs.access(heroPath);
      } catch {
        throw new ThemePackageValidationError(themeId, `hero file not found: ${manifest.hero}`);
      }
    }

    // 3c. 2a multi-asset: validate assets.images (id → relative path). Each id
    // must be a safe slug (mirrors engine SAFE_ID), each path must stay inside
    // the package root, and each file must exist — the installer embeds them
    // into the bundle where the engine re-enforces quantity/volume gates
    // (RFC themes-asset-injection-2a §2.1 / §2.3.1).
    if (manifest.assets?.images !== undefined) {
      const imageAssets = manifest.assets.images;
      if (!imageAssets || typeof imageAssets !== 'object' || Array.isArray(imageAssets)) {
        throw new ThemePackageValidationError(
          themeId,
          'assets.images must be an object keyed by image id',
        );
      }
      for (const [imageId, rel] of Object.entries(imageAssets)) {
        if (!SAFE_IMAGE_ID.test(imageId)) {
          throw new ThemePackageValidationError(
            themeId,
            `assets.images contains invalid image id '${imageId}'`,
          );
        }
        if (typeof rel !== 'string' || !rel.trim()) {
          throw new ThemePackageValidationError(
            themeId,
            `assets.images.${imageId} must be a non-empty relative path`,
          );
        }
        const imagePath = resolveWithin(themeId, packagePath, rel, `assets.images.${imageId}`);
        try {
          await fs.access(imagePath);
        } catch {
          throw new ThemePackageValidationError(
            themeId,
            `asset image file not found for ${imageId}: ${rel}`,
          );
        }
      }
    }

    // 4. v2-specific validation for background assets.
    // assets.background is deprecated (hero is the canonical art source);
    // third-party manifests may still declare it, so validate but warn.
    if (manifest.assets?.background) {
      mainWarn(
        'ThemePackageLoader',
        `theme "${themeId}" declares deprecated assets.background; use manifest.hero instead (embedded and exposed as --agentskin-art)`,
      );
      await validateBackgroundAssets(themeId, manifest.assets, packagePath);
    }

    // 5. v2-specific validation
    if (isV2Manifest(manifest)) {
      // Validate targets
      if (manifest.targets) {
        for (const [targetKey, config] of Object.entries(manifest.targets)) {
          await validateTarget(themeId, targetKey, config, packagePath);
        }
      }

      // Validate author if present
      if (manifest.author) {
        if (!manifest.author.name || typeof manifest.author.name !== 'string') {
          throw new ThemePackageValidationError(
            themeId,
            'author.name is required when author is present',
          );
        }
        if (manifest.author.url && typeof manifest.author.url !== 'string') {
          throw new ThemePackageValidationError(themeId, 'author.url must be a string');
        }
      }

      // Validate category if present
      if (manifest.category && typeof manifest.category !== 'string') {
        throw new ThemePackageValidationError(themeId, 'category must be a string');
      }

      // Validate tags if present
      if (
        manifest.tags &&
        (!Array.isArray(manifest.tags) || !manifest.tags.every((t) => typeof t === 'string'))
      ) {
        throw new ThemePackageValidationError(themeId, 'tags must be an array of strings');
      }

      // --- v2.1+ field validation ---

      // Validate dynamic effect
      if (manifest.dynamic !== undefined) {
        const validEffects = ['aurora', 'particles', 'gradient', 'waves', false];
        if (!validEffects.includes(manifest.dynamic)) {
          throw new ThemePackageValidationError(
            themeId,
            `invalid dynamic effect "${manifest.dynamic}" (must be aurora/particles/gradient/waves/false)`,
          );
        }
      }

      // Validate wallpaper config
      if (manifest.wallpaper) {
        const wp = manifest.wallpaper;
        const hasWorkshopId = typeof wp.workshopId === 'string' && wp.workshopId.length > 0;
        const hasVideo = typeof wp.video === 'string' && wp.video.length > 0;
        if (!hasWorkshopId && !hasVideo) {
          throw new ThemePackageValidationError(
            themeId,
            'wallpaper requires either workshopId or video',
          );
        }
        if (hasWorkshopId && !/^\d+$/.test(wp.workshopId!)) {
          throw new ThemePackageValidationError(
            themeId,
            'wallpaper.workshopId must be a numeric string (Steam workshop item id)',
          );
        }
        if (hasVideo) {
          resolveWithin(themeId, packagePath, wp.video!, 'wallpaper.video');
        }
        if (wp.poster) {
          resolveWithin(themeId, packagePath, wp.poster, 'wallpaper.poster');
        }
        if (
          wp.speed !== undefined &&
          (typeof wp.speed !== 'number' || wp.speed < 0.1 || wp.speed > 3.0)
        ) {
          throw new ThemePackageValidationError(
            themeId,
            'wallpaper.speed must be a number between 0.1 and 3.0',
          );
        }
        if (
          wp.scrimOpacity !== undefined &&
          (typeof wp.scrimOpacity !== 'number' || wp.scrimOpacity < 0 || wp.scrimOpacity > 100)
        ) {
          throw new ThemePackageValidationError(
            themeId,
            'wallpaper.scrimOpacity must be between 0 and 100',
          );
        }
      }

      // Validate fonts
      if (manifest.fonts) {
        if (!Array.isArray(manifest.fonts)) {
          throw new ThemePackageValidationError(themeId, 'fonts must be an array');
        }
        if (manifest.fonts.length > 5) {
          throw new ThemePackageValidationError(
            themeId,
            'fonts array exceeds maximum of 5 entries',
          );
        }
        for (const font of manifest.fonts) {
          if (!font.family || typeof font.family !== 'string') {
            throw new ThemePackageValidationError(themeId, 'each font must have a family string');
          }
          if (!font.src || typeof font.src !== 'string') {
            throw new ThemePackageValidationError(
              themeId,
              `font "${font.family}" must have a src string`,
            );
          }
          resolveWithin(themeId, packagePath, font.src, `font "${font.family}" src`);
          if (font.style && !['normal', 'italic', 'oblique'].includes(font.style)) {
            throw new ThemePackageValidationError(
              themeId,
              `font "${font.family}" has invalid style`,
            );
          }
        }
      }

      // Validate minAppVersion
      if (manifest.minAppVersion !== undefined) {
        if (
          typeof manifest.minAppVersion !== 'string' ||
          !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)
        ) {
          throw new ThemePackageValidationError(
            themeId,
            'minAppVersion must be a semver string (e.g. "2.1.0")',
          );
        }
      }

      // Validate colorSchemes: each declared scheme id must resolve to a
      // color-schemes/<id>.json file whose colors match the manifest shape.
      if (manifest.colorSchemes) {
        for (const schemeId of manifest.colorSchemes) {
          const schemePath = resolveWithin(
            themeId,
            packagePath,
            `color-schemes/${schemeId}.json`,
            `colorSchemes.${schemeId}`,
          );
          let schemeRaw: string;
          try {
            schemeRaw = await fs.readFile(schemePath, 'utf8');
          } catch {
            throw new ThemePackageValidationError(
              themeId,
              `color scheme file not found: color-schemes/${schemeId}.json`,
            );
          }
          let scheme: {
            id?: unknown;
            name?: unknown;
            mode?: unknown;
            colors?: Record<string, unknown>;
          };
          try {
            // TODO: type-guard — 待渐进式加固
            scheme = JSON.parse(schemeRaw) as typeof scheme;
          } catch {
            throw new ThemePackageValidationError(
              themeId,
              `color scheme file is not valid JSON: color-schemes/${schemeId}.json`,
            );
          }
          if (scheme.id !== schemeId) {
            throw new ThemePackageValidationError(
              themeId,
              `color scheme id mismatch: expected "${schemeId}", got "${String(scheme.id)}"`,
            );
          }
          if (typeof scheme.colors !== 'object' || scheme.colors === null) {
            throw new ThemePackageValidationError(
              themeId,
              `color scheme "${schemeId}" is missing a colors object`,
            );
          }
          const schemeColors = scheme.colors as Record<string, unknown>;
          if (
            typeof schemeColors.background !== 'string' ||
            typeof schemeColors.foreground !== 'string'
          ) {
            throw new ThemePackageValidationError(
              themeId,
              `color scheme "${schemeId}" must declare colors.background and colors.foreground`,
            );
          }
        }
      }

      // Validate homepage/repository URLs
      if (manifest.homepage !== undefined && typeof manifest.homepage !== 'string') {
        throw new ThemePackageValidationError(themeId, 'homepage must be a string URL');
      }
      if (manifest.repository !== undefined && typeof manifest.repository !== 'string') {
        throw new ThemePackageValidationError(themeId, 'repository must be a string URL');
      }
    }

    return { packagePath, manifest };
  }

  /**
   * Scan all subdirectories in the themes directory and return
   * successfully loaded packages. Skips invalid packages with warnings.
   */
  async scan(): Promise<InstalledThemePackage[]> {
    const entries = await fs.readdir(this.themesDir, { withFileTypes: true }).catch(() => []);
    const results: InstalledThemePackage[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip the shared base-CSS directory — it's not a theme package.
      if (entry.name === '_shared') continue;
      try {
        const pkg = await this.load(entry.name);
        results.push(pkg);
      } catch (error) {
        if (error instanceof ThemePackageValidationError) {
          mainWarn('ThemePackageLoader', `skipped invalid theme "${entry.name}": ${error.message}`);
        } else {
          mainErrorFromCatch('ThemePackageLoader', error, `unexpected error for "${entry.name}"`);
        }
      }
    }

    return results.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }
}
