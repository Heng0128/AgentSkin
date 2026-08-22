// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { extractLibraryPathsFromVdf, parseVdf, type VdfObject } from './steam-path-resolver';

// ---------------------------------------------------------------------------
// parseVdf — pure function tests
// ---------------------------------------------------------------------------

describe('parseVdf', () => {
  it('parses a simple key-value pair', () => {
    const result = parseVdf('"key" "value"');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses multiple key-value pairs', () => {
    const result = parseVdf('"name" "Steam"\n"version" "1.0"');
    expect(result).toEqual({ name: 'Steam', version: '1.0' });
  });

  it('parses a nested object', () => {
    const result = parseVdf('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path" "C:\\\\Steam"\n\t}\n}');
    expect(result).toEqual({
      libraryfolders: {
        '0': { path: 'C:\\Steam' },
      },
    });
  });

  it('parses deeply nested objects', () => {
    const vdf = `
"libraryfolders"
{
    "0"
    {
        "path"     "C:\\Steam"
        "apps"
        {
            "431960"     "123456"
            "730"        "789012"
        }
    }
}`;
    const result = parseVdf(vdf);
    expect(result.libraryfolders).toBeDefined();
    expect(typeof result.libraryfolders).toBe('object');
    const lib0 = (result.libraryfolders as VdfObject)['0'] as VdfObject;
    expect(lib0.path).toBe('C:\\Steam');
    const apps = lib0.apps as VdfObject;
    expect(apps['431960']).toBe('123456');
    expect(apps['730']).toBe('789012');
  });

  it('handles escaped backslashes in paths', () => {
    const vdf = '"path" "D:\\\\SteamLibrary"';
    const result = parseVdf(vdf);
    expect(result.path).toBe('D:\\SteamLibrary');
  });

  it('strips line comments (//)', () => {
    const vdf = `
// This is a comment
"key" "value"
// Another comment
"key2" "value2"`;
    const result = parseVdf(vdf);
    expect(result).toEqual({ key: 'value', key2: 'value2' });
  });

  it('handles empty input', () => {
    expect(parseVdf('')).toEqual({});
  });

  it('handles whitespace-only input', () => {
    expect(parseVdf('   \n\t  \n')).toEqual({});
  });

  it('handles malformed input without throwing', () => {
    expect(() => parseVdf('{')).not.toThrow();
    expect(() => parseVdf('}')).not.toThrow();
    expect(() => parseVdf('"key"')).not.toThrow();
    expect(() => parseVdf('"key" {')).not.toThrow();
  });

  it('handles key with no value (followed by closing brace)', () => {
    const result = parseVdf('"key" }');
    expect(result.key).toBe('');
  });

  it('handles unexpected opening brace without key', () => {
    const result = parseVdf('{ "key" "value" }');
    expect(result.key).toBe('value');
  });

  it('parses a real-world libraryfolders.vdf', () => {
    const realVdf = `"libraryfolders"
{
    "0"
    {
        "path"          "C:\\\\Program Files (x86)\\\\Steam"
        "label"         ""
        "contentid"     "1111111111111111111"
        "totalsize"     "1000204846080"
        "update_clean_bytes_tally"          "5368139776"
        "time_last_update_corruption"       "0"
        "apps"
        {
            "431960"         "987654321"
            "730"            "123456789"
        }
    }
    "1"
    {
        "path"          "D:\\\\SteamLibrary"
        "label"         ""
        "contentid"     "2222222222222222222"
        "totalsize"     "2000409692160"
        "update_clean_bytes_tally"          "10736279552"
        "time_last_update_corruption"       "0"
        "apps"
        {
            "431960"         "987654321"
        }
    }
    "2"
    {
        "path"          "E:\\\\Games\\\\Steam"
        "label"         ""
        "contentid"     "3333333333333333333"
        "totalsize"     "500102423040"
        "update_clean_bytes_tally"          "2684069888"
        "time_last_update_corruption"       "0"
        "apps"
        {
            "570"            "987654321"
        }
    }
}`;
    const result = parseVdf(realVdf);
    const libraries = result.libraryfolders as VdfObject;

    // Library 0: C drive, has WE
    const lib0 = libraries['0'] as VdfObject;
    expect(lib0.path).toBe('C:\\Program Files (x86)\\Steam');
    expect((lib0.apps as VdfObject)['431960']).toBe('987654321');

    // Library 1: D drive, has WE
    const lib1 = libraries['1'] as VdfObject;
    expect(lib1.path).toBe('D:\\SteamLibrary');
    expect((lib1.apps as VdfObject)['431960']).toBe('987654321');

    // Library 2: E drive, does NOT have WE
    const lib2 = libraries['2'] as VdfObject;
    expect(lib2.path).toBe('E:\\Games\\Steam');
    expect((lib2.apps as VdfObject)['431960']).toBeUndefined();
    expect((lib2.apps as VdfObject)['570']).toBe('987654321');
  });

  it('overwrites duplicate keys (last wins)', () => {
    const vdf = '"key" "first"\n"key" "second"';
    const result = parseVdf(vdf);
    expect(result.key).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// extractLibraryPathsFromVdf — pure function tests
// ---------------------------------------------------------------------------

describe('extractLibraryPathsFromVdf', () => {
  it('returns paths for libraries containing the target app', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
        "apps" { "431960" "123" }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual(['C:\\Steam']);
  });

  it('returns multiple paths when WE is in multiple libraries', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
        "apps" { "431960" "123" }
    }
    "1"
    {
        "path" "D:\\\\SteamLibrary"
        "apps" { "431960" "456" }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual(['C:\\Steam', 'D:\\SteamLibrary']);
  });

  it('skips libraries that do not contain the target app', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
        "apps" { "431960" "123" }
    }
    "1"
    {
        "path" "D:\\\\SteamLibrary"
        "apps" { "730" "456" }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual(['C:\\Steam']);
  });

  it('returns empty array when no library has the target app', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
        "apps" { "730" "123" }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual([]);
  });

  it('returns empty array for malformed VDF', () => {
    expect(extractLibraryPathsFromVdf('')).toEqual([]);
    expect(extractLibraryPathsFromVdf('not vdf at all')).toEqual([]);
    expect(extractLibraryPathsFromVdf('{}')).toEqual([]);
  });

  it('returns empty array when libraryfolders is missing', () => {
    const vdf = '"otherkey" "othervalue"';
    expect(extractLibraryPathsFromVdf(vdf)).toEqual([]);
  });

  it('returns empty array when library path is missing', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "apps" { "431960" "123" }
    }
}`;
    expect(extractLibraryPathsFromVdf(vdf)).toEqual([]);
  });

  it('returns empty array when apps section is missing', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
    }
}`;
    expect(extractLibraryPathsFromVdf(vdf)).toEqual([]);
  });

  it('skips string-valued library entries', () => {
    const vdf = `"libraryfolders"
{
    "0" "not_an_object"
    "1"
    {
        "path" "D:\\\\Steam"
        "apps" { "431960" "123" }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual(['D:\\Steam']);
  });

  it('supports a custom appId', () => {
    const vdf = `"libraryfolders"
{
    "0"
    {
        "path" "C:\\\\Steam"
        "apps" { "730" "123" }
    }
}`;
    // Default appId (431960) not found
    expect(extractLibraryPathsFromVdf(vdf)).toEqual([]);
    // Custom appId (730) found
    expect(extractLibraryPathsFromVdf(vdf, '730')).toEqual(['C:\\Steam']);
  });

  it('handles a realistic VDF with comments and extra fields', () => {
    const vdf = `// Steam library configuration
"libraryfolders"
{
    // Primary library on C drive
    "0"
    {
        "path"          "C:\\\\Program Files (x86)\\\\Steam"
        "label"         ""
        "contentid"     "1111111111111111111"
        "totalsize"     "1000204846080"
        "apps"
        {
            "431960"         "987654321"
            // other games
            "730"            "123456789"
        }
    }
}`;
    const paths = extractLibraryPathsFromVdf(vdf);
    expect(paths).toEqual(['C:\\Program Files (x86)\\Steam']);
  });
});
