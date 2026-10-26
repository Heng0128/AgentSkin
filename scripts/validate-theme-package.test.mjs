// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme-package.test.mjs
 *
 * Tests for the theme package quality gate module.
 * Uses Node.js built-in test framework (node:test).
 *
 * Coverage:
 *   1. Normal builtin theme passes validation
 *   2. CSS reference to non-existent file reports error
 *   3. Exceeding payload budget reports error
 *   4. Missing manifest fields report error
 *   5. PNG with alpha channel passes detection
 *   6. Skips .agentskin-theme bundle directory
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.resolve(__dirname, '..', 'themes');

const { validateThemePackage, checkPngAlpha, validateManifest, detectThemeSource } = await import(
  './validate-theme-package.mjs'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for test fixtures. */
async function createTempDir() {
  return mkdtemp(joinSafe(tmpdir(), 'vtp-test-'));
}

/** Platform-safe path join (Node's path.join handles both separators). */
function joinSafe(...parts) {
  return path.join(...parts);
}

/** Write a minimal manifest.json to a directory. */
async function writeManifest(dir, overrides = {}) {
  const manifest = {
    schemaVersion: 2,
    id: 'test-theme',
    name: 'Test Theme',
    author: { name: 'Test Author' },
    version: '1.0.0',
    colors: { accent: '#ff0000', background: '#000000', foreground: '#ffffff' },
    ...overrides,
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Minimal valid PNG with RGBA (color type 6). */
function makePngWithAlpha() {
  // PNG signature (8) + IHDR chunk (25 bytes total: 4 len + 4 type + 13 data + 4 CRC)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  // Fake CRC (4 bytes)
  const crc = Buffer.alloc(4);
  return Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, crc]);
}

/** Minimal valid PNG without alpha (color type 2 = RGB). */
function _makePngWithoutAlpha() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2; // color type: RGB (no alpha)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const crc = Buffer.alloc(4);
  return Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, crc]);
}

// ---------------------------------------------------------------------------
// Test fixtures (cleanup after all tests)
// ---------------------------------------------------------------------------

const tempDirs = [];

async function setupTheme(overrides = {}) {
  const dir = await createTempDir();
  tempDirs.push(dir);
  await writeManifest(dir, overrides);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validate-theme-package', () => {
  it('1. normal builtin theme passes validation', async () => {
    const themeDir = path.join(THEMES_DIR, 'academy-corridor-winter');
    const result = await validateThemePackage(themeDir);
    assert.equal(result.themeId, 'academy-corridor-winter');
    assert.equal(result.source, 'builtin');
    assert.equal(result.pass, true, `Expected pass but got errors: ${result.errors.join(', ')}`);
    assert.equal(result.errors.length, 0);
    assert.ok(result.stats.totalSizeBytes > 0);
    assert.ok(result.stats.cssFileCount > 0);
  });

  it('2. CSS reference to non-existent file reports error', async () => {
    const dir = await setupTheme();
    await mkdir(path.join(dir, 'assets', 'css'), { recursive: true });
    await writeFile(
      path.join(dir, 'assets', 'css', 'traework.css'),
      'body { background: url(../images/missing.png); }\n',
    );
    const result = await validateThemePackage(dir);
    assert.equal(result.pass, false);
    assert.ok(
      result.errors.some((e) => e.includes('does not resolve')),
      `Expected CSS reference error, got: ${result.errors.join(', ')}`,
    );
  });

  it('3. exceeding payload budget reports error', async () => {
    const dir = await setupTheme({
      id: 'community-bloat',
      author: { name: 'External' },
      tags: ['community'],
    });
    // Write a file that pushes over 20 MB budget
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024); // 21 MB
    await writeFile(path.join(dir, 'huge-asset.bin'), bigBuffer);
    const result = await validateThemePackage(dir);
    assert.equal(result.pass, false);
    assert.ok(
      result.errors.some((e) => e.includes('payload') && e.includes('exceeds')),
      `Expected payload budget error, got: ${result.errors.join(', ')}`,
    );
  });

  it('4. missing manifest fields report error', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    // Write manifest missing required fields
    const brokenManifest = { id: 'broken', name: 'Broken' };
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(brokenManifest));
    const result = await validateThemePackage(dir);
    assert.equal(result.pass, false);
    assert.ok(
      result.errors.some((e) => e.includes('missing required field')),
      `Expected missing field error, got: ${result.errors.join(', ')}`,
    );
  });

  it('5. PNG with alpha channel passes detection', async () => {
    const pngPath = path.join(await createTempDir(), 'icon.png');
    tempDirs.push(path.dirname(pngPath));
    await writeFile(pngPath, makePngWithAlpha());
    const result = await checkPngAlpha(pngPath);
    assert.equal(result.hasAlpha, true);
    assert.equal(result.colorType, 6);
  });

  it('6. skips .agentskin-theme bundle directory', async () => {
    const dir = await setupTheme();
    // Create a .agentskin-theme subdirectory with files that would inflate size
    const bundleDir = path.join(dir, 'test-theme.agentskin-theme');
    await mkdir(path.join(bundleDir, 'assets', 'images'), { recursive: true });
    await writeFile(path.join(bundleDir, 'bundle-data.bin'), Buffer.alloc(2048));
    await writeFile(path.join(bundleDir, 'assets', 'images', 'faked.png'), Buffer.alloc(1024));
    // Also create a normal file outside bundle
    await writeFile(path.join(dir, 'normal-file.txt'), 'hi');
    const result = await validateThemePackage(dir);
    // The bundle files (2048 + 1024 = 3072 bytes) must NOT be counted.
    // Only manifest.json (~150 bytes) + normal-file.txt (2 bytes) should count.
    assert.ok(
      result.stats.totalSizeBytes < 1024,
      `Expected totalSizeBytes < 1024 (bundle excluded), got ${result.stats.totalSizeBytes}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Additional edge tests
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    const result = validateManifest(
      {
        schemaVersion: 2,
        id: 'test',
        name: 'Test',
        author: { name: 'A' },
        version: '1.0.0',
        colors: { accent: '#abc' },
      },
      'test',
    );
    assert.equal(result.errors.length, 0);
  });

  it('rejects invalid schemaVersion', () => {
    const result = validateManifest(
      {
        schemaVersion: 1,
        id: 'test',
        name: 'Test',
        author: { name: 'A' },
        version: '1.0.0',
        colors: { accent: '#abc' },
      },
      'test',
    );
    assert.ok(result.errors.some((e) => e.includes('schemaVersion')));
  });

  it('rejects invalid hex color', () => {
    const result = validateManifest(
      {
        schemaVersion: 2,
        id: 'test',
        name: 'Test',
        author: { name: 'A' },
        version: '1.0.0',
        colors: { accent: 'not-a-color' },
      },
      'test',
    );
    assert.ok(result.errors.some((e) => e.includes('accent')));
  });

  it('accepts 3-digit hex color', () => {
    const result = validateManifest(
      {
        schemaVersion: 2,
        id: 'test',
        name: 'Test',
        author: { name: 'A' },
        version: '1.0.0',
        colors: { accent: '#f00' },
      },
      'test',
    );
    assert.equal(result.errors.length, 0);
  });
});

describe('detectThemeSource', () => {
  it('detects builtin by id', () => {
    assert.equal(
      detectThemeSource('/themes/academy-corridor-winter', { id: 'academy-corridor-winter' }),
      'builtin',
    );
  });

  it('detects community by tag', () => {
    assert.equal(detectThemeSource('/themes/community-test', { tags: ['community'] }), 'community');
  });

  it('detects community by id prefix', () => {
    assert.equal(
      detectThemeSource('/themes/community-test', { id: 'community-test' }),
      'community',
    );
  });

  it('falls back to imported', () => {
    assert.equal(detectThemeSource('/themes/unknown', { id: 'unknown' }), 'imported');
  });
});
