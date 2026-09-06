// SPDX-License-Identifier: MPL-2.0

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calculateThemeIntegrity,
  HASH_ALGORITHM,
  INTEGRITY_MANIFEST_FILENAME,
  verifyThemeIntegrity,
} from './theme-integrity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for tests. */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'integrity-test-'));
}

/** Create a minimal theme package with manifest, CSS, and image files. */
async function createThemePackage(
  extraFiles?: Record<string, string>,
  options?: { skipIntegrityManifest?: boolean },
): Promise<string> {
  const dir = await createTempDir();
  await fs.mkdir(path.join(dir, 'assets', 'css'), { recursive: true });

  const manifest = {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark' as const,
    colors: { accent: '#00ffff', background: '#050816', foreground: '#e0e8ff' },
  };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(dir, 'icon.png'), Buffer.from('fake-png-data'));
  await fs.writeFile(path.join(dir, 'preview.png'), Buffer.from('fake-png-data'));
  await fs.writeFile(
    path.join(dir, 'assets', 'css', 'traework.css'),
    ':root { --agentskin-accent: #00ffff; }\n',
  );

  if (extraFiles) {
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const fullPath = path.join(dir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  }

  return dir;
}

/** Compute the expected SHA-256 hash of a string. */
function expectedHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('theme-integrity', () => {
  describe('calculateThemeIntegrity', () => {
    let tempDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tempDirs) {
        await fs.rm(dir, { recursive: true, force: true });
      }
      tempDirs = [];
    });

    it('returns a manifest with correct structure', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const result = await calculateThemeIntegrity(dir);

      expect(result).toHaveProperty('algorithm', HASH_ALGORITHM);
      expect(result).toHaveProperty('generatedAt');
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
      expect(result).toHaveProperty('files');
      expect(typeof result.files).toBe('object');
    });

    it('hash calculation is deterministic — same files produce same hashes', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const result1 = await calculateThemeIntegrity(dir);
      const result2 = await calculateThemeIntegrity(dir);

      expect(result1.files).toEqual(result2.files);
    });

    it('correctly hashes manifest.json content', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifestContent = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
      const expected = expectedHash(manifestContent);

      const result = await calculateThemeIntegrity(dir);
      expect(result.files['manifest.json']).toBe(expected);
    });

    it('excludes .theme-integrity.json from the manifest', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      // Pre-create an integrity manifest inside the theme dir
      const integrityData = {
        algorithm: 'sha256',
        generatedAt: new Date().toISOString(),
        files: {},
      };
      await fs.writeFile(
        path.join(dir, INTEGRITY_MANIFEST_FILENAME),
        JSON.stringify(integrityData, null, 2),
      );

      const result = await calculateThemeIntegrity(dir);
      expect(result.files).not.toHaveProperty(INTEGRITY_MANIFEST_FILENAME);
    });

    it('handles empty directories gracefully', async () => {
      const dir = await createTempDir();
      tempDirs.push(dir);

      // Create an empty subdirectory
      await fs.mkdir(path.join(dir, 'empty-subdir'), { recursive: true });

      const result = await calculateThemeIntegrity(dir);
      expect(Object.keys(result.files)).toHaveLength(0);
    });

    it('handles nested directories', async () => {
      const dir = await createThemePackage({
        'assets/images/texture.png': 'texture-data',
        'assets/images/backgrounds/hero.webp': 'hero-data',
        'deep/nested/file.txt': 'deep-content',
      });
      tempDirs.push(dir);

      const result = await calculateThemeIntegrity(dir);

      expect(result.files).toHaveProperty('assets/images/texture.png');
      expect(result.files).toHaveProperty('assets/images/backgrounds/hero.webp');
      expect(result.files).toHaveProperty('deep/nested/file.txt');

      // Verify the hash is correct
      const textureContent = await fs.readFile(path.join(dir, 'assets/images/texture.png'), 'utf8');
      expect(result.files['assets/images/texture.png']).toBe(expectedHash(textureContent));
    });

    it('all file hashes are valid 64-character hex strings', async () => {
      const dir = await createThemePackage({
        'extra/file1.txt': 'content1',
        'extra/file2.txt': 'content2',
      });
      tempDirs.push(dir);

      const result = await calculateThemeIntegrity(dir);

      for (const [_relPath, hash] of Object.entries(result.files)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe('verifyThemeIntegrity', () => {
    let tempDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tempDirs) {
        await fs.rm(dir, { recursive: true, force: true });
      }
      tempDirs = [];
    });

    it('verification passes for unchanged files', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);
      const result = await verifyThemeIntegrity(dir, manifest.files);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.checked.length).toBeGreaterThan(0);
      }
    });

    it('verification fails for modified files', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);

      // Modify a file after generating the manifest
      await fs.writeFile(path.join(dir, 'manifest.json'), '{"tampered": true}');

      const result = await verifyThemeIntegrity(dir, manifest.files);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.mismatches).toContain('manifest.json');
        expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true);
      }
    });

    it('detects missing files', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);

      // Delete a file after generating the manifest
      await fs.unlink(path.join(dir, 'icon.png'));

      const result = await verifyThemeIntegrity(dir, manifest.files);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.missing).toContain('icon.png');
      }
    });

    it('detects extra files not in the expected hashes', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);

      // Add a new file after generating the manifest
      await fs.writeFile(path.join(dir, 'suspicious.js'), 'console.log("injected")');

      const result = await verifyThemeIntegrity(dir, manifest.files);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.extra).toContain('suspicious.js');
      }
    });

    it('returns correct error count for multiple issues', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);

      // Create multiple issues: modify one, delete one, add one
      await fs.writeFile(path.join(dir, 'manifest.json'), '{"tampered": true}');
      await fs.unlink(path.join(dir, 'preview.png'));
      await fs.writeFile(path.join(dir, 'extra.txt'), 'unexpected');

      const result = await verifyThemeIntegrity(dir, manifest.files);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.mismatches.length).toBeGreaterThanOrEqual(1);
        expect(result.missing.length).toBeGreaterThanOrEqual(1);
        expect(result.extra.length).toBeGreaterThanOrEqual(1);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('handles empty expected hashes (finds all files as extra)', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const result = await verifyThemeIntegrity(dir, {});

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.missing).toHaveLength(0);
        expect(result.mismatches).toHaveLength(0);
        expect(result.extra.length).toBeGreaterThan(0);
      }
    });

    it('produces stable results across multiple verify calls', async () => {
      const dir = await createThemePackage();
      tempDirs.push(dir);

      const manifest = await calculateThemeIntegrity(dir);

      const result1 = await verifyThemeIntegrity(dir, manifest.files);
      const result2 = await verifyThemeIntegrity(dir, manifest.files);

      expect(result1).toEqual(result2);
    });
  });
});
