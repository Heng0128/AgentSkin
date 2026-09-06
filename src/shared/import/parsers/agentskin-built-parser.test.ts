// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { ParserError } from '../theme-source-parser';
import { agentskinBuiltParser } from './agentskin-built-parser';

// ---------------------------------------------------------------------------
// Helper: create an agentskin-theme file map
// ---------------------------------------------------------------------------

function createAgentskinFiles(overrides: Record<string, unknown> = {}): Map<string, Uint8Array> {
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
    ...overrides,
  };

  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  files.set(
    'assets/css/traework.css',
    new TextEncoder().encode(':root { --agentskin-accent: #0077b6; }'),
  );
  files.set('assets/css/codex.css', new TextEncoder().encode(':root { --agentskin-bg: #03045e; }'));
  files.set('assets/images/deco1.png', new Uint8Array(50_000));

  return files;
}

// ---------------------------------------------------------------------------
// Identity detection (canParse) tests
// ---------------------------------------------------------------------------

describe('agentskinBuiltParser canParse — identity detection', () => {
  it('should detect .agentskin-theme by filename', () => {
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

  it('should detect from buffer with valid manifest JSON', () => {
    const buffer = new TextEncoder().encode(
      JSON.stringify({ id: 'test', colors: { accent: '#ff0000' } }),
    );
    expect(agentskinBuiltParser.canParse({ buffer })).toBe(true);
  });

  it('should return false for non-agentskin buffer', () => {
    const buffer = new TextEncoder().encode('not json');
    expect(agentskinBuiltParser.canParse({ buffer })).toBe(false);
  });

  it('should return false for buffer with JSON but no id', () => {
    const buffer = new TextEncoder().encode(JSON.stringify({ colors: { accent: '#ff0000' } }));
    expect(agentskinBuiltParser.canParse({ buffer })).toBe(false);
  });

  it('should detect directory-like path (no extension after last slash)', () => {
    expect(agentskinBuiltParser.canParse({ path: '/home/user/my-theme' })).toBe(true);
  });

  it('should return false for empty source', () => {
    expect(agentskinBuiltParser.canParse({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parse path tests
// ---------------------------------------------------------------------------

describe('agentskinBuiltParser parse', () => {
  it('should correctly parse a valid agentskin-theme package', async () => {
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

  it('should detect light mode', async () => {
    const files = createAgentskinFiles({ mode: 'light' });
    const result = await agentskinBuiltParser.parse({ files });

    expect(result.mode).toBe('light');
  });

  it('should parse from json input directly', async () => {
    const manifest = {
      id: 'simple-theme',
      displayName: 'Simple Theme',
      colors: { accent: '#ff0000' },
    };
    const result = await agentskinBuiltParser.parse({ json: manifest });

    expect(result.id).toBe('simple-theme');
    expect(result.displayName).toBe('Simple Theme');
    expect(result.colors.accent).toBe('#ff0000');
  });

  it('should parse from buffer input', async () => {
    const manifest = {
      id: 'buffer-theme',
      displayName: 'Buffer Theme',
      colors: { accent: '#00ff00' },
    };
    const buffer = new TextEncoder().encode(JSON.stringify(manifest));
    const result = await agentskinBuiltParser.parse({ buffer });

    expect(result.id).toBe('buffer-theme');
    expect(result.sourceFormat).toBe('agentskin');
  });

  it('should extract extended colors', async () => {
    const files = createAgentskinFiles({
      colors: {
        accent: '#0077b6',
        extended: { customToken: '#abc123', anotherToken: '#def456' },
      },
    });
    const result = await agentskinBuiltParser.parse({ files });

    expect(result.colors.customToken).toBe('#abc123');
    expect(result.colors.anotherToken).toBe('#def456');
  });

  it('should extract license field', async () => {
    const files = createAgentskinFiles({ license: 'MIT' });
    const result = await agentskinBuiltParser.parse({ files });

    expect(result.license).toBe('MIT');
  });

  it('should handle author as string', async () => {
    const files = createAgentskinFiles({ author: 'Single Author' });
    const result = await agentskinBuiltParser.parse({ files });

    expect(result.author).toEqual({ name: 'Single Author' });
  });

  it('should extract icon, preview, and hero from manifest references', async () => {
    const files = createAgentskinFiles({
      icon: 'icon.png',
      preview: 'preview.png',
      hero: 'hero.png',
    });
    files.set('icon.png', new Uint8Array(1000));
    files.set('preview.png', new Uint8Array(2000));
    files.set('hero.png', new Uint8Array(3000));

    const result = await agentskinBuiltParser.parse({ files });

    expect(result.images.icon).toBeDefined();
    expect(result.images.icon!.filename).toBe('icon.png');
    expect(result.images.preview).toBeDefined();
    expect(result.images.preview!.filename).toBe('preview.png');
    expect(result.images.hero).toBeDefined();
    expect(result.images.hero!.filename).toBe('hero.png');
  });
});

// ---------------------------------------------------------------------------
// Parse error paths
// ---------------------------------------------------------------------------

describe('agentskinBuiltParser parse error paths', () => {
  it('should throw ParserError for invalid manifest (no id)', async () => {
    await expect(agentskinBuiltParser.parse({ json: { foo: 'bar' } })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError when manifest.json missing from files', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('other.json', new TextEncoder().encode('{}'));
    await expect(agentskinBuiltParser.parse({ files })).rejects.toThrow(ParserError);
  });

  it('should throw ParserError when no input provided', async () => {
    await expect(agentskinBuiltParser.parse({ filename: 'test.agentskin-theme' })).rejects.toThrow(
      ParserError,
    );
  });

  it('should throw ParserError with correct parser name and format', async () => {
    try {
      await agentskinBuiltParser.parse({ json: { foo: 'bar' } });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      expect((e as ParserError).parserName).toBe('agentskin');
      expect((e as ParserError).sourceFormat).toBe('agentskin-theme');
    }
  });

  it('should throw ParserError for malformed JSON in files', async () => {
    const files = new Map<string, Uint8Array>();
    files.set('manifest.json', new TextEncoder().encode('{ invalid }'));
    await expect(agentskinBuiltParser.parse({ files })).rejects.toThrow(ParserError);
  });

  it('should handle missing version gracefully', async () => {
    const files = createAgentskinFiles();
    const manifest = { id: 'no-version', colors: { accent: '#ff0000' } };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));

    const result = await agentskinBuiltParser.parse({ files });
    expect(result.version).toBe('1.0.0');
  });

  it('should handle missing author gracefully', async () => {
    const files = createAgentskinFiles();
    const manifest = { id: 'no-author', colors: { accent: '#ff0000' } };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));

    const result = await agentskinBuiltParser.parse({ files });
    expect(result.author.name).toBe('Unknown');
  });
});
