// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for `convertThemePackage` — verifies it produces a valid v1
 * `.agentskin-theme` package (format, schemaVersion, theme, targets, assets)
 * that passes `validateThemePackage`.
 *
 * Strategy: mock the `extractThemeZip` function to return a pre-created
 * temp directory containing theme.json + theme.css + hero.png, avoiding
 * the complexity of mocking yauzl's async streaming directly.
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

const { mockExtract, mockCleanup } = vi.hoisted(() => ({
  mockExtract: vi.fn(),
  mockCleanup: vi.fn(),
}));

vi.mock('../../src/main/community/community-zip-extractor', () => ({
  extractThemeZip: mockExtract,
  cleanupExtractDir: mockCleanup,
}));

vi.mock('../../src/main/logger', () => ({
  mainError: vi.fn(),
  mainWarn: vi.fn(),
  mainInfo: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

import { convertThemePackage } from '../../src/main/community/community-theme-converter';
import type { CommunityTheme } from '../../src/shared/types/community';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid CommunityTheme metadata for converter input. */
function createMockMetadata(): CommunityTheme {
  return {
    themeId: 'ver_test123',
    slug: 'test-theme',
    name: 'Test Theme',
    author: { displayName: 'TestAuthor' },
    version: '1.0.0',
    downloads: 100,
    rating: 4.5,
    tags: [],
    description: 'A test theme',
    previewUrl: 'https://example.com/preview.png',
    updatedAt: '2025-01-01',
    packageName: 'test-theme',
    packageSize: 1024,
    packageSha256: '',
  };
}

/**
 * Create a temp directory with theme.json + theme.css + hero.png
 * (simulating what extractThemeZip would produce).
 */
function createMockExtractedTheme(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-converter-'));

  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({
      name: 'Test Theme',
      image: 'hero.png',
      css: 'theme.css',
      colors: { accent: '#ff0000' },
    }),
    'utf-8',
  );

  fs.writeFileSync(path.join(dir, 'theme.css'), 'body { background: #000; }', 'utf-8');

  // 1x1 transparent PNG
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  fs.writeFileSync(path.join(dir, 'hero.png'), Buffer.from(pngBase64, 'base64'));

  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('convertThemePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a valid v1 agentskin-theme package JSON', async () => {
    const extractDir = createMockExtractedTheme();
    // extractThemeZip returns: { extractDir, themeRoot }
    // themeRoot is the dir containing theme.json (same as extractDir here)
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    try {
      const result = await convertThemePackage(dummyZip, createMockMetadata());

      // Parse the output as JSON
      const parsed = JSON.parse(result.manifestJson);

      // Verify v1 format markers
      expect(parsed.format).toBe('agentskin-theme');
      expect(parsed.schemaVersion).toBe(1);

      // Verify theme section
      expect(parsed.theme.id).toMatch(/^community-/);
      expect(parsed.theme.displayName).toBe('Test Theme');
      expect(parsed.theme.version).toBe('1.0.0');
      expect(parsed.theme.catalog.categories).toContain('community');

      // Verify targets (all 6 agents have inline CSS)
      for (const agent of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
        expect(parsed.targets[agent]).toBeDefined();
        expect(typeof parsed.targets[agent].css).toBe('string');
        expect(parsed.targets[agent].css).toContain('background: #000');
      }

      // Verify assets (hero image inlined as base64)
      expect(parsed.assets.images.hero).toBeDefined();
      expect(parsed.assets.images.hero.filename).toBe('hero.png');
      expect(parsed.assets.images.hero.mimeType).toBe('image/png');
      expect(parsed.assets.images.hero.base64).toBe(
        Buffer.from(fs.readFileSync(path.join(extractDir, 'hero.png'))).toString('base64'),
      );

      // Verify colors exist
      expect(result.colors).toBeDefined();
      expect(typeof result.colors).toBe('object');
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('passes validateThemePackage when parsed', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    // Import the engine validator
    const { validateThemePackage } = await import('../../src/engine/src/theme/package.mjs');

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    try {
      const result = await convertThemePackage(dummyZip, createMockMetadata());
      const parsed = JSON.parse(result.manifestJson);

      // This should NOT throw — the package must be valid v1
      expect(() => validateThemePackage(parsed)).not.toThrow();
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('cleans up extraction directory via cleanupExtractDir in finally block', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    await convertThemePackage(dummyZip, createMockMetadata());

    // The converter's finally block should call cleanupExtractDir with the extractDir
    expect(mockCleanup).toHaveBeenCalledWith(extractDir);
  });
});
