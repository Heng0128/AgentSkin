// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ThemePackageLoader,
  type InstalledThemePackage,
  ThemePackageValidationError,
} from './theme-package-loader';

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
      surface: '#0a0a12',
      text: '#e0e8ff',
    },
    assets: {
      background: 'assets/background.png',
    },
  });
}

function createMinimalManifestNoAssets(themeId: string): string {
  return JSON.stringify({
    id: themeId,
    name: `Test Theme ${themeId}`,
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark' as const,
    colors: {
      primary: '#00ffff',
      background: '#050816',
      surface: '#0a0a12',
      text: '#e0e8ff',
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

      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        createMinimalManifest(themeId),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));
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
        JSON.stringify({ id: 'different-id', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png', mode: 'dark' as const, colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' } }),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));

      await expect(loader.load('mismatch')).rejects.toThrow('manifest id mismatch');
    });

    it('rejects missing icon file', async () => {
      const themeDir = path.join(themesRoot, 'no-icon');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({ id: 'no-icon', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png', mode: 'dark' as const, colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' } }),
      );
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));

      await expect(loader.load('no-icon')).rejects.toThrow('icon file not found');
    });

    it('rejects missing preview file', async () => {
      const themeDir = path.join(themesRoot, 'no-preview');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({ id: 'no-preview', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png', mode: 'dark' as const, colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' } }),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));

      await expect(loader.load('no-preview')).rejects.toThrow('preview file not found');
    });

    it('rejects invalid mode', async () => {
      const themeDir = path.join(themesRoot, 'bad-mode');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'bad-mode', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png',
          mode: 'sepia' as never,
          colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' },
        }),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));

      await expect(loader.load('bad-mode')).rejects.toThrow('invalid mode');
    });

    it('tolerates missing optional asset background', async () => {
      const themeDir = path.join(themesRoot, 'no-bg-asset');
      await fs.mkdir(themeDir, { recursive: true });
      await fs.writeFile(
        path.join(themeDir, 'manifest.json'),
        JSON.stringify({
          id: 'no-bg-asset', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png',
          colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' },
          assets: { background: 'assets/background.png' },
        }),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));

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
          id: 'escape', name: 'X', version: '1.0.0', icon: 'icon.png', preview: 'preview.png',
          colors: { primary: '#000', background: '#fff', surface: '#eee', text: '#000' },
          assets: { background: '../../etc/passwd' },
        }),
      );
      await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));

      await expect(loader.load('escape')).rejects.toThrow('escapes package root');
    });

    it('rejects invalid theme id format', async () => {
      await expect(loader.load('invalid id!')).rejects.toThrow('invalid theme id');
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
        await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
        await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));
        await fs.writeFile(path.join(themeDir, 'assets', 'bg.png'), Buffer.from(createPlaceholderPng(), 'base64'));
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
        await fs.writeFile(path.join(themeDir, 'icon.png'), Buffer.from(createPlaceholderPng(), 'base64'));
        await fs.writeFile(path.join(themeDir, 'preview.png'), Buffer.from(createPlaceholderPng(), 'base64'));
      }

      const packages = await loader.scan();
      expect(packages.map((p) => p.manifest.name)).toEqual([
        'Test Theme alpha-theme',
        'Test Theme beta-theme',
        'Test Theme zebra-theme',
      ]);
    });
  });
});
