// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { ParserError } from '../theme-source-parser';
import { dreamskinParser } from './dreamskin-parser';

// ---------------------------------------------------------------------------
// Helper: create a DreamSkin file map
// ---------------------------------------------------------------------------

function createDreamSkinFiles(overrides: Record<string, unknown> = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  const themeJson = {
    name: 'Cyber Neon',
    author: 'dreamskin_user',
    version: '1.0.0',
    description: 'A cyberpunk theme',
    image: 'hero.png',
    css: 'theme.css',
    tags: ['cyberpunk', 'dark'],
    category: 'cyberpunk',
    colors: {
      accent: '#ff0080',
      background: '#0a0a0a',
      foreground: '#ffffff',
    },
    ...overrides,
  };

  files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));
  files.set('theme.css', new TextEncoder().encode(':root { --ds-accent: #ff0080; }'));
  files.set('hero.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  return files;
}

// ---------------------------------------------------------------------------
// canParse tests
// ---------------------------------------------------------------------------

describe('dreamskinParser canParse', () => {
  it('should detect .dreamskin-theme file by filename', () => {
    expect(dreamskinParser.canParse({ filename: 'theme.dreamskin-theme' })).toBe(true);
  });

  it('should detect .zip file by filename', () => {
    expect(dreamskinParser.canParse({ filename: 'theme.zip' })).toBe(true);
  });

  it('should detect by path ending with .dreamskin-theme', () => {
    expect(dreamskinParser.canParse({ path: '/tmp/theme.dreamskin-theme' })).toBe(true);
  });

  it('should detect by path ending with .zip', () => {
    expect(dreamskinParser.canParse({ path: '/tmp/theme.zip' })).toBe(true);
  });

  it('should detect by theme.json in files map', () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.json', new TextEncoder().encode('{}'));
    expect(dreamskinParser.canParse({ files })).toBe(true);
  });

  it('should detect by ZIP magic bytes (PK\\x03\\x04)', () => {
    const zipBuffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(dreamskinParser.canParse({ buffer: zipBuffer })).toBe(true);
  });

  it('should return false for files map without theme.json', () => {
    const files = new Map<string, Uint8Array>();
    files.set('other.json', new TextEncoder().encode('{}'));
    expect(dreamskinParser.canParse({ files })).toBe(false);
  });

  it('should return false for non-ZIP buffer', () => {
    const buffer = new TextEncoder().encode('not a zip');
    expect(dreamskinParser.canParse({ buffer })).toBe(false);
  });

  it('should return false for buffer shorter than 4 bytes', () => {
    const buffer = new Uint8Array([0x50, 0x4b, 0x03]);
    expect(dreamskinParser.canParse({ buffer })).toBe(false);
  });

  it('should return false for unrelated filename', () => {
    expect(dreamskinParser.canParse({ filename: 'theme.json' })).toBe(false);
  });

  it('should return false for empty source', () => {
    expect(dreamskinParser.canParse({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parse tests
// ---------------------------------------------------------------------------

describe('dreamskinParser parse', () => {
  it('should correctly parse a valid DreamSkin package', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.id).toBe('cyber-neon');
    expect(result.displayName).toBe('Cyber Neon');
    expect(result.version).toBe('1.0.0');
    expect(result.author).toEqual({ name: 'dreamskin_user' });
    expect(result.sourceFormat).toBe('dreamskin');
    expect(result.confidence).toBe(0.75);
  });

  it('should extract colors from theme.json', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.colors.accent).toBe('#ff0080');
    expect(result.colors.background).toBe('#0a0a0a');
    expect(result.colors.foreground).toBe('#ffffff');
  });

  it('should extract CSS for all 6 agents', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.agentCss.traework).toBe(':root { --ds-accent: #ff0080; }');
    expect(result.agentCss.qoderwork).toBe(':root { --ds-accent: #ff0080; }');
    expect(result.agentCss.workbuddy).toBe(':root { --ds-accent: #ff0080; }');
    expect(result.agentCss.doubao).toBe(':root { --ds-accent: #ff0080; }');
    expect(result.agentCss.codex).toBe(':root { --ds-accent: #ff0080; }');
    expect(result.agentCss.zcode).toBe(':root { --ds-accent: #ff0080; }');
  });

  it('should extract hero and preview images', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.images.hero).toBeDefined();
    expect(result.images.hero!.ext).toBe('png');
    expect(result.images.hero!.filename).toBe('hero.png');
    expect(result.images.preview).toBeDefined();
    expect(result.images.preview).toEqual(result.images.hero);
  });

  it('should extract tags and category', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.tags).toEqual(['cyberpunk', 'dark']);
    expect(result.category).toBe('cyberpunk');
  });

  it('should mark as unofficial', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.unofficial).toBe(true);
  });

  it('should include localized descriptions', async () => {
    const files = createDreamSkinFiles();
    const result = await dreamskinParser.parse({ files });

    expect(result.localizedDescriptions).toEqual({
      en: 'A cyberpunk theme',
      zh: 'A cyberpunk theme',
    });
  });

  it('should detect dark mode from CSS color-scheme', async () => {
    const files = new Map<string, Uint8Array>();
    const themeJson = { name: 'Dark Theme', css: 'theme.css' };
    files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));
    files.set('theme.css', new TextEncoder().encode(':root { color-scheme: dark; }'));

    const result = await dreamskinParser.parse({ files });
    expect(result.mode).toBe('dark');
  });

  it('should detect light mode from explicit mode field', async () => {
    const files = createDreamSkinFiles({ mode: 'light' });
    const result = await dreamskinParser.parse({ files });
    expect(result.mode).toBe('light');
  });

  it('should default to dark mode when no indicators', async () => {
    const files = new Map<string, Uint8Array>();
    const themeJson = { name: 'No Mode' };
    files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));

    const result = await dreamskinParser.parse({ files });
    expect(result.mode).toBe('dark');
  });

  it('should map color aliases (primary → accent, text → foreground)', async () => {
    const files = createDreamSkinFiles({
      colors: { primary: '#ff0000', text: '#cccccc' },
    });
    const result = await dreamskinParser.parse({ files });

    expect(result.colors.accent).toBe('#ff0000');
    expect(result.colors.foreground).toBe('#cccccc');
  });

  it('should extract additional images as decorations or textures', async () => {
    const files = createDreamSkinFiles();
    // Small image (< 50000 bytes) → decoration
    files.set('small.png', new Uint8Array(1000));
    // Large image (>= 50000 bytes) → texture
    files.set('large.png', new Uint8Array(60000));

    const result = await dreamskinParser.parse({ files });

    expect(result.images.decorations).toBeDefined();
    expect(result.images.decorations!.length).toBeGreaterThanOrEqual(1);
    expect(result.images.textures).toBeDefined();
    expect(result.images.textures!.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// parse error paths
// ---------------------------------------------------------------------------

describe('dreamskinParser parse error paths', () => {
  it('should throw ParserError when files map is missing', async () => {
    await expect(dreamskinParser.parse({ filename: 'theme.zip' })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError when theme.json is missing from files', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('other.json', new TextEncoder().encode('{}'));
    await expect(dreamskinParser.parse({ files })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError when theme.json has no name field', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.json', new TextEncoder().encode(JSON.stringify({ author: 'test' })));
    await expect(dreamskinParser.parse({ files })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError when theme.json is malformed JSON', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.json', new TextEncoder().encode('{ invalid json }'));
    await expect(dreamskinParser.parse({ files })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError with correct parser name and format', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.json', new TextEncoder().encode('{}'));
    try {
      await dreamskinParser.parse({ files });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      expect((e as ParserError).parserName).toBe('dreamskin');
      expect((e as ParserError).sourceFormat).toBe('dreamskin-theme');
    }
  });

  it('should handle empty tags array gracefully', async () => {
    const files = createDreamSkinFiles({ tags: [] });
    const result = await dreamskinParser.parse({ files });
    expect(result.tags).toEqual([]);
  });

  it('should handle missing CSS file gracefully', async () => {
    const files = new Map<string, Uint8Array>();
    const themeJson = { name: 'No CSS' };
    files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));

    const result = await dreamskinParser.parse({ files });
    expect(result.agentCss.traework).toBeUndefined();
  });

  it('should handle missing colors gracefully', async () => {
    const files = createDreamSkinFiles();
    // Remove colors from theme.json
    const themeJson = { name: 'No Colors' };
    files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));

    const result = await dreamskinParser.parse({ files });
    expect(result.colors).toEqual({});
  });
});
