// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILD_FINGERPRINT_VERSION,
  computeFileHash,
  FINGERPRINT_FILENAME,
  generateBuildFingerprint,
  getFileSize,
  SUPPORTED_AGENT_IDS,
  verifyBuildFingerprint,
} from './theme-build-fingerprint';

const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Create a minimal theme package directory with manifest + agent CSS files. */
async function createThemePackage(
  themeId: string,
  agents: string[],
  extraFiles?: Record<string, string>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fp-test-'));
  await fs.mkdir(path.join(dir, 'assets', 'css'), { recursive: true });

  const manifest = {
    id: themeId,
    name: `Test ${themeId}`,
    version: '1.0.0',
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
    targets: Object.fromEntries(agents.map((a) => [a, { css: `assets/css/${a}.css` }])),
  };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  for (const agent of agents) {
    await fs.writeFile(
      path.join(dir, 'assets', 'css', `${agent}.css`),
      `/* ${agent} theme CSS */\n:root { --test: 1; }\n`,
    );
  }

  await fs.writeFile(path.join(dir, 'icon.png'), Buffer.from(PLACEHOLDER_PNG, 'base64'));
  await fs.writeFile(path.join(dir, 'preview.png'), Buffer.from(PLACEHOLDER_PNG, 'base64'));

  if (extraFiles) {
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const fullPath = path.join(dir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  }

  return dir;
}

describe('theme-build-fingerprint', () => {
  describe('computeFileHash', () => {
    it('returns a sha256 hex string for an existing file', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-test-'));
      const filePath = path.join(dir, 'test.txt');
      await fs.writeFile(filePath, 'hello world');

      const hash = await computeFileHash(filePath);
      expect(hash).toBeTruthy();
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns null for a missing file', async () => {
      const hash = await computeFileHash('/nonexistent/file.txt');
      expect(hash).toBeNull();
    });
  });

  describe('getFileSize', () => {
    it('returns the file size in bytes', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'size-test-'));
      const filePath = path.join(dir, 'test.txt');
      await fs.writeFile(filePath, 'hello world');

      const size = await getFileSize(filePath);
      expect(size).toBe(11);

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns null for a missing file', async () => {
      const size = await getFileSize('/nonexistent/file.txt');
      expect(size).toBeNull();
    });
  });

  describe('generateBuildFingerprint', () => {
    let pkgDir: string;

    afterEach(async () => {
      await fs.rm(pkgDir, { recursive: true, force: true });
    });

    it('generates a fingerprint covering manifest.json and agent CSS files', async () => {
      pkgDir = await createThemePackage('test-theme', ['traework', 'codex']);

      const fingerprint = await generateBuildFingerprint(pkgDir);

      expect(fingerprint.version).toBe(BUILD_FINGERPRINT_VERSION);
      expect(fingerprint.algorithm).toBe('sha256');
      expect(fingerprint.files['manifest.json']).toBeDefined();
      expect(fingerprint.files['assets/css/traework.css']).toBeDefined();
      expect(fingerprint.files['assets/css/codex.css']).toBeDefined();
      expect(typeof fingerprint.createdAt).toBe('string');
      expect(new Date(fingerprint.createdAt).getTime()).not.toBeNaN();
    });

    it('only includes CSS files for supported agents that exist on disk', async () => {
      pkgDir = await createThemePackage('partial-theme', ['workbuddy']);

      const fingerprint = await generateBuildFingerprint(pkgDir);

      // Only workbuddy.css should be present (not all 6 agents)
      const cssEntries = Object.keys(fingerprint.files).filter((k) => k.startsWith('assets/css/'));
      expect(cssEntries).toEqual(['assets/css/workbuddy.css']);
      expect(fingerprint.files['manifest.json']).toBeDefined();
    });

    it('records file sizes alongside hashes', async () => {
      pkgDir = await createThemePackage('size-theme', ['zcode']);

      const fingerprint = await generateBuildFingerprint(pkgDir);
      const manifestEntry = fingerprint.files['manifest.json'];

      expect(manifestEntry.size).toBeGreaterThan(0);
      expect(manifestEntry.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces a different hash when a file changes', async () => {
      pkgDir = await createThemePackage('change-theme', ['doubao']);

      const fp1 = await generateBuildFingerprint(pkgDir);

      // Modify the CSS file
      await fs.writeFile(
        path.join(pkgDir, 'assets', 'css', 'doubao.css'),
        '/* modified */\n:root { --test: 2; }\n',
      );

      const fp2 = await generateBuildFingerprint(pkgDir);

      expect(fp1.files['assets/css/doubao.css'].hash).not.toBe(
        fp2.files['assets/css/doubao.css'].hash,
      );
    });

    it('throws when manifest.json is missing', async () => {
      pkgDir = await createThemePackage('no-manifest', ['traework']);
      await fs.unlink(path.join(pkgDir, 'manifest.json'));

      await expect(generateBuildFingerprint(pkgDir)).rejects.toThrow('manifest.json not found');
    });
  });

  describe('verifyBuildFingerprint', () => {
    let pkgDir: string;

    beforeEach(async () => {
      pkgDir = await createThemePackage('verify-theme', ['traework', 'qoderwork', 'workbuddy']);
    });

    afterEach(async () => {
      await fs.rm(pkgDir, { recursive: true, force: true });
    });

    it('returns valid=true with empty checked when no fingerprint file exists', async () => {
      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.checked).toEqual([]);
      }
    });

    it('verifies a valid fingerprint successfully', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.checked).toContain('manifest.json');
        expect(result.checked).toContain('assets/css/traework.css');
        expect(result.checked).toContain('assets/css/qoderwork.css');
        expect(result.checked).toContain('assets/css/workbuddy.css');
      }
    });

    it('detects a modified manifest.json', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      // Tamper with manifest.json
      await fs.writeFile(path.join(pkgDir, 'manifest.json'), '{"tampered": true}');

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.mismatched).toContain('manifest.json');
        expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true);
      }
    });

    it('detects a modified CSS file', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      // Tamper with a CSS file
      await fs.writeFile(path.join(pkgDir, 'assets', 'css', 'traework.css'), '/* tampered */\n');

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.mismatched).toContain('assets/css/traework.css');
      }
    });

    it('detects a missing fingerprinted file', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      // Delete a fingerprinted CSS file
      await fs.unlink(path.join(pkgDir, 'assets', 'css', 'workbuddy.css'));

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.missing).toContain('assets/css/workbuddy.css');
      }
    });

    it('detects an extra CSS file not in the fingerprint', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      // Add an agent CSS file that wasn't in the original fingerprint
      await fs.writeFile(path.join(pkgDir, 'assets', 'css', 'codex.css'), '/* injected */\n');

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.extra).toContain('assets/css/codex.css');
        expect(result.errors.some((e) => e.includes('unexpected CSS file'))).toBe(true);
      }
    });

    it('returns invalid for malformed fingerprint JSON', async () => {
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), '{not valid json');

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('not valid JSON');
      }
    });

    it('returns invalid for unsupported schema version', async () => {
      await fs.writeFile(
        path.join(pkgDir, FINGERPRINT_FILENAME),
        JSON.stringify({
          version: 999,
          algorithm: 'sha256',
          files: {},
          createdAt: new Date().toISOString(),
        }),
      );

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('unsupported schema');
      }
    });

    it('reports multiple failures at once', async () => {
      const fingerprint = await generateBuildFingerprint(pkgDir);
      await fs.writeFile(path.join(pkgDir, FINGERPRINT_FILENAME), JSON.stringify(fingerprint));

      // Tamper with manifest + delete a CSS + add an extra CSS
      await fs.writeFile(path.join(pkgDir, 'manifest.json'), '{"tampered": true}');
      await fs.unlink(path.join(pkgDir, 'assets', 'css', 'workbuddy.css'));
      await fs.writeFile(path.join(pkgDir, 'assets', 'css', 'codex.css'), '/* extra */\n');

      const result = await verifyBuildFingerprint(pkgDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.mismatched).toContain('manifest.json');
        expect(result.missing).toContain('assets/css/workbuddy.css');
        expect(result.extra).toContain('assets/css/codex.css');
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('SUPPORTED_AGENT_IDS', () => {
    it('contains exactly the 6 supported adapters', () => {
      expect(SUPPORTED_AGENT_IDS).toHaveLength(6);
      expect([...SUPPORTED_AGENT_IDS].sort()).toEqual([
        'codex',
        'doubao',
        'qoderwork',
        'traework',
        'workbuddy',
        'zcode',
      ]);
    });
  });
});
