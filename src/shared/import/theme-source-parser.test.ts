// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import { agentskinBuiltParser } from './parsers/agentskin-built-parser';
import { codedrobeParser } from './parsers/codedrobe-parser';
import { dreamskinParser } from './parsers/dreamskin-parser';
import { sourceDirectoryParser } from './parsers/source-directory-parser';
import {
  coerceString,
  decodeUtf8,
  getBasename,
  getExtension,
  getNested,
  ParserError,
  ParserRegistry,
  type ParserSource,
  safeParseJson,
  type ThemeIntermediateRepresentation,
  type ThemeSourceParser,
  UnsupportedSourceError,
} from './theme-source-parser';

// ---------------------------------------------------------------------------
// Helper: create a minimal mock parser for registry tests
// ---------------------------------------------------------------------------

function createMockParser(
  name: string,
  canParseResult: boolean,
  extensions: string[] = [],
): ThemeSourceParser {
  return {
    name,
    description: `Mock parser: ${name}`,
    extensions,
    canParse(_source: ParserSource): boolean {
      return canParseResult;
    },
    async parse(_source: ParserSource): Promise<ThemeIntermediateRepresentation> {
      return {
        id: `${name}-theme`,
        displayName: `${name} Theme`,
        version: '1.0.0',
        author: { name: 'Test' },
        mode: 'dark',
        colors: {},
        images: {},
        agentCss: {},
        sourceFormat: name,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ParserRegistry tests
// ---------------------------------------------------------------------------

describe('ParserRegistry', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
  });

  describe('register', () => {
    it('should register a parser with default priority', () => {
      const parser = createMockParser('test-a', true);
      registry.register(parser);

      expect(registry.listParsers()).toHaveLength(1);
      expect(registry.listParsers()[0].name).toBe('test-a');
    });

    it('should register multiple parsers and sort by priority', () => {
      const low = createMockParser('low', true);
      const high = createMockParser('high', true);
      const mid = createMockParser('mid', true);

      registry.register(low, 100);
      registry.register(high, 10);
      registry.register(mid, 50);

      const names = registry.listParsers().map((p) => p.name);
      expect(names).toEqual(['high', 'mid', 'low']);
    });

    it('should register parser with custom priority', () => {
      const parser = createMockParser('custom', true);
      registry.register(parser, 42);

      const listed = registry.listParsers();
      expect(listed).toHaveLength(1);
      expect(listed[0].name).toBe('custom');
    });
  });

  describe('findParser', () => {
    it('should find a matching parser', async () => {
      const parser = createMockParser('match', true);
      registry.register(parser);

      const source: ParserSource = { filename: 'test.json' };
      const found = await registry.findParser(source);

      expect(found).toBeDefined();
      expect(found!.name).toBe('match');
    });

    it('should return undefined when no parser matches', async () => {
      const parser = createMockParser('no-match', false);
      registry.register(parser);

      const source: ParserSource = { filename: 'test.json' };
      const found = await registry.findParser(source);

      expect(found).toBeUndefined();
    });

    it('should return the first matching parser in priority order', async () => {
      const low = createMockParser('low-match', true);
      const high = createMockParser('high-match', true);

      registry.register(low, 100);
      registry.register(high, 10);

      const source: ParserSource = { filename: 'test.json' };
      const found = await registry.findParser(source);

      expect(found).toBeDefined();
      expect(found!.name).toBe('high-match');
    });

    it('should skip parsers whose canParse throws', async () => {
      const throwingParser: ThemeSourceParser = {
        name: 'thrower',
        description: 'Throws',
        extensions: [],
        canParse() {
          throw new Error('unexpected');
        },
        async parse() {
          throw new Error('should not reach');
        },
      };
      const goodParser = createMockParser('good', true);

      registry.register(throwingParser, 10);
      registry.register(goodParser, 20);

      const source: ParserSource = { filename: 'test.json' };
      const found = await registry.findParser(source);

      expect(found).toBeDefined();
      expect(found!.name).toBe('good');
    });
  });

  describe('unregister', () => {
    it('should remove a parser by name', () => {
      const parser = createMockParser('removable', true);
      registry.register(parser);

      expect(registry.listParsers()).toHaveLength(1);
      expect(registry.unregister('removable')).toBe(true);
      expect(registry.listParsers()).toHaveLength(0);
    });

    it('should return false when unregistering non-existent parser', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('getParser', () => {
    it('should find a parser by exact name', () => {
      const parser = createMockParser('exact', true);
      registry.register(parser);

      expect(registry.getParser('exact')).toBeDefined();
      expect(registry.getParser('exact')!.name).toBe('exact');
    });

    it('should return undefined for unknown name', () => {
      expect(registry.getParser('unknown')).toBeUndefined();
    });
  });

  describe('listParsers', () => {
    it('should return empty array when no parsers registered', () => {
      expect(registry.listParsers()).toEqual([]);
    });

    it('should return parser metadata in priority order', () => {
      registry.register(createMockParser('b', true, ['.b']), 20);
      registry.register(createMockParser('a', true, ['.a']), 10);

      const listed = registry.listParsers();
      expect(listed).toHaveLength(2);
      expect(listed[0]).toEqual({ name: 'a', description: 'Mock parser: a', extensions: ['.a'] });
      expect(listed[1]).toEqual({ name: 'b', description: 'Mock parser: b', extensions: ['.b'] });
    });
  });

  describe('clear', () => {
    it('should remove all registered parsers', () => {
      registry.register(createMockParser('a', true));
      registry.register(createMockParser('b', true));

      expect(registry.listParsers()).toHaveLength(2);
      registry.clear();
      expect(registry.listParsers()).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

describe('utility functions', () => {
  describe('decodeUtf8', () => {
    it('should decode UTF-8 bytes to string', () => {
      const bytes = new TextEncoder().encode('Hello World');
      expect(decodeUtf8(bytes)).toBe('Hello World');
    });

    it('should handle empty array', () => {
      expect(decodeUtf8(new Uint8Array(0))).toBe('');
    });

    it('should handle multi-byte UTF-8 characters', () => {
      const bytes = new TextEncoder().encode('café');
      expect(decodeUtf8(bytes)).toBe('café');
    });
  });

  describe('getExtension', () => {
    it('should extract extension without dot', () => {
      expect(getExtension('theme.json')).toBe('json');
      expect(getExtension('theme.codedrobe-theme')).toBe('codedrobe-theme');
    });

    it('should return empty string when no extension', () => {
      expect(getExtension('noextension')).toBe('');
    });

    it('should return lowercase extension', () => {
      expect(getExtension('theme.JSON')).toBe('json');
    });
  });

  describe('getBasename', () => {
    it('should extract basename from unix path', () => {
      expect(getBasename('/home/user/theme.json')).toBe('theme.json');
    });

    it('should extract basename from windows path', () => {
      expect(getBasename('C:\\Users\\theme.json')).toBe('theme.json');
    });

    it('should return input when no separator', () => {
      expect(getBasename('theme.json')).toBe('theme.json');
    });
  });

  describe('safeParseJson', () => {
    it('should parse valid JSON', () => {
      const result = safeParseJson('{"key":"value"}', 'test', 'test-format');
      expect(result).toEqual({ key: 'value' });
    });

    it('should throw ParserError on invalid JSON', () => {
      expect(() => safeParseJson('{invalid}', 'test', 'test-format')).toThrow(ParserError);
    });

    it('should include parser name and format in error', () => {
      try {
        safeParseJson('{broken}', 'my-parser', 'my-format');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParserError);
        expect((e as ParserError).parserName).toBe('my-parser');
        expect((e as ParserError).sourceFormat).toBe('my-format');
      }
    });
  });

  describe('coerceString', () => {
    it('should return string as-is', () => {
      expect(coerceString('hello')).toBe('hello');
    });

    it('should convert number to string', () => {
      expect(coerceString(42)).toBe('42');
    });

    it('should convert boolean to string', () => {
      expect(coerceString(true)).toBe('true');
    });

    it('should return undefined for objects', () => {
      expect(coerceString({ a: 1 })).toBeUndefined();
    });

    it('should return undefined for null', () => {
      expect(coerceString(null)).toBeUndefined();
    });
  });

  describe('getNested', () => {
    it('should extract nested property', () => {
      const obj = { a: { b: { c: 'value' } } };
      expect(getNested(obj, 'a.b.c')).toBe('value');
    });

    it('should return undefined for missing path', () => {
      const obj = { a: { b: 'value' } };
      expect(getNested(obj, 'a.c.d')).toBeUndefined();
    });

    it('should return undefined when intermediate is null', () => {
      const obj = { a: null };
      expect(getNested(obj, 'a.b')).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Error class tests
// ---------------------------------------------------------------------------

describe('ParserError', () => {
  it('should create error with parser name and source format', () => {
    const error = new ParserError('test message', 'test-parser', 'test-format');
    expect(error.message).toBe('test message');
    expect(error.parserName).toBe('test-parser');
    expect(error.sourceFormat).toBe('test-format');
    expect(error.name).toBe('ParserError');
  });
});

describe('UnsupportedSourceError', () => {
  it('should create error with filename', () => {
    const error = new UnsupportedSourceError('unsupported', 'test.xyz');
    expect(error.message).toBe('unsupported');
    expect(error.filename).toBe('test.xyz');
    expect(error.name).toBe('UnsupportedSourceError');
  });

  it('should create error without filename', () => {
    const error = new UnsupportedSourceError('unsupported');
    expect(error.filename).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CodedrobeParser tests
// ---------------------------------------------------------------------------

describe('CodedrobeParser', () => {
  const validCodedrobeJson = {
    format: 'codedrobe-theme',
    schemaVersion: '1.0',
    theme: {
      id: 'miku-future-beats',
      displayName: 'Hatsune Miku Future Beats',
      version: '1.2.0',
      catalog: {
        name: { en: 'Miku Beats', zh: '未来节拍' },
        description: { en: 'A theme', zh: '一个主题' },
        categories: ['character', 'futuristic'],
      },
    },
    targets: {
      codex: { css: ':root.codedrobe-codex-skin { --miku-accent: #39c5bb; }' },
      traework: { css: ':root.codedrobe-traework-skin { --miku-bg: #0a0a0a; }' },
    },
    assets: {
      images: {
        hero: { filename: 'hero.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
        texture: { filename: 'texture.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
      },
    },
  };

  describe('canParse', () => {
    it('should detect .codedrobe-theme file by filename', () => {
      expect(codedrobeParser.canParse({ filename: 'theme.codedrobe-theme' })).toBe(true);
    });

    it('should detect .codedrobe-theme file by path', () => {
      expect(codedrobeParser.canParse({ path: '/home/user/theme.codedrobe-theme' })).toBe(true);
    });

    it('should detect codedrobe JSON by format field', () => {
      expect(codedrobeParser.canParse({ json: { format: 'codedrobe-theme' } })).toBe(true);
    });

    it('should detect codedrobe JSON by theme+targets+assets structure', () => {
      expect(
        codedrobeParser.canParse({
          json: { theme: { id: 'x' }, targets: { codex: {} }, assets: { images: {} } },
        }),
      ).toBe(true);
    });

    it('should detect codedrobe from buffer', () => {
      const buffer = new TextEncoder().encode(JSON.stringify({ format: 'codedrobe-theme' }));
      expect(codedrobeParser.canParse({ buffer })).toBe(true);
    });

    it('should return false for non-codedrobe input', () => {
      expect(codedrobeParser.canParse({ filename: 'theme.json' })).toBe(false);
    });

    it('should return false for unrelated JSON', () => {
      expect(codedrobeParser.canParse({ json: { foo: 'bar' } })).toBe(false);
    });

    it('should return false for invalid buffer', () => {
      const buffer = new TextEncoder().encode('not json');
      expect(codedrobeParser.canParse({ buffer })).toBe(false);
    });
  });

  describe('parse', () => {
    it('should correctly parse codedrobe format from json', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });

      expect(result.id).toBe('miku-future-beats');
      expect(result.displayName).toBe('Hatsune Miku Future Beats');
      expect(result.version).toBe('1.2.0');
      expect(result.author).toEqual({ name: 'Codedrobe' });
      expect(result.sourceFormat).toBe('codedrobe');
      expect(result.confidence).toBe(0.85);
    });

    it('should extract agent CSS', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });

      expect(result.agentCss.codex).toBe(':root.codedrobe-codex-skin { --miku-accent: #39c5bb; }');
      expect(result.agentCss.traework).toBe(
        ':root.codedrobe-traework-skin { --miku-bg: #0a0a0a; }',
      );
    });

    it('should extract localized names and descriptions', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });

      expect(result.localizedNames).toEqual({ en: 'Miku Beats', zh: '未来节拍' });
      expect(result.localizedDescriptions).toEqual({ en: 'A theme', zh: '一个主题' });
    });

    it('should extract categories as tags', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });

      expect(result.tags).toEqual(['character', 'futuristic']);
      expect(result.category).toBe('character');
    });

    it('should extract images from assets', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });

      expect(result.images.hero).toBeDefined();
      expect(result.images.hero!.ext).toBe('png');
      expect(result.images.hero!.filename).toBe('hero.png');
      expect(result.images.textures).toHaveLength(1);
    });

    it('should parse from buffer', async () => {
      const buffer = new TextEncoder().encode(JSON.stringify(validCodedrobeJson));
      const result = await codedrobeParser.parse({ buffer });

      expect(result.id).toBe('miku-future-beats');
      expect(result.sourceFormat).toBe('codedrobe');
    });

    it('should throw ParserError for invalid input', async () => {
      await expect(codedrobeParser.parse({ json: { foo: 'bar' } })).rejects.toThrow(ParserError);
    });

    it('should throw ParserError when neither json nor buffer provided', async () => {
      await expect(codedrobeParser.parse({ filename: 'test.codedrobe-theme' })).rejects.toThrow(
        ParserError,
      );
    });

    it('should detect dark mode from CSS', async () => {
      const darkJson = {
        ...validCodedrobeJson,
        targets: {
          codex: { css: ':root { color-scheme: dark; }' },
        },
      };
      const result = await codedrobeParser.parse({ json: darkJson });
      expect(result.mode).toBe('dark');
    });

    it('should default to light mode when no color-scheme', async () => {
      const result = await codedrobeParser.parse({ json: validCodedrobeJson });
      expect(result.mode).toBe('light');
    });
  });
});

// ---------------------------------------------------------------------------
// DreamSkinParser tests
// ---------------------------------------------------------------------------

describe('DreamSkinParser', () => {
  function createDreamSkinFiles(): Map<string, Uint8Array> {
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
    };

    files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));
    files.set('theme.css', new TextEncoder().encode(':root { --ds-accent: #ff0080; }'));
    files.set('hero.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    return files;
  }

  describe('canParse', () => {
    it('should detect DreamSkin ZIP by filename', () => {
      expect(dreamskinParser.canParse({ filename: 'theme.dreamskin-theme' })).toBe(true);
    });

    it('should detect DreamSkin ZIP by .zip extension', () => {
      expect(dreamskinParser.canParse({ filename: 'theme.zip' })).toBe(true);
    });

    it('should detect DreamSkin by path', () => {
      expect(dreamskinParser.canParse({ path: '/tmp/theme.dreamskin-theme' })).toBe(true);
    });

    it('should detect DreamSkin by theme.json in files map', () => {
      const files = new Map<string, Uint8Array>();
      files.set('theme.json', new TextEncoder().encode('{}'));
      expect(dreamskinParser.canParse({ files })).toBe(true);
    });

    it('should detect DreamSkin by ZIP magic bytes', () => {
      const zipBuffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      expect(dreamskinParser.canParse({ buffer: zipBuffer })).toBe(true);
    });

    it('should return false for non-dreamskin input', () => {
      expect(dreamskinParser.canParse({ filename: 'theme.json' })).toBe(false);
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
  });

  describe('parse', () => {
    it('should correctly parse DreamSkin format', async () => {
      const files = createDreamSkinFiles();
      const result = await dreamskinParser.parse({ files });

      expect(result.id).toBe('cyber-neon');
      expect(result.displayName).toBe('Cyber Neon');
      expect(result.version).toBe('1.0.0');
      expect(result.author).toEqual({ name: 'dreamskin_user' });
      expect(result.sourceFormat).toBe('dreamskin');
      expect(result.confidence).toBe(0.75);
    });

    it('should extract colors', async () => {
      const files = createDreamSkinFiles();
      const result = await dreamskinParser.parse({ files });

      expect(result.colors.accent).toBe('#ff0080');
      expect(result.colors.background).toBe('#0a0a0a');
      expect(result.colors.foreground).toBe('#ffffff');
    });

    it('should extract CSS for all agents', async () => {
      const files = createDreamSkinFiles();
      const result = await dreamskinParser.parse({ files });

      expect(result.agentCss.traework).toBe(':root { --ds-accent: #ff0080; }');
      expect(result.agentCss.codex).toBe(':root { --ds-accent: #ff0080; }');
      expect(result.agentCss.workbuddy).toBe(':root { --ds-accent: #ff0080; }');
    });

    it('should extract hero image', async () => {
      const files = createDreamSkinFiles();
      const result = await dreamskinParser.parse({ files });

      expect(result.images.hero).toBeDefined();
      expect(result.images.hero!.ext).toBe('png');
      expect(result.images.preview).toBeDefined();
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

    it('should throw ParserError when files map is missing', async () => {
      await expect(dreamskinParser.parse({ filename: 'theme.zip' })).rejects.toThrow(ParserError);
    });

    it('should throw ParserError when theme.json is missing from files', async () => {
      const files = new Map<string, Uint8Array>();
      files.set('other.json', new TextEncoder().encode('{}'));
      await expect(dreamskinParser.parse({ files })).rejects.toThrow(ParserError);
    });

    it('should detect dark mode from CSS', async () => {
      const files = new Map<string, Uint8Array>();
      const themeJson = { name: 'Dark Theme', css: 'theme.css' };
      files.set('theme.json', new TextEncoder().encode(JSON.stringify(themeJson)));
      files.set('theme.css', new TextEncoder().encode(':root { color-scheme: dark; }'));

      const result = await dreamskinParser.parse({ files });
      expect(result.mode).toBe('dark');
    });
  });
});

// ---------------------------------------------------------------------------
// AgentskinBuiltParser tests
// ---------------------------------------------------------------------------

describe('AgentskinBuiltParser', () => {
  function createAgentskinFiles(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();

    const manifest = {
      id: 'ocean-depths',
      name: 'ocean-depths',
      displayName: 'Ocean Depths',
      version: '2.0.0',
      author: { name: 'AgentSkin Team', url: 'https://example.com' },
      mode: 'dark',
      category: 'nature',
      tags: ['ocean', 'blue', 'calm'],
      colors: {
        accent: '#0077b6',
        secondary: '#00b4d8',
        background: '#03045e',
        foreground: '#caf0f8',
        muted: '#90e0ef',
        surface: '#023e8a',
        surfaceElevated: '#0077b6',
        border: '#0096c7',
      },
      targets: {
        traework: { css: 'assets/css/traework.css' },
        codex: { css: 'assets/css/codex.css' },
      },
      assets: {
        images: {
          decoration1: 'assets/images/deco1.png',
        },
      },
    };

    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    files.set(
      'assets/css/traework.css',
      new TextEncoder().encode(':root { --agentskin-accent: #0077b6; }'),
    );
    files.set(
      'assets/css/codex.css',
      new TextEncoder().encode(':root { --agentskin-bg: #03045e; }'),
    );
    files.set('assets/images/deco1.png', new Uint8Array(50_000)); // small image = decoration

    return files;
  }

  describe('canParse', () => {
    it('should detect .agentskin-theme directory by filename', () => {
      expect(agentskinBuiltParser.canParse({ filename: 'my-theme.agentskin-theme' })).toBe(true);
    });

    it('should detect .agentskin-theme by path', () => {
      expect(agentskinBuiltParser.canParse({ path: '/home/user/my-theme.agentskin-theme' })).toBe(
        true,
      );
    });

    it('should detect by manifest.json in files map', () => {
      const files = new Map<string, Uint8Array>();
      files.set('manifest.json', new TextEncoder().encode('{}'));
      expect(agentskinBuiltParser.canParse({ files })).toBe(true);
    });

    it('should detect agentskin manifest JSON with id and colors', () => {
      expect(
        agentskinBuiltParser.canParse({
          json: { id: 'test', colors: { accent: '#ff0000' } },
        }),
      ).toBe(true);
    });

    it('should detect agentskin manifest JSON with id and targets', () => {
      expect(
        agentskinBuiltParser.canParse({
          json: { id: 'test', targets: { traework: {} } },
        }),
      ).toBe(true);
    });

    it('should return false for JSON without id', () => {
      expect(
        agentskinBuiltParser.canParse({
          json: { colors: { accent: '#ff0000' } },
        }),
      ).toBe(false);
    });

    it('should return false for JSON with id but no colors or targets', () => {
      expect(
        agentskinBuiltParser.canParse({
          json: { id: 'test' },
        }),
      ).toBe(false);
    });

    it('should detect from buffer', () => {
      const buffer = new TextEncoder().encode(
        JSON.stringify({ id: 'test', colors: { accent: '#ff0000' } }),
      );
      expect(agentskinBuiltParser.canParse({ buffer })).toBe(true);
    });

    it('should return false for non-agentskin buffer', () => {
      const buffer = new TextEncoder().encode('not json');
      expect(agentskinBuiltParser.canParse({ buffer })).toBe(false);
    });
  });

  describe('parse', () => {
    it('should correctly parse agentskin-theme package', async () => {
      const files = createAgentskinFiles();
      const result = await agentskinBuiltParser.parse({ files });

      expect(result.id).toBe('ocean-depths');
      expect(result.displayName).toBe('Ocean Depths');
      expect(result.version).toBe('2.0.0');
      expect(result.author).toEqual({ name: 'AgentSkin Team', url: 'https://example.com' });
      expect(result.sourceFormat).toBe('agentskin');
      expect(result.confidence).toBe(1.0);
    });

    it('should extract all 14 color tokens', async () => {
      const files = createAgentskinFiles();
      const result = await agentskinBuiltParser.parse({ files });

      expect(result.colors.accent).toBe('#0077b6');
      expect(result.colors.secondary).toBe('#00b4d8');
      expect(result.colors.background).toBe('#03045e');
      expect(result.colors.foreground).toBe('#caf0f8');
      expect(result.colors.muted).toBe('#90e0ef');
      expect(result.colors.surface).toBe('#023e8a');
      expect(result.colors.surfaceElevated).toBe('#0077b6');
      expect(result.colors.border).toBe('#0096c7');
    });

    it('should extract per-agent CSS from targets', async () => {
      const files = createAgentskinFiles();
      const result = await agentskinBuiltParser.parse({ files });

      expect(result.agentCss.traework).toBe(':root { --agentskin-accent: #0077b6; }');
      expect(result.agentCss.codex).toBe(':root { --agentskin-bg: #03045e; }');
    });

    it('should extract tags and category', async () => {
      const files = createAgentskinFiles();
      const result = await agentskinBuiltParser.parse({ files });

      expect(result.tags).toEqual(['ocean', 'blue', 'calm']);
      expect(result.category).toBe('nature');
    });

    it('should detect dark mode', async () => {
      const files = createAgentskinFiles();
      const result = await agentskinBuiltParser.parse({ files });

      expect(result.mode).toBe('dark');
    });

    it('should parse from json input', async () => {
      const manifest = {
        id: 'simple-theme',
        displayName: 'Simple Theme',
        colors: { accent: '#ff0000' },
      };
      const result = await agentskinBuiltParser.parse({ json: manifest });

      expect(result.id).toBe('simple-theme');
      expect(result.displayName).toBe('Simple Theme');
    });

    it('should throw ParserError for invalid manifest', async () => {
      await expect(agentskinBuiltParser.parse({ json: { foo: 'bar' } })).rejects.toThrow(
        ParserError,
      );
    });

    it('should throw ParserError when manifest.json missing from files', async () => {
      const files = new Map<string, Uint8Array>();
      files.set('other.json', new TextEncoder().encode('{}'));
      await expect(agentskinBuiltParser.parse({ files })).rejects.toThrow(ParserError);
    });

    it('should throw ParserError when no input provided', async () => {
      await expect(
        agentskinBuiltParser.parse({ filename: 'test.agentskin-theme' }),
      ).rejects.toThrow(ParserError);
    });
  });
});

// ---------------------------------------------------------------------------
// SourceDirectoryParser tests
// ---------------------------------------------------------------------------

describe('SourceDirectoryParser', () => {
  function createSourceDirFiles(): Map<string, Uint8Array> {
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
    };

    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    files.set('theme.css', new TextEncoder().encode(':root { --accent: #2d6a4f; }'));
    files.set('icon.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    files.set('preview.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    return files;
  }

  describe('canParse', () => {
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

    it('should detect source directory with any CSS file', () => {
      const files = new Map<string, Uint8Array>();
      files.set('styles.css', new TextEncoder().encode(':root {}'));
      expect(sourceDirectoryParser.canParse({ files })).toBe(true);
    });

    it('should detect directory path (no extension)', () => {
      expect(sourceDirectoryParser.canParse({ path: '/home/user/my-theme' })).toBe(true);
    });

    it('should detect JSON with manifest structure (id field)', () => {
      expect(sourceDirectoryParser.canParse({ json: { id: 'test' } })).toBe(true);
    });

    it('should detect JSON with manifest structure (name field)', () => {
      expect(sourceDirectoryParser.canParse({ json: { name: 'test' } })).toBe(true);
    });

    it('should detect JSON with manifest structure (colors field)', () => {
      expect(sourceDirectoryParser.canParse({ json: { colors: { accent: '#ff0000' } } })).toBe(
        true,
      );
    });

    it('should detect JSON with manifest structure (targets field)', () => {
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
  });

  describe('parse', () => {
    it('should correctly parse source directory', async () => {
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

    it('should extract icon and preview images', async () => {
      const files = createSourceDirFiles();
      const result = await sourceDirectoryParser.parse({ files });

      expect(result.images.icon).toBeDefined();
      expect(result.images.icon!.ext).toBe('png');
      expect(result.images.preview).toBeDefined();
      expect(result.images.preview!.ext).toBe('png');
    });

    it('should apply theme.css to all agents', async () => {
      const files = createSourceDirFiles();
      const result = await sourceDirectoryParser.parse({ files });

      expect(result.agentCss.traework).toBe(':root { --accent: #2d6a4f; }');
      expect(result.agentCss.codex).toBe(':root { --accent: #2d6a4f; }');
      expect(result.agentCss.workbuddy).toBe(':root { --accent: #2d6a4f; }');
    });

    it('should throw ParserError when files map is missing', async () => {
      await expect(sourceDirectoryParser.parse({ path: '/some/dir' })).rejects.toThrow(ParserError);
    });

    it('should parse colors from colors.json', async () => {
      const files = new Map<string, Uint8Array>();
      const colorsJson = { accent: '#ff5500', background: '#111111' };
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
  });
});

// ---------------------------------------------------------------------------
// Integration: ParserRegistry with real parsers
// ---------------------------------------------------------------------------

describe('ParserRegistry integration with real parsers', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
    registry.register(agentskinBuiltParser, 5);
    registry.register(codedrobeParser, 10);
    registry.register(dreamskinParser, 20);
    registry.register(sourceDirectoryParser, 100);
  });

  it('should find codedrobe parser for .codedrobe-theme files', async () => {
    const source: ParserSource = { filename: 'theme.codedrobe-theme' };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('codedrobe');
  });

  it('should find dreamskin parser for .dreamskin-theme files', async () => {
    const source: ParserSource = { filename: 'theme.dreamskin-theme' };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('dreamskin');
  });

  it('should find agentskin parser for .agentskin-theme files', async () => {
    const source: ParserSource = { filename: 'my-theme.agentskin-theme' };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('agentskin');
  });

  it('should find agentskin parser for bare directory paths (higher priority)', async () => {
    // The agentskin parser (priority 5) accepts directory-like paths (no extension)
    // before source-directory (priority 100) gets a chance.
    const source: ParserSource = { path: '/home/user/my-theme' };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('agentskin');
  });

  it('should find source-directory parser for files map with theme.css only', async () => {
    // When the files map has only theme.css (no manifest.json or theme.json),
    // the source-directory parser is the correct match.
    const files = new Map<string, Uint8Array>();
    files.set('theme.css', new TextEncoder().encode(':root {}'));
    const source: ParserSource = { files };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('source-directory');
  });

  it('should find codedrobe parser for codedrobe JSON content', async () => {
    const source: ParserSource = {
      json: {
        format: 'codedrobe-theme',
        theme: { id: 'test' },
        targets: { codex: {} },
        assets: { images: {} },
      },
    };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('codedrobe');
  });

  it('should find dreamskin parser for files with theme.json', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('theme.json', new TextEncoder().encode('{}'));
    const source: ParserSource = { files };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('dreamskin');
  });

  it('should find agentskin parser for files with manifest.json', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('manifest.json', new TextEncoder().encode('{}'));
    const source: ParserSource = { files };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('agentskin');
  });

  it('should return undefined for completely unknown input', async () => {
    const source: ParserSource = { filename: 'readme.txt' };
    const parser = await registry.findParser(source);
    expect(parser).toBeUndefined();
  });

  it('should parse end-to-end through registry for codedrobe', async () => {
    const codedrobeJson = {
      format: 'codedrobe-theme',
      theme: {
        id: 'integration-test',
        displayName: 'Integration Test Theme',
        version: '1.0.0',
      },
      targets: {
        codex: { css: ':root { --test: value; }' },
      },
      assets: { images: {} },
    };

    const source: ParserSource = { json: codedrobeJson };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();

    const result = await parser!.parse(source);
    expect(result.id).toBe('integration-test');
    expect(result.sourceFormat).toBe('codedrobe');
    expect(result.agentCss.codex).toBe(':root { --test: value; }');
  });

  it('should parse end-to-end through registry for agentskin', async () => {
    const files = new Map<string, Uint8Array>();
    const manifest = {
      id: 'integration-agentskin',
      displayName: 'Integration Agentskin',
      colors: { accent: '#123456' },
    };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));

    const source: ParserSource = { files };
    const parser = await registry.findParser(source);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe('agentskin');

    const result = await parser!.parse(source);
    expect(result.id).toBe('integration-agentskin');
    expect(result.sourceFormat).toBe('agentskin');
    expect(result.colors.accent).toBe('#123456');
  });
});
