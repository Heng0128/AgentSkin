// SPDX-License-Identifier: MPL-2.0

/**
 * # codedrobe-parser.test.ts — unit tests for the Codedrobe theme parser.
 *
 * Validates:
 *   - canParse detection (filename, buffer, json)
 *   - Successful parse of valid codedrobe-theme JSON
 *   - Error handling for invalid input
 *   - Non-null assertion removal (filename/path guards)
 */

import { describe, expect, it } from 'vitest';
import { codedrobeParser } from '../../src/shared/import/parsers/codedrobe-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCodedrobeJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'codedrobe-theme',
    schemaVersion: '1.0',
    theme: {
      id: 'test-theme',
      displayName: 'Test Theme',
      catalog: {
        name: { en: 'Test Theme', zh: '测试主题' },
      },
    },
    targets: {
      codex: { css: ':root.codedrobe-codex-skin { --miku-accent: #29d3bb; }' },
    },
    assets: {
      images: {
        preview: {
          filename: 'preview.png',
          mimeType: 'image/png',
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: canParse
// ---------------------------------------------------------------------------

describe('codedrobeParser.canParse', () => {
  it('returns true for .codedrobe-theme filename', () => {
    expect(codedrobeParser.canParse({ filename: 'my-theme.codedrobe-theme' })).toBe(true);
  });

  it('returns true for .codedrobe-theme path', () => {
    expect(codedrobeParser.canParse({ path: '/home/user/themes/my-theme.codedrobe-theme' })).toBe(
      true,
    );
  });

  it('returns true for valid codedrobe JSON', () => {
    expect(codedrobeParser.canParse({ json: buildCodedrobeJson() })).toBe(true);
  });

  it('returns true for JSON without format field but with theme+targets+assets', () => {
    const json = buildCodedrobeJson();
    delete json.format;
    expect(codedrobeParser.canParse({ json })).toBe(true);
  });

  it('returns false for JSON missing targets (without format field)', () => {
    const json = buildCodedrobeJson();
    delete json.targets;
    delete json.format; // remove format so isCodedrobeJson requires targets
    expect(codedrobeParser.canParse({ json })).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(codedrobeParser.canParse({ json: {} })).toBe(false);
  });

  it('returns false for unrelated JSON', () => {
    expect(codedrobeParser.canParse({ json: { foo: 'bar' } })).toBe(false);
  });

  it('does not throw when filename is undefined (no non-null assertion crash)', () => {
    // This test validates the fix for M4: canParseSource no longer uses non-null assertions
    expect(() => codedrobeParser.canParse({ filename: undefined, path: undefined })).not.toThrow();
    expect(codedrobeParser.canParse({ filename: undefined, path: undefined })).toBe(false);
  });

  it('does not throw when path is undefined', () => {
    expect(() => codedrobeParser.canParse({ path: undefined })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: parse
// ---------------------------------------------------------------------------

describe('codedrobeParser.parse', () => {
  it('parses a minimal valid codedrobe theme', async () => {
    const json = buildCodedrobeJson();
    const result = await codedrobeParser.parse({ json });

    expect(result.id).toBe('test-theme');
    expect(result.displayName).toBe('Test Theme');
    expect(result.sourceFormat).toBe('codedrobe');
  });

  it('extracts agent CSS', async () => {
    const json = buildCodedrobeJson();
    const result = await codedrobeParser.parse({ json });

    expect(result.agentCss.codex).toBeDefined();
    expect(result.agentCss.codex).toContain('--miku-accent');
  });

  it('extracts localized names', async () => {
    const json = buildCodedrobeJson();
    const result = await codedrobeParser.parse({ json });

    expect(result.localizedNames?.en).toBe('Test Theme');
    expect(result.localizedNames?.zh).toBe('测试主题');
  });

  it('extracts preview image from base64', async () => {
    const json = buildCodedrobeJson();
    const result = await codedrobeParser.parse({ json });

    expect(result.images.preview).toBeDefined();
    expect(result.images.preview?.ext).toBe('png');
  });

  it('derives id from displayName when id is missing', async () => {
    const json = buildCodedrobeJson();
    delete json.theme.id;
    json.theme.displayName = 'My Cool Theme';
    const result = await codedrobeParser.parse({ json });
    expect(result.id).toBe('my-cool-theme');
  });

  it('throws ParserError when both id and displayName missing', async () => {
    const json = buildCodedrobeJson();
    delete json.theme.id;
    delete json.theme.displayName;
    await expect(codedrobeParser.parse({ json })).rejects.toThrow();
  });

  it('detects dark mode from CSS', async () => {
    const json = buildCodedrobeJson({
      targets: {
        codex: { css: ':root.codedrobe-codex-skin { color-scheme: dark; }' },
      },
    });
    const result = await codedrobeParser.parse({ json });
    expect(result.mode).toBe('dark');
  });

  it('defaults mode to light', async () => {
    const json = buildCodedrobeJson();
    const result = await codedrobeParser.parse({ json });
    expect(result.mode).toBe('light');
  });

  it('throws ParserError for JSON not conforming to schema', async () => {
    const json = { theme: {} }; // missing targets and assets
    await expect(codedrobeParser.parse({ json })).rejects.toThrow();
  });

  it('parses from buffer input', async () => {
    const json = buildCodedrobeJson();
    const jsonStr = JSON.stringify(json);
    const buf = new TextEncoder().encode(jsonStr);
    const result = await codedrobeParser.parse({ buffer: buf });
    expect(result.id).toBe('test-theme');
  });
});
