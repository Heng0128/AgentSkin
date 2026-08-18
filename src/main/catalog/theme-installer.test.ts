// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledTheme } from '../../shared/types';
import type { ThemeLibraryApi } from '../services/contracts';
import { compareSemver, parseSemver, ThemeInstaller } from './theme-installer';
import type { InstalledThemePackage } from './theme-package-loader';

// Regression coverage for the documented semver precedence rules in
// `theme-installer.ts` (P1 audit #19: prerelease ordering was previously
// reversed). These are pure functions with no I/O, so the tests are fully
// deterministic.

describe('parseSemver', () => {
  it('parses a full version into numeric tuples', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses a prerelease into a token array', () => {
    expect(parseSemver('1.0.0-alpha.1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', '1'],
    });
  });

  it('strips a leading v and surrounding whitespace', () => {
    expect(parseSemver('  v2.5.0  ')).toEqual({ major: 2, minor: 5, patch: 0, prerelease: [] });
  });

  it('returns null for non-semver strings', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('1')).toBeNull();
  });

  it('ignores the build metadata component', () => {
    expect(parseSemver('1.2.3+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });
});

describe('compareSemver', () => {
  it('orders by major.minor.patch numerically', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  // P1 audit #19 — prerelease precedence was historically reversed.
  it('treats a release as greater than its own prerelease', () => {
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
  });

  it('orders prereleases by identifier precedence', () => {
    // Numeric identifiers have lower precedence than alphanumeric.
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.beta', '1.0.0-beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.1')).toBe(0);
  });

  it('falls back to legacy numeric-split for non-semver inputs', () => {
    expect(compareSemver('5', '1.2')).toBeGreaterThan(0);
    expect(compareSemver('1.2', '5')).toBeLessThan(0);
    expect(compareSemver('1.2', '1.2')).toBe(0);
  });
});

/** A 1x1 transparent PNG so manifest icon/preview/hero checks pass. */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Fake library whose installFile parses the installer-written bundle JSON and
 * captures it, so tests can assert the bundle's `assets.images` contract.
 */
function createCapturingLibrary(): ThemeLibraryApi & { capturedBundles: unknown[] } {
  const state = { capturedBundles: [] as unknown[] };
  const library: ThemeLibraryApi = {
    initialize: async () => {},
    entries: async () => [],
    summaries: async () => [],
    coverPathFor: () => null,
    iconPathFor: () => null,
    find: async (id: string) => ({ id }) as never,
    installFile: async (sourcePath: string) => {
      state.capturedBundles.push(JSON.parse(await fs.readFile(sourcePath, 'utf8')));
      return { id: 'x', displayName: 'x', version: '1.0.0' } as InstalledTheme;
    },
    installBytes: async () => ({}) as never,
    importPackage: async () => ({}) as never,
    inspectPackage: async () => ({}) as never,
    exportPackage: async () => {},
    delete: async () => {},
  };
  return Object.assign(library, state);
}

/** Minimal v1 manifest (no targets) that installs via the fallback CSS path. */
function multiImageManifest(themeId: string): Record<string, unknown> {
  return {
    id: themeId,
    name: 'Multi Image',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    hero: 'assets/images/hero.png',
    mode: 'dark',
    colors: { background: '#050816', foreground: '#e0e8ff' },
    assets: {
      images: {
        hero: 'assets/images/hero.png',
        sidebar: 'assets/images/sidebar.png',
        mascot: 'assets/images/mascot.gif',
      },
    },
  };
}

describe('ThemeInstaller — 2a multi-asset bundle embedding', () => {
  let themesRoot: string;

  beforeEach(async () => {
    themesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-install-test-'));
  });

  afterEach(async () => {
    await fs.rm(themesRoot, { recursive: true, force: true });
  });

  async function writePackage(themeId: string): Promise<InstalledThemePackage> {
    const dir = path.join(themesRoot, themeId);
    await fs.mkdir(path.join(dir, 'assets', 'images'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(multiImageManifest(themeId)),
    );
    for (const f of [
      'icon.png',
      'preview.png',
      'assets/images/hero.png',
      'assets/images/sidebar.png',
      'assets/images/mascot.gif',
    ]) {
      await fs.writeFile(path.join(dir, f), Buffer.from(PLACEHOLDER_PNG, 'base64'));
    }
    return { packagePath: dir, manifest: multiImageManifest(themeId) } as never;
  }

  it('embeds hero + icon + preview + creative images into bundle.assets.images', async () => {
    const pkg = await writePackage('multi-image-theme');
    const library = createCapturingLibrary();

    await new ThemeInstaller(library).install(pkg);

    const bundle = library.capturedBundles[0] as {
      assets: { images: Record<string, { filename: string; mimeType: string; base64: string }> };
    };
    const images = bundle.assets.images;
    expect(Object.keys(images).sort()).toEqual(['hero', 'icon', 'mascot', 'preview', 'sidebar']);
    expect(images.hero.filename).toBe('hero.png');
    expect(images.hero.mimeType).toBe('image/png');
    expect(images.sidebar.filename).toBe('sidebar.png');
    expect(images.mascot.mimeType).toBe('image/gif');
    // Creative images ride the same data-URL-able base64 contract as hero.
    expect(images.mascot.base64).toBe(PLACEHOLDER_PNG);
  });

  it('falls back to assets.images.hero when manifest.hero is absent', async () => {
    const themeId = 'hero-only-in-set';
    const dir = path.join(themesRoot, themeId);
    await fs.mkdir(path.join(dir, 'assets', 'images'), { recursive: true });
    const manifest = multiImageManifest(themeId);
    delete manifest.hero;
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    for (const f of [
      'icon.png',
      'preview.png',
      'assets/images/hero.png',
      'assets/images/sidebar.png',
      'assets/images/mascot.gif',
    ]) {
      await fs.writeFile(path.join(dir, f), Buffer.from(PLACEHOLDER_PNG, 'base64'));
    }
    const library = createCapturingLibrary();

    await new ThemeInstaller(library).install({
      packagePath: dir,
      manifest: manifest as never,
    } as InstalledThemePackage);

    const bundle = library.capturedBundles[0] as {
      assets: { images: Record<string, { base64: string }> };
    };
    // hero resolved from the image set (not the preview fallback) and no
    // duplicate hero key — the creative loop skips the reserved hero id.
    expect(bundle.assets.images.hero.base64).toBe(PLACEHOLDER_PNG);
    expect(bundle.assets.images.sidebar.base64).toBe(PLACEHOLDER_PNG);
  });
});
