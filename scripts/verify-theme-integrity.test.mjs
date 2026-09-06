// SPDX-License-Identifier: MPL-2.0
//
// Tests for verify-theme-integrity.mjs — Theme package integrity CLI
//
// Covers: generate, verify (valid/invalid/missing), verify-all batch.
// Uses node:fs mkdtemp for isolated temporary directories.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateSha256Sums,
  SHA256SUMS_FILENAME,
  verifySha256Sums,
} from './lib/theme-sha256sums.mjs';

/**
 * Ensure a directory path exists (recursive mkdir).
 *
 * @param {string} dir - Directory path to create.
 */
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Create a temporary directory with sample theme files.
 *
 * @param {Record<string, string>} files - Map of relative path to content string.
 * @returns {{ dir: string, cleanup: () => void }} Temp dir path and cleanup function.
 */
function createTempTheme(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agentskin-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    const parentDir = join(fullPath, '..');
    ensureDir(parentDir);
    writeFileSync(fullPath, content, 'utf8');
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Tests: generate
// ---------------------------------------------------------------------------

describe('generateSha256Sums', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': '{"name":"test-theme","version":"1.0.0"}',
      'palette.css': ':root { --color-bg: #fff; }',
      'assets/css/traework.css': 'body { background: white; }',
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns content with correct sha256sum format', () => {
    const { content, files } = generateSha256Sums(tempDir);

    expect(files).toHaveLength(3);
    expect(files).toContain('manifest.json');
    expect(files).toContain('palette.css');
    expect(files).toContain('assets/css/traework.css');

    const lines = content.split('\n');
    expect(lines).toHaveLength(3);
    // Format: <64-char-hex>  <filepath>
    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}.+$/);
    }
  });

  it('does not include SHA256SUMS.txt in the output', () => {
    // Pre-write a SHA256SUMS.txt
    writeFileSync(join(tempDir, SHA256SUMS_FILENAME), 'old-content\n', 'utf8');

    const { files } = generateSha256Sums(tempDir);
    expect(files).not.toContain(SHA256SUMS_FILENAME);
    expect(files).toHaveLength(3); // original 3 files, not the sums file
  });
});

// ---------------------------------------------------------------------------
// Tests: verify
// ---------------------------------------------------------------------------

describe('verifySha256Sums', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': '{"name":"test-theme","version":"1.0.0"}',
      'palette.css': ':root { --color-bg: #fff; }',
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns valid when checksums match', () => {
    // Generate checksums first
    const { content } = generateSha256Sums(tempDir);
    writeFileSync(join(tempDir, SHA256SUMS_FILENAME), `${content}\n`, 'utf8');

    const result = verifySha256Sums(tempDir);
    expect(result.valid).toBe(true);
    expect(result.checked).toHaveLength(2);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
    expect(result.mismatched).toHaveLength(0);
  });

  it('returns invalid when a file is modified', () => {
    const { content } = generateSha256Sums(tempDir);
    writeFileSync(join(tempDir, SHA256SUMS_FILENAME), `${content}\n`, 'utf8');

    // Modify a file after generating checksums
    writeFileSync(join(tempDir, 'manifest.json'), '{"name":"tampered","version":"2.0.0"}', 'utf8');

    const result = verifySha256Sums(tempDir);
    expect(result.valid).toBe(false);
    expect(result.mismatched).toContain('manifest.json');
    expect(result.errors).toContain('file modified: manifest.json');
  });

  it('returns invalid when SHA256SUMS.txt is missing', () => {
    const result = verifySha256Sums(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`${SHA256SUMS_FILENAME} not found`);
  });

  it('detects extra files not listed in checksums', () => {
    const { content } = generateSha256Sums(tempDir);
    writeFileSync(join(tempDir, SHA256SUMS_FILENAME), `${content}\n`, 'utf8');

    // Add an extra file
    writeFileSync(join(tempDir, 'extra-file.txt'), 'extra content', 'utf8');

    const result = verifySha256Sums(tempDir);
    expect(result.valid).toBe(false);
    expect(result.extra).toContain('extra-file.txt');
  });
});

// ---------------------------------------------------------------------------
// Tests: simulate verify-all (multiple packages)
// ---------------------------------------------------------------------------

describe('verifySha256Sums batch (verify-all pattern)', () => {
  let dir1;
  let dir2;
  let cleanup1;
  let cleanup2;

  beforeEach(() => {
    const r1 = createTempTheme({
      'manifest.json': '{"name":"theme-a","version":"1.0.0"}',
      'style.css': 'body { color: red; }',
    });
    dir1 = r1.dir;
    cleanup1 = r1.cleanup;

    const r2 = createTempTheme({
      'manifest.json': '{"name":"theme-b","version":"2.0.0"}',
      'style.css': 'body { color: blue; }',
    });
    dir2 = r2.dir;
    cleanup2 = r2.cleanup;
  });

  afterEach(() => {
    cleanup1();
    cleanup2();
  });

  it('all valid when checksums are correct', () => {
    for (const dir of [dir1, dir2]) {
      const { content } = generateSha256Sums(dir);
      writeFileSync(join(dir, SHA256SUMS_FILENAME), `${content}\n`, 'utf8');
    }

    const result1 = verifySha256Sums(dir1);
    const result2 = verifySha256Sums(dir2);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
  });

  it('one valid, one invalid when tampered', () => {
    // Generate correct checksums for both
    const { content: c1 } = generateSha256Sums(dir1);
    writeFileSync(join(dir1, SHA256SUMS_FILENAME), `${c1}\n`, 'utf8');

    const { content: c2 } = generateSha256Sums(dir2);
    writeFileSync(join(dir2, SHA256SUMS_FILENAME), `${c2}\n`, 'utf8');

    // Tamper with theme-b
    writeFileSync(join(dir2, 'style.css'), 'body { color: green !important; }', 'utf8');

    const result1 = verifySha256Sums(dir1);
    const result2 = verifySha256Sums(dir2);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(false);
    expect(result2.mismatched).toContain('style.css');
  });

  it('missing SHA256SUMS.txt in one package', () => {
    // Only generate checksums for dir1
    const { content: c1 } = generateSha256Sums(dir1);
    writeFileSync(join(dir1, SHA256SUMS_FILENAME), `${c1}\n`, 'utf8');
    // dir2 has no SHA256SUMS.txt

    const result1 = verifySha256Sums(dir1);
    const result2 = verifySha256Sums(dir2);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(false);
    expect(result2.errors).toContain(`${SHA256SUMS_FILENAME} not found`);
  });
});
