// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for `convertThemePackage` — verifies it produces a valid v1
 * single-file `agentskin-theme` bundle (schemaVersion: 1 nested manifest,
 * per-agent inline CSS targets, base64 image assets) that passes the
 * engine's `validateThemePackage` gate.
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
    author: { id: 'author-1', displayName: 'TestAuthor' },
    version: '1.0.0',
    downloads: 100,
    rating: 4.5,
    tags: ['dark', 'gradient'],
    description: 'A test theme',
    updatedAt: '2025-01-01',
    packageSha256: '',
    screenshots: [],
    targetAgents: ['traework'],
    displayMeta: {
      appearance: 'dark',
      colors: {
        accent: '#ff0000',
        background: '#1a1a2e',
        text: '#eaeaea',
        panel: '#16213e',
        secondary: '#e94560',
        muted: '#6b7280',
        panelAlt: '#0f3460',
        line: '#374151',
      },
    },
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
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRkJggg==';
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

  it('produces a valid v1 single-file agentskin-theme bundle', async () => {
    const extractDir = createMockExtractedTheme();
    // extractThemeZip returns: { extractDir, themeRoot }
    // themeRoot is the dir containing theme.json (same as extractDir here)
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    const result = await convertThemePackage(dummyZip, createMockMetadata());

    // v1 bundles are in-memory JSON — no package directory is written to disk
    expect(result.packageDir).toBe('');

    // Parse the manifest from the returned JSON string
    const parsed = JSON.parse(result.manifestJson);

    // Verify v1 format markers
    expect(parsed.format).toBe('agentskin-theme');
    expect(parsed.schemaVersion).toBe(1);

    // Verify nested theme structure (v1 carries metadata under theme.copy)
    expect(parsed.theme.id).toMatch(/^community-/);
    expect(parsed.theme.displayName).toBe('Test Theme');
    expect(parsed.theme.version).toBe('1.0.0');

    // Verify author auto-fill
    expect(parsed.theme.copy.author).toEqual({ name: 'TestAuthor' });

    // Verify mode derived from displayMeta
    expect(parsed.theme.copy.mode).toBe('dark');

    // Verify category and tags
    expect(parsed.theme.copy.category).toBe('community');
    expect(parsed.theme.copy.tags).toContain('community');
    expect(parsed.theme.copy.tags).toContain('dark');
    expect(parsed.theme.copy.tags).toContain('gradient');

    // Verify hero/icon/preview image assets are embedded as base64
    expect(parsed.assets.images.hero.filename).toBe('hero.png');
    expect(parsed.assets.images.hero.mimeType).toBe('image/png');
    expect(typeof parsed.assets.images.hero.base64).toBe('string');
    expect(parsed.assets.images.icon.filename).toBe('icon.png');
    expect(parsed.assets.images.preview.filename).toBe('preview.png');

    // Verify targets carry inline CSS content (not file paths)
    for (const agent of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
      expect(typeof parsed.targets[agent].css).toBe('string');
      expect(parsed.targets[agent].css).toContain('background: #000');
    }

    // Verify supportedAgents
    expect(parsed.theme.copy.supportedAgents).toEqual([
      'traework',
      'qoderwork',
      'workbuddy',
      'doubao',
      'codex',
      'zcode',
    ]);

    // Verify license auto-fill
    expect(parsed.theme.copy.license).toBe('CC-BY-NC-SA-4.0');

    // Verify unofficial flag
    expect(parsed.theme.copy.unofficial).toBe(true);

    // Verify colors (14-token system)
    expect(parsed.theme.copy.colors).toBeDefined();
    expect(parsed.theme.copy.colors.background).toBeDefined();
    expect(parsed.theme.copy.colors.foreground).toBeDefined();
    expect(parsed.theme.copy.colors.accent).toBeDefined();

    // Verify colors in result
    expect(result.colors).toBeDefined();
    expect(typeof result.colors).toBe('object');

    // Verify themeId
    expect(result.themeId).toMatch(/^community-/);

    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('passes the engine validateThemePackage gate when parsed', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    // Import the engine's v1 bundle validator (authoritative gate — the same
    // check ThemeLibrary.installFile / readTheme run on install)
    const { validateThemePackage } = await import('../../src/engine/src/theme/package.mjs');

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    try {
      const result = await convertThemePackage(dummyZip, createMockMetadata());
      const parsed = JSON.parse(result.manifestJson);

      // Must parse through the engine gate without throwing — v1 bundles are
      // all-or-nothing validated (no error list like the old v2 validator)
      expect(() => validateThemePackage(parsed)).not.toThrow();
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('auto-fills author and license when missing', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    // Metadata without author
    const metadataNoAuthor: CommunityTheme = {
      ...createMockMetadata(),
      author: { id: 'anon', displayName: '' },
    };

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    try {
      const result = await convertThemePackage(dummyZip, metadataNoAuthor);
      const parsed = JSON.parse(result.manifestJson);

      // Author should be auto-filled with default
      expect(parsed.theme.copy.author).toEqual({ name: 'DreamSkin Community' });

      // License should be auto-filled
      expect(parsed.theme.copy.license).toBe('CC-BY-NC-SA-4.0');
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('preserves original image format (jpg stays jpg)', async () => {
    const extractDir = createMockExtractedTheme();
    // Overwrite hero.png with a .jpg file to test format preservation
    const jpgBase64 =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=';
    fs.writeFileSync(path.join(extractDir, 'hero.jpg'), Buffer.from(jpgBase64, 'base64'));

    // Update theme.json to reference hero.jpg
    fs.writeFileSync(
      path.join(extractDir, 'theme.json'),
      JSON.stringify({
        name: 'Test Theme',
        image: 'hero.jpg',
        css: 'theme.css',
      }),
      'utf-8',
    );

    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    try {
      const result = await convertThemePackage(dummyZip, createMockMetadata());
      const parsed = JSON.parse(result.manifestJson);

      // Hero asset should keep the .jpg filename and jpeg mime type
      expect(parsed.assets.images.hero.filename).toBe('hero.jpg');
      expect(parsed.assets.images.hero.mimeType).toBe('image/jpeg');
      expect(typeof parsed.assets.images.hero.base64).toBe('string');
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('cleans up extraction directory via cleanupExtractDir in finally block', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    const result = await convertThemePackage(dummyZip, createMockMetadata());

    // The converter's finally block should call cleanupExtractDir with the extractDir
    expect(mockCleanup).toHaveBeenCalledWith(extractDir);
  });

  it('cleans up package directory on conversion error', async () => {
    const extractDir = createMockExtractedTheme();
    // Make theme.json invalid to trigger a parse error
    fs.writeFileSync(path.join(extractDir, 'theme.json'), 'not valid json', 'utf-8');
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    await expect(convertThemePackage(dummyZip, createMockMetadata())).rejects.toThrow();

    // cleanupExtractDir should have been called for both extractDir and packageDir
    expect(mockCleanup).toHaveBeenCalledWith(extractDir);
  });
});
