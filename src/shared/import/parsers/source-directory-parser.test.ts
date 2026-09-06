// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { ParserError } from '../theme-source-parser';
import { sourceDirectoryParser } from './source-directory-parser';

// ---------------------------------------------------------------------------
// Helper: create a source directory file map
// ---------------------------------------------------------------------------

function createSourceDirFiles(overrides: Record<string, unknown> = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  const manifest = {
    id: 'forest-green',
    displayName: 'Forest Green',
    version: '1.0.0',
    author: { name: 'Nature Dev' },
    mode: 'light',
    category: 'nature',
    tags: ['green', 'forest'],
    colors: {
      accent: '#2d6a4f',
      background: '#f0fff0',
      foreground: '#1b4332',
    },
    ...overrides,
  };

  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  files.set('theme.css', new TextEncoder().encode(':root { --accent: #2d6a4f; }'));
  files.set('icon.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  files.set('preview.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

  return files;
}

// ---------------------------------------------------------------------------
// Directory detection (canParse) tests
// ---------------------------------------------------------------------------

describe('sourceDirectoryParser canParse — directory detection', () => {
  it('should detect source directory with manifest.json', () => {
    const files = new Map<string, Uint8Array>();
    files.set('manifest.json', new TextEncoder().encode('{}'));
    expect(sourceDirectoryParser.canParse({ files })).toBe(true);
  });

  it('should detect source directory with theme.css', () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.css', new TextEncoder().encode(':root {}'));
    expect(sourceDirectoryParser.canParse({ files })).toBe(true);
  });

  it('should detect source directory with colors.json', () => {
    const files = new Map<string, Uint8Array>();
    files.set('colors.json', new TextEncoder().encode('{}'));
    expect(sourceDirectoryParser.canParse({ files })).toBe(true);
  });

  it('should detect source directory with any .css file', () => {
    const files = new Map<string, Uint8Array>();
    files.set('styles.css', new TextEncoder().encode(':root {}'));
    expect(sourceDirectoryParser.canParse({ files })).toBe(true);
  });

  it('should detect directory path (no file extension)', () => {
    expect(sourceDirectoryParser.canParse({ path: '/home/user/my-theme' })).toBe(true);
  });

  it('should detect JSON with id field', () => {
    expect(sourceDirectoryParser.canParse({ json: { id: 'test' } })).toBe(true);
  });

  it('should detect JSON with name field', () => {
    expect(sourceDirectoryParser.canParse({ json: { name: 'test' } })).toBe(true);
  });

  it('should detect JSON with displayName field', () => {
    expect(sourceDirectoryParser.canParse({ json: { displayName: 'Test Theme' } })).toBe(true);
  });

  it('should detect JSON with colors field', () => {
    expect(sourceDirectoryParser.canParse({ json: { colors: { accent: '#ff0000' } } })).toBe(true);
  });

  it('should detect JSON with targets field', () => {
    expect(sourceDirectoryParser.canParse({ json: { targets: { traework: {} } } })).toBe(true);
  });

  it('should return false for files map with no theme entries', () => {
    const files = new Map<string, Uint8Array>();
    files.set('readme.txt', new TextEncoder().encode('hello'));
    files.set('data.csv', new TextEncoder().encode('a,b,c'));
    expect(sourceDirectoryParser.canParse({ files })).toBe(false);
  });

  it('should return false for JSON without manifest structure', () => {
    expect(sourceDirectoryParser.canParse({ json: { foo: 'bar', baz: 123 } })).toBe(false);
  });

  it('should detect from buffer with manifest JSON', () => {
    const buffer = new TextEncoder().encode(JSON.stringify({ id: 'test' }));
    expect(sourceDirectoryParser.canParse({ buffer })).toBe(true);
  });

  it('should return false for non-JSON buffer', () => {
    const buffer = new TextEncoder().encode('not json');
    expect(sourceDirectoryParser.canParse({ buffer })).toBe(false);
  });

  it('should return false for empty source', () => {
    expect(sourceDirectoryParser.canParse({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parse path tests
// ---------------------------------------------------------------------------

describe('sourceDirectoryParser parse', () => {
  it('should correctly parse a valid source directory', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.id).toBe('forest-green');
    expect(result.displayName).toBe('Forest Green');
    expect(result.version).toBe('1.0.0');
    expect(result.author).toEqual({ name: 'Nature Dev' });
    expect(result.sourceFormat).toBe('source-directory');
    expect(result.confidence).toBe(0.6);
  });

  it('should extract colors from manifest', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.colors.accent).toBe('#2d6a4f');
    expect(result.colors.background).toBe('#f0fff0');
    expect(result.colors.foreground).toBe('#1b4332');
  });

  it('should extract tags and category', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.tags).toEqual(['green', 'forest']);
    expect(result.category).toBe('nature');
  });

  it('should detect light mode', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.mode).toBe('light');
  });

  it('should detect dark mode', async () => {
    const files = createSourceDirFiles({ mode: 'dark' });
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.mode).toBe('dark');
  });

  it('should extract icon and preview images', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.images.icon).toBeDefined();
    expect(result.images.icon!.ext).toBe('png');
    expect(result.images.preview).toBeDefined();
    expect(result.images.preview!.ext).toBe('png');
  });

  it('should apply theme.css to all agents as fallback', async () => {
    const files = createSourceDirFiles();
    const result = await sourceDirectoryParser.parse({ files });

    expect(result.agentCss.traework).toBe(':root { --accent: #2d6a4f; }');
    expect(result.agentCss.codex).toBe(':root { --accent: #2d6a4f; }');
    expect(result.agentCss.workbuddy).toBe(':root { --accent: #2d6a4f; }');
    expect(result.agentCss.qoderwork).toBe(':root { --accent: #2d6a4f; }');
    expect(result.agentCss.doubao).toBe(':root { --accent: #2d6a4f; }');
    expect(result.agentCss.zcode).toBe(':root { --accent: #2d6a4f; }');
  });

  it('should extract per-agent CSS from assets/css/<agent>.css', async () => {
    const files = new Map<string, Uint8Array>();
    files.set(
      'assets/css/traework.css',
      new TextEncoder().encode(':root { --traework-custom: value; }'),
    );
    files.set('assets/css/codex.css', new TextEncoder().encode(':root { --codex-custom: value; }'));

    const result = await sourceDirectoryParser.parse({ files });

    expect(result.agentCss.traework).toBe(':root { --traework-custom: value; }');
    expect(result.agentCss.codex).toBe(':root { --codex-custom: value; }');
  });

  it('should extract per-agent CSS from manifest targets', async () => {
    const files = new Map<string, Uint8Array>();
    const manifest = {
      id: 'targeted-theme',
      targets: {
        traework: { css: 'custom/traework.css' },
        codex: { css: 'custom/codex.css' },
      },
    };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    files.set('custom/traework.css', new TextEncoder().encode(':root { --targeted: true; }'));
    files.set('custom/codex.css', new TextEncoder().encode(':root { --targeted: false; }'));

    const result = await sourceDirectoryParser.parse({ files });

    expect(result.agentCss.traework).toBe(':root { --targeted: true; }');
    expect(result.agentCss.codex).toBe(':root { --targeted: false; }');
  });

  it('should parse colors from flat colors.json', async () => {
    const files = new Map<string, Uint8Array>();
    const colorsJson = { accent: '#ff5500', background: '#111111' };
    files.set('colors.json', new TextEncoder().encode(JSON.stringify(colorsJson)));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.colors.accent).toBe('#ff5500');
    expect(result.colors.background).toBe('#111111');
  });

  it('should parse colors from nested colors.json (colors.colors)', async () => {
    const files = new Map<string, Uint8Array>();
    const colorsJson = { colors: { accent: '#ff5500', background: '#111111' } };
    files.set('colors.json', new TextEncoder().encode(JSON.stringify(colorsJson)));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.colors.accent).toBe('#ff5500');
    expect(result.colors.background).toBe('#111111');
  });

  it('should derive id from name when id is missing', async () => {
    const files = new Map<string, Uint8Array>();
    const manifest = { name: 'My Awesome Theme' };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.id).toBe('my-awesome-theme');
  });

  it('should default author to Unknown when missing', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.css', new TextEncoder().encode(':root {}'));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.author.name).toBe('Unknown');
  });

  it('should default version to 1.0.0 when missing', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.css', new TextEncoder().encode(':root {}'));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.version).toBe('1.0.0');
  });

  it('should extract hero image', async () => {
    const files = createSourceDirFiles();
    files.set('hero.png', new Uint8Array(5000));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.images.hero).toBeDefined();
    expect(result.images.hero!.ext).toBe('png');
  });

  it('should extract additional images as decorations or textures', async () => {
    const files = createSourceDirFiles();
    // Small image (< 100000 bytes) → decoration
    files.set('assets/images/small.png', new Uint8Array(5000));
    // Large image (>= 100000 bytes) → texture
    files.set('assets/images/large.png', new Uint8Array(150_000));

    const result = await sourceDirectoryParser.parse({ files });

    expect(result.images.decorations).toBeDefined();
    expect(result.images.decorations!.length).toBeGreaterThanOrEqual(1);
    expect(result.images.textures).toBeDefined();
    expect(result.images.textures!.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Parse error paths
// ---------------------------------------------------------------------------

describe('sourceDirectoryParser parse error paths', () => {
  it('should throw ParserError when files map is missing', async () => {
    await expect(sourceDirectoryParser.parse({ path: '/some/dir' })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError with correct parser name and format', async () => {
    try {
      await sourceDirectoryParser.parse({ path: '/some/dir' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      expect((e as ParserError).parserName).toBe('source-directory');
      expect((e as ParserError).sourceFormat).toBe('source-directory');
    }
  });

  it('should handle malformed manifest.json gracefully', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('manifest.json', new TextEncoder().encode('{ invalid }'));
    files.set('theme.css', new TextEncoder().encode(':root {}'));

    // Should not throw — manifest is optional, falls back to other sources
    const result = await sourceDirectoryParser.parse({ files });
    expect(result.sourceFormat).toBe('source-directory');
  });

  it('should handle malformed colors.json gracefully', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('colors.json', new TextEncoder().encode('{ invalid }'));
    files.set('theme.css', new TextEncoder().encode(':root {}'));

    // Should not throw — colors.json is optional
    const result = await sourceDirectoryParser.parse({ files });
    expect(result.sourceFormat).toBe('source-directory');
  });

  it('should derive id from file list hash when no manifest', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.css', new TextEncoder().encode(':root {}'));

    const result = await sourceDirectoryParser.parse({ files });
    expect(result.id).toMatch(/^source-theme-[0-9a-f]{8}$/);
  });
});
