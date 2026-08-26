// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemePackageLoader, ThemePackageValidationError } from './theme-package-loader';

function createMinimalManifest(themeId: string): string {
  return JSON.stringify({
    id: themeId,
    name: `Test Theme ${themeId}`,
    version: '1.0.0',
    description: 'A test theme',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark' as const,
    colors: {
      primary: '#00ffff',
      background: '#050816',
      foreground: '#e0e8ff',
      surface: '#0a0a12',
      text: '#e0e8ff',
    },
    assets: {
      background: 'assets/background.png',
    },
  });
}

function createPlaceholderPng(): string {
  // 1x1 transparent PNG
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}

let loader: ThemePackageLoader;
let themesRoot: string;

beforeEach(async () => {
  themesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-theme-test-'));
  loader = new ThemePackageLoader(themesRoot);
});

afterEach(async () => {
  await fs.rm(themesRoot, { recursive: true, force: true });
});

describe('ThemePackageLoader', () => {
  describe('load', () => {
    it('loads a valid theme package', async () => {
      const themeId = 'cyber-neon';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });
      await fs.mkdir(path.join(themeDir, 'assets'), { recursive: true });

      await fs.writeFile(path.join(themeDir, 'manifest.json'), createMinimalManifest(themeId));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'assets', 'background.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      const pkg = await loader.load(themeId);
      expect(pkg.manifest.id).toBe(themeId);
      expect(pkg.manifest.name).toBe(`Test Theme ${themeId}`);
      expect(pkg.manifest.version).toBe('1.0.0');
      expect(pkg.manifest.mode).toBe('dark');
      expect(pkg.manifest.colors.primary).toBe('#00ffff');
      expect(pkg.packagePath).toBe(themeDir);
    });

    it('rejects missing manifest.json', async () => {
      const themeDir = path.join(themesRoot, 'no-manifest');
      await fs.mkdir(themeDir, { recursive: true });

      await expect(loader.load('no-manifest')).rejects.toThrow('manifest.json not found');
    });

    it('rejects invalid JSON in manifest', async () => {
      const themeDir = path.join(themesRoot, 'bad-json');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(path.join(themeDir, 'manifest.json'), '{invalid json');

      await expect(loader.load('bad-json')).rejects.toThrow('not valid JSON');
    });

    it('rejects manifest id mismatch', async () => {
      const themeDir = path.join(themesRoot, 'mismatch');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'different-id',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          mode: 'dark' as const,
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('mismatch')).rejects.toThrow('manifest id mismatch');
    });

    it('rejects missing icon file', async () => {
      const themeDir = path.join(themesRoot, 'no-icon');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'no-icon',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          mode: 'dark' as const,
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('no-icon')).rejects.toThrow('icon file not found');
    });

    it('rejects missing preview file', async () => {
      const themeDir = path.join(themesRoot, 'no-preview');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'no-preview',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          mode: 'dark' as const,
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('no-preview')).rejects.toThrow('preview file not found');
    });

    it('rejects invalid mode', async () => {
      const themeDir = path.join(themesRoot, 'bad-mode');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'bad-mode',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          mode: 'sepia' as never,
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('bad-mode')).rejects.toThrow('mode: value must be one of');
    });

    it('tolerates missing optional asset background', async () => {
      const themeDir = path.join(themesRoot, 'no-bg-asset');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'no-bg-asset',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
          assets: { background: 'assets/background.png' },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      // Should succeed — missing optional asset is only a warning
      const pkg = await loader.load('no-bg-asset');
      expect(pkg.manifest.id).toBe('no-bg-asset');
    });

    it('rejects asset path escaping package root', async () => {
      const themeDir = path.join(themesRoot, 'escape');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'escape',
          name: 'X',
          version: '1.0.0',
          icon: 'icon.png',
          preview: 'preview.png',
          colors: {
            primary: '#000',
            background: '#fff',
            foreground: '#000',
            surface: '#eee',
            text: '#000',
          },
          assets: { background: '../../etc/passwd' },
        }),
      );
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('escape')).rejects.toThrow('escapes package root');
    });

    it('rejects invalid theme id format', async () => {
      await expect(loader.load('invalid id!')).rejects.toThrow('invalid theme id');
    });

    it('rejects a typo target key (SPEC-3 cross-field)', async () => {
      const themeDir = path.join(themesRoot, 'bad-target');
      await fs.mkdir(themeDir, { recursive: true });
      const manifest = JSON.parse(createMinimalManifest('bad-target')) as Record<string, unknown>;
      manifest.targets = { traewrok: { css: 'assets/css/traework.css' } }; // typo
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load('bad-target')).rejects.toThrow(
        'targets.traewrok: unknown agent id "traewrok"',
      );
    });

    it('loads a theme with valid multi-image assets (2a)', async () => {
      const themeId = 'multi-image';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });
      await fs.mkdir(path.join(themeDir, 'assets', 'images'), { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.assets = {
        images: {
          hero: 'assets/images/hero.png',
          sidebar: 'assets/images/sidebar.png',
          mascot: 'assets/images/mascot.gif',
        },
      };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      for (const f of [
        'icon.png',
        'preview.png',
        'assets/images/hero.png',
        'assets/images/sidebar.png',
        'assets/images/mascot.gif',
      ]) {
        await fs.writeFile(path.join(themeDir, f), Buffer.from(createPlaceholderPng(), 'base64'));
      }

      const pkg = await loader.load(themeId);
      expect(pkg.manifest.assets?.images).toEqual({
        hero: 'assets/images/hero.png',
        sidebar: 'assets/images/sidebar.png',
        mascot: 'assets/images/mascot.gif',
      });
    });

    it('rejects assets.images with a path escaping the package root', async () => {
      const themeId = 'img-escape';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.assets = { images: { sidebar: '../../etc/passwd' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load(themeId)).rejects.toThrow(
        'assets.images.sidebar path escapes package root',
      );
    });

    it('rejects assets.images referencing a missing file', async () => {
      const themeId = 'img-missing';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.assets = { images: { sidebar: 'assets/images/sidebar.png' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load(themeId)).rejects.toThrow('asset image file not found for sidebar');
    });

    it('rejects assets.images with an invalid image id', async () => {
      const themeId = 'img-bad-id';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.assets = { images: { '../escape': 'assets/images/x.png' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load(themeId)).rejects.toThrow(
        "assets.images contains invalid image id '../escape'",
      );
    });

    it('rejects assets.images with an invalid id value', async () => {
      const themeId = 'img-bad-val';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.assets = { images: { sidebar: '' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      await expect(loader.load(themeId)).rejects.toThrow(
        'assets.images.sidebar must be a non-empty relative path',
      );
    });
  });

  describe('scan', () => {
    it('discovers all valid packages in the themes directory', async () => {
      // Create two valid themes
      for (const id of ['theme-a', 'theme-b']) {
        const themeDir = path.join(themesRoot, id);
        await fs.mkdir(themeDir, { recursive: true });
        await fs.mkdir(path.join(themeDir, 'assets'), { recursive: true });
        await fs.writeFile(path.join(themeDir, 'manifest.json'), createMinimalManifest(id));
        await fs.writeFile(
          path.join(themeDir, 'icon.png'),
          Buffer.from(createPlaceholderPng(), 'base64'),
        );
        await fs.writeFile(
          path.join(themeDir, 'preview.png'),
          Buffer.from(createPlaceholderPng(), 'base64'),
        );
        await fs.writeFile(
          path.join(themeDir, 'assets', 'bg.png'),
          Buffer.from(createPlaceholderPng(), 'base64'),
        );
      }

      // Create one invalid theme (missing manifest)
      await fs.mkdir(path.join(themesRoot, 'broken-theme'), { recursive: true });

      const packages = await loader.scan();
      expect(packages).toHaveLength(2);
      expect(packages.map((p) => p.manifest.id)).toContain('theme-a');
      expect(packages.map((p) => p.manifest.id)).toContain('theme-b');
    });

    it('returns empty array when no themes exist', async () => {
      const packages = await loader.scan();
      expect(packages).toHaveLength(0);
    });

    it('sorts packages by name', async () => {
      for (const id of ['zebra-theme', 'alpha-theme', 'beta-theme']) {
        const themeDir = path.join(themesRoot, id);
        await fs.mkdir(themeDir, { recursive: true });
        await fs.mkdir(path.join(themeDir, 'assets'), { recursive: true });
        await fs.writeFile(path.join(themeDir, 'manifest.json'), createMinimalManifest(id));
        await fs.writeFile(
          path.join(themeDir, 'icon.png'),
          Buffer.from(createPlaceholderPng(), 'base64'),
        );
        await fs.writeFile(
          path.join(themeDir, 'preview.png'),
          Buffer.from(createPlaceholderPng(), 'base64'),
        );
      }

      const packages = await loader.scan();
      expect(packages.map((p) => p.manifest.name)).toEqual([
        'Test Theme alpha-theme',
        'Test Theme beta-theme',
        'Test Theme zebra-theme',
      ]);
    });
  });

  describe('build.fingerprint.json verification', () => {
    it('loads a theme with a valid build.fingerprint.json', async () => {
      const themeId = 'valid-fingerprint';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });
      await fs.mkdir(path.join(themeDir, 'assets', 'css'), { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.targets = { traework: { css: 'assets/css/traework.css' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'assets', 'css', 'traework.css'),
        '/* traework CSS */\n:root { --test: 1; }\n',
      );

      // Generate a valid fingerprint
      const { generateBuildFingerprint } = await import('../../shared/theme-build-fingerprint');
      const fingerprint = await generateBuildFingerprint(themeDir);
      await fs.writeFile(
        path.join(themeDir, 'build.fingerprint.json'),
        JSON.stringify(fingerprint),
      );

      const pkg = await loader.load(themeId);
      expect(pkg.manifest.id).toBe(themeId);
    });

    it('loads a theme without build.fingerprint.json (backward compatible)', async () => {
      const themeId = 'no-fingerprint';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      await fs.writeFile(path.join(themeDir, 'manifest.json'), createMinimalManifest(themeId));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );

      // No build.fingerprint.json — should still load fine
      const pkg = await loader.load(themeId);
      expect(pkg.manifest.id).toBe(themeId);
    });

    it('rejects a theme with a tampered manifest (fingerprint mismatch)', async () => {
      const themeId = 'tampered-manifest';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });
      await fs.mkdir(path.join(themeDir, 'assets', 'css'), { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.targets = { traework: { css: 'assets/css/traework.css' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'assets', 'css', 'traework.css'),
        '/* traework CSS */\n:root { --test: 1; }\n',
      );

      // Generate a valid fingerprint, then tamper with the manifest
      const { generateBuildFingerprint } = await import('../../shared/theme-build-fingerprint');
      const fingerprint = await generateBuildFingerprint(themeDir);
      await fs.writeFile(
        path.join(themeDir, 'build.fingerprint.json'),
        JSON.stringify(fingerprint),
      );
      // Tamper with manifest after fingerprint was generated
      const tamperedManifest = { ...manifest, name: 'Tampered Name' };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(tamperedManifest));

      await expect(loader.load(themeId)).rejects.toThrow(ThemePackageValidationError);
      await expect(loader.load(themeId)).rejects.toThrow(
        'build.fingerprint.json verification failed',
      );
    });

    it('rejects a theme with an injected CSS file not in the fingerprint', async () => {
      const themeId = 'injected-css';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });
      await fs.mkdir(path.join(themeDir, 'assets', 'css'), { recursive: true });

      const manifest = JSON.parse(createMinimalManifest(themeId)) as Record<string, unknown>;
      manifest.targets = { traework: { css: 'assets/css/traework.css' } };
      await fs.writeFile(path.join(themeDir, 'manifest.json'), JSON.stringify(manifest));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'assets', 'css', 'traework.css'),
        '/* traework CSS */\n:root { --test: 1; }\n',
      );

      // Generate fingerprint for traework only
      const { generateBuildFingerprint } = await import('../../shared/theme-build-fingerprint');
      const fingerprint = await generateBuildFingerprint(themeDir);
      await fs.writeFile(
        path.join(themeDir, 'build.fingerprint.json'),
        JSON.stringify(fingerprint),
      );

      // Inject an additional CSS file not covered by the fingerprint
      await fs.writeFile(
        path.join(themeDir, 'assets', 'css', 'codex.css'),
        '/* malicious injection */\n',
      );

      await expect(loader.load(themeId)).rejects.toThrow(ThemePackageValidationError);
      await expect(loader.load(themeId)).rejects.toThrow('unexpected CSS file');
    });

    it('rejects a theme with malformed build.fingerprint.json', async () => {
      const themeId = 'bad-fingerprint';
      const themeDir = path.join(themesRoot, themeId);
      await fs.mkdir(themeDir, { recursive: true });

      await fs.writeFile(path.join(themeDir, 'manifest.json'), createMinimalManifest(themeId));
      await fs.writeFile(
        path.join(themeDir, 'icon.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(
        path.join(themeDir, 'preview.png'),
        Buffer.from(createPlaceholderPng(), 'base64'),
      );
      await fs.writeFile(path.join(themeDir, 'build.fingerprint.json'), '{not valid json');

      await expect(loader.load(themeId)).rejects.toThrow(ThemePackageValidationError);
      await expect(loader.load(themeId)).rejects.toThrow(
        'build.fingerprint.json verification failed',
      );
    });
  });
});
