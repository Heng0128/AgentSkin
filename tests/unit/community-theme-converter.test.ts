// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for `convertThemePackage` — verifies it produces a valid v2
 * directory-based theme package (schemaVersion: 2 flat manifest, per-agent
 * CSS files, hero image file) that passes `validateManifest`.
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

  it('produces a valid v2 directory-based package', async () => {
    const extractDir = createMockExtractedTheme();
    // extractThemeZip returns: { extractDir, themeRoot }
    // themeRoot is the dir containing theme.json (same as extractDir here)
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    let result;
    try {
      result = await convertThemePackage(dummyZip, createMockMetadata());

      // Verify the package directory exists and has the expected structure
      expect(fs.existsSync(result.packageDir)).toBe(true);
      expect(fs.existsSync(path.join(result.packageDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(result.packageDir, 'assets', 'css'))).toBe(true);
      expect(fs.existsSync(path.join(result.packageDir, 'assets', 'images'))).toBe(true);

      // Parse the manifest.json from disk
      const manifestJson = fs.readFileSync(path.join(result.packageDir, 'manifest.json'), 'utf-8');
      const parsed = JSON.parse(manifestJson);

      // Verify v2 format markers
      expect(parsed.$schema).toBe('https://agentskin.dev/schema/manifest-v2.json');
      expect(parsed.schemaVersion).toBe(2);

      // Verify flat structure (no nested "theme" wrapper)
      expect(parsed.id).toMatch(/^community-/);
      expect(parsed.name).toMatch(/^community-/);
      expect(parsed.displayName).toBe('Test Theme');
      expect(parsed.version).toBe('1.0.0');

      // Verify author auto-fill
      expect(parsed.author).toEqual({ name: 'TestAuthor' });

      // Verify mode derived from displayMeta
      expect(parsed.mode).toBe('dark');

      // Verify category and tags
      expect(parsed.category).toBe('community');
      expect(parsed.tags).toContain('community');
      expect(parsed.tags).toContain('dark');
      expect(parsed.tags).toContain('gradient');

      // Verify hero image reference (file path, not base64)
      expect(parsed.hero).toBe('assets/images/hero.png');
      // icon and preview are flat filenames (schema pattern forbids path separators)
      expect(parsed.icon).toBe('icon.png');
      expect(parsed.preview).toBe('preview.png');

      // Verify targets reference CSS file paths (not inline CSS)
      for (const agent of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
        expect(parsed.targets[agent]).toBeDefined();
        expect(parsed.targets[agent].css).toBe(`assets/css/${agent}.css`);
      }

      // Verify supportedAgents
      expect(parsed.supportedAgents).toEqual([
        'traework',
        'qoderwork',
        'workbuddy',
        'doubao',
        'codex',
        'zcode',
      ]);

      // Verify license auto-fill
      expect(parsed.license).toBe('CC-BY-NC-SA-4.0');

      // Verify unofficial flag
      expect(parsed.unofficial).toBe(true);

      // Verify colors (14-token system)
      expect(parsed.colors).toBeDefined();
      expect(parsed.colors.background).toBeDefined();
      expect(parsed.colors.foreground).toBeDefined();
      expect(parsed.colors.accent).toBeDefined();

      // Verify CSS files exist on disk
      for (const agent of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
        const cssPath = path.join(result.packageDir, 'assets', 'css', `${agent}.css`);
        expect(fs.existsSync(cssPath)).toBe(true);
        const cssContent = fs.readFileSync(cssPath, 'utf-8');
        expect(cssContent).toContain('background: #000');
      }

      // Verify hero image exists on disk (preserved as PNG)
      const heroPath = path.join(result.packageDir, 'assets', 'images', 'hero.png');
      expect(fs.existsSync(heroPath)).toBe(true);

      // Verify flat icon and preview files exist in package root
      expect(fs.existsSync(path.join(result.packageDir, 'icon.png'))).toBe(true);
      expect(fs.existsSync(path.join(result.packageDir, 'preview.png'))).toBe(true);

      // Verify colors in result
      expect(result.colors).toBeDefined();
      expect(typeof result.colors).toBe('object');

      // Verify themeId
      expect(result.themeId).toMatch(/^community-/);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
      // Clean up the package directory created by the converter
      fs.rmSync(result.packageDir, { recursive: true, force: true });
    }
  });

  it('passes validateManifest when parsed', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    // Import the v2 manifest validator
    const { validateManifest } = await import('../../src/main/catalog/manifest-validator');

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    let result;
    try {
      result = await convertThemePackage(dummyZip, createMockMetadata());
      const parsed = JSON.parse(result.manifestJson);

      // This should produce zero errors — the manifest must be valid v2
      const errors = validateManifest(parsed);
      expect(errors).toEqual([]);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (result?.packageDir) {
        fs.rmSync(result.packageDir, { recursive: true, force: true });
      }
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

    let result;
    try {
      result = await convertThemePackage(dummyZip, metadataNoAuthor);
      const parsed = JSON.parse(result.manifestJson);

      // Author should be auto-filled with default
      expect(parsed.author).toEqual({ name: 'DreamSkin Community' });

      // License should be auto-filled
      expect(parsed.license).toBe('CC-BY-NC-SA-4.0');
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (result?.packageDir) {
        fs.rmSync(result.packageDir, { recursive: true, force: true });
      }
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

    let result;
    try {
      result = await convertThemePackage(dummyZip, createMockMetadata());
      const parsed = JSON.parse(result.manifestJson);

      // Hero should reference .jpg, not .png
      expect(parsed.hero).toBe('assets/images/hero.jpg');

      // Hero file should exist on disk as .jpg
      expect(fs.existsSync(path.join(result.packageDir, 'assets', 'images', 'hero.jpg'))).toBe(
        true,
      );
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (result?.packageDir) {
        fs.rmSync(result.packageDir, { recursive: true, force: true });
      }
    }
  });

  it('cleans up extraction directory via cleanupExtractDir in finally block', async () => {
    const extractDir = createMockExtractedTheme();
    mockExtract.mockResolvedValue({ extractDir, themeRoot: extractDir });

    const dummyZip = Buffer.from('PK\x03\x04dummy-zip-bytes');

    const result = await convertThemePackage(dummyZip, createMockMetadata());

    // The converter's finally block should call cleanupExtractDir with the extractDir
    expect(mockCleanup).toHaveBeenCalledWith(extractDir);

    // Clean up the package directory
    fs.rmSync(result.packageDir, { recursive: true, force: true });
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
