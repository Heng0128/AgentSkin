// SPDX-License-Identifier: MPL-2.0

/**
 * theme-sha256sums.mjs — 10 tests
 *
 * Covers: SHA256SUMS.txt generation, format compatibility, file coverage,
 * write to disk, verification (valid/tampered/missing/extra), and parse.
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateSha256Sums,
  parseSha256Sums,
  SHA256SUMS_FILENAME,
  verifySha256Sums,
  writeSha256Sums,
} from '../../../scripts/lib/theme-sha256sums.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `sha256sums-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Create a minimal theme package with manifest, CSS, and images. */
function createThemePackage(dir: string, extraFiles?: Record<string, string>) {
  mkdirSync(join(dir, 'assets', 'css'), { recursive: true });
  mkdirSync(join(dir, 'assets', 'images'), { recursive: true });

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
      mode: 'dark',
      colors: { accent: '#7c9cff', background: '#13171a' },
      targets: { workbuddy: { css: 'assets/css/workbuddy.css' } },
    }),
    'utf8',
  );

  writeFileSync(
    join(dir, 'assets', 'css', 'workbuddy.css'),
    ':root { --agentskin-accent: #7c9cff; }\n',
    'utf8',
  );

  writeFileSync(join(dir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  if (extraFiles) {
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const fullPath = join(dir, relPath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
}

// ---------------------------------------------------------------------------
// generateSha256Sums
// ---------------------------------------------------------------------------

describe('generateSha256Sums', () => {
  it('generates correct format: <64-char-hash>  <relative-path>', () => {
    createThemePackage(testDir);
    const { content, files } = generateSha256Sums(testDir);

    expect(files.length).toBeGreaterThan(0);
    const lines = content.split('\n');
    expect(lines.length).toBe(files.length);

    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}.+$/);
    }
  });

  it('covers all files recursively (manifest, CSS, images)', () => {
    createThemePackage(testDir);
    const { files } = generateSha256Sums(testDir);

    expect(files).toContain('manifest.json');
    expect(files).toContain('assets/css/workbuddy.css');
    expect(files).toContain('icon.png');
    expect(files).toContain('preview.png');
  });

  it('excludes SHA256SUMS.txt itself from the hash list', () => {
    createThemePackage(testDir);
    // Pre-write a SHA256SUMS.txt to test self-exclusion
    writeFileSync(join(testDir, SHA256SUMS_FILENAME), 'dummy content\n');

    const { files } = generateSha256Sums(testDir);
    expect(files).not.toContain(SHA256SUMS_FILENAME);
  });

  it('produces deterministic output (same files = same hashes)', () => {
    createThemePackage(testDir);
    const result1 = generateSha256Sums(testDir);
    const result2 = generateSha256Sums(testDir);

    expect(result1.content).toBe(result2.content);
    expect(result1.files).toEqual(result2.files);
  });

  it('produces different output when a file changes', () => {
    createThemePackage(testDir);
    const result1 = generateSha256Sums(testDir);

    // Modify a file
    writeFileSync(
      join(testDir, 'assets', 'css', 'workbuddy.css'),
      ':root { --agentskin-accent: #ff0000; }\n',
    );

    const result2 = generateSha256Sums(testDir);
    expect(result1.content).not.toBe(result2.content);
  });

  it('includes nested directory files', () => {
    createThemePackage(testDir, {
      'assets/images/hero.png': 'fake-hero-image',
      'README.md': '# Test Theme',
    });

    const { files } = generateSha256Sums(testDir);
    expect(files).toContain('assets/images/hero.png');
    expect(files).toContain('README.md');
  });
});

// ---------------------------------------------------------------------------
// writeSha256Sums
// ---------------------------------------------------------------------------

describe('writeSha256Sums', () => {
  it('writes SHA256SUMS.txt to disk with trailing newline', () => {
    createThemePackage(testDir);
    const outputPath = writeSha256Sums(testDir);

    expect(outputPath).toBe(join(testDir, SHA256SUMS_FILENAME));

    const stat = statSync(outputPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);

    const content = readFileSync(outputPath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('written file is parseable and verifiable', () => {
    createThemePackage(testDir);
    writeSha256Sums(testDir);

    const result = verifySha256Sums(testDir);
    expect(result.valid).toBe(true);
    expect(result.checked.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// verifySha256Sums
// ---------------------------------------------------------------------------

describe('verifySha256Sums', () => {
  it('detects a modified file', () => {
    createThemePackage(testDir);
    writeSha256Sums(testDir);

    // Tamper with a file
    writeFileSync(join(testDir, 'manifest.json'), '{"tampered": true}');

    const result = verifySha256Sums(testDir);
    expect(result.valid).toBe(false);
    expect(result.mismatched).toContain('manifest.json');
    expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true);
  });

  it('detects a missing file', () => {
    createThemePackage(testDir);
    writeSha256Sums(testDir);

    // Delete a file that was hashed
    rmSync(join(testDir, 'icon.png'));

    const result = verifySha256Sums(testDir);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('icon.png');
  });

  it('detects an extra file not in the sums', () => {
    createThemePackage(testDir);
    writeSha256Sums(testDir);

    // Add a new file after generating sums
    writeFileSync(join(testDir, 'injected.css'), '/* injected */\n');

    const result = verifySha256Sums(testDir);
    expect(result.valid).toBe(false);
    expect(result.extra).toContain('injected.css');
  });

  it('returns invalid when SHA256SUMS.txt is missing', () => {
    createThemePackage(testDir);
    // Do NOT write SHA256SUMS.txt

    const result = verifySha256Sums(testDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(SHA256SUMS_FILENAME);
  });
});

// ---------------------------------------------------------------------------
// parseSha256Sums
// ---------------------------------------------------------------------------

describe('parseSha256Sums', () => {
  it('parses valid SHA256SUMS content correctly', () => {
    createThemePackage(testDir);
    const { content } = generateSha256Sums(testDir);
    const map = parseSha256Sums(content);

    expect(map.size).toBeGreaterThan(0);
    expect(map.has('manifest.json')).toBe(true);
    for (const [, hash] of map) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
