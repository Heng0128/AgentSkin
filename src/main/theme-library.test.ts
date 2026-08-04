// SPDX-License-Identifier: MPL-2.0

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ThemeBundle } from '../legacy/agentskin-core-runtime';
import { inferModeFromColors, ThemeLibrary, toInstalledTheme } from './theme-library';

let root = '';
let sources = '';
let library: ThemeLibrary;

function themePackage(overrides: { id?: string; displayName?: string; version?: string } = {}) {
  return {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: {
      id: overrides.id ?? 'neon',
      displayName: overrides.displayName ?? 'Neon',
      version: overrides.version ?? '1.0.0',
    },
    targets: { codex: { css: 'body { color: red; }' } },
  };
}

async function writePackage(filename: string, bundle: unknown): Promise<string> {
  const filePath = path.join(sources, filename);
  await fs.writeFile(filePath, JSON.stringify(bundle), 'utf8');
  return filePath;
}

/**
 * Build a ThemeBundle with sensible defaults and selective overrides.
 * Centralises the `as unknown as ThemeBundle` double cast so individual
 * tests don't repeat it. Every field has a default that matches the
 * shape expected by `toInstalledTheme`.
 */
function makeBundle(
  overrides: {
    id?: string;
    displayName?: string;
    version?: string;
    copy?: Record<string, unknown>;
    targets?: Record<string, { css: string }>;
    /** Extra top-level theme fields (for legacy field testing). */
    themeExtras?: Record<string, unknown>;
  } = {},
): ThemeBundle {
  return {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: {
      id: overrides.id ?? 'wp-theme',
      displayName: overrides.displayName ?? 'WP',
      version: overrides.version ?? '1.0.0',
      ...(overrides.copy ? { copy: overrides.copy } : {}),
      ...(overrides.themeExtras ?? {}),
    },
    targets: overrides.targets ?? { traework: { css: 'body{}' } },
  } as unknown as ThemeBundle;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-library-'));
  sources = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-sources-'));
  library = new ThemeLibrary(root);
  await library.initialize();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(sources, { recursive: true, force: true });
});

describe('inspectPackage', () => {
  it('reports a fresh install without touching the library', async () => {
    const source = await writePackage('neon.agentskin-theme', themePackage());
    const inspection = await library.inspectPackage(source);
    expect(inspection.incoming).toMatchObject({
      id: 'neon',
      displayName: 'Neon',
      version: '1.0.0',
    });
    expect(inspection.existing).toBeNull();
    await expect(library.summaries()).resolves.toEqual([]);
  });

  it('reports the installed theme a same-id import would replace', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    const update = await writePackage('neon-2.agentskin-theme', themePackage({ version: '2.0.0' }));
    const inspection = await library.inspectPackage(update);
    expect(inspection.incoming.version).toBe('2.0.0');
    expect(inspection.existing).toMatchObject({ id: 'neon', version: '1.0.0' });
  });

  it('converts legacy packages before inspecting them', async () => {
    const legacy = await writePackage('retro.codex-theme', {
      format: 'codex-theme',
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        id: 'retro',
        displayName: 'Retro',
        version: '0.3.0',
        css: 'theme.css',
      },
      css: 'body { color: blue; }',
    });
    const inspection = await library.inspectPackage(legacy);
    expect(inspection.incoming).toMatchObject({
      id: 'retro',
      version: '0.3.0',
      // The legacy .codex-theme format produces a target keyed "codex", which
      // is now a first-class AgentId — so it lands in supportedAgents rather
      // than legacyTargets.
      supportedAgents: ['codex'],
      legacyTargets: [],
    });
    expect(inspection.existing).toBeNull();
  });

  it('rejects unknown extensions and invalid packages', async () => {
    await expect(library.inspectPackage(path.join(sources, 'note.txt'))).rejects.toThrow();
    const broken = await writePackage('broken.agentskin-theme', { format: 'agentskin-theme' });
    await expect(library.inspectPackage(broken)).rejects.toThrow();
  });
});

describe('importPackage', () => {
  it('installs a package and replaces same-id installs atomically', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    const updated = await library.importPackage(
      await writePackage('neon-2.agentskin-theme', themePackage({ version: '2.0.0' })),
    );
    expect(updated.version).toBe('2.0.0');
    const summaries = await library.summaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: 'neon', version: '2.0.0' });
  });

  it('imports legacy packages by converting them', async () => {
    const legacy = await writePackage('retro.codex-theme', {
      format: 'codex-theme',
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        id: 'retro',
        displayName: 'Retro',
        version: '0.3.0',
        css: 'theme.css',
      },
      css: 'body { color: blue; }',
    });
    const installed = await library.importPackage(legacy);
    expect(installed).toMatchObject({ id: 'retro', version: '0.3.0' });
    await expect(library.summaries()).resolves.toHaveLength(1);
  });
});

// --- bytes pipeline (general capability, NOT used for built-in seed) ---

describe('installBytes (general capability)', () => {
  it('installs a theme from in-memory bytes', async () => {
    const bundle = themePackage({
      id: 'bytes-theme',
      displayName: 'Bytes Theme',
      version: '1.2.0',
    });
    const installed = await library.installBytes(
      Buffer.from(JSON.stringify(bundle)),
      'fallback-id',
    );
    expect(installed.id).toBe('bytes-theme');
    expect(installed.version).toBe('1.2.0');
    await expect(library.summaries()).resolves.toContainEqual(
      expect.objectContaining({ id: 'bytes-theme' }),
    );
  });

  it('rejects a bundle with a missing theme id', async () => {
    const bundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: { displayName: 'Broken', version: '1.0.0' },
      targets: { traework: { css: 'body { color: red; }' } },
    };
    await expect(
      library.installBytes(Buffer.from(JSON.stringify(bundle)), 'fallback-id'),
    ).rejects.toThrow();
  });
});

// --- P3.1 icon propagation tests ---

describe('icon propagation (P3.1)', () => {
  it('surfaces iconDataUrl when bundle has dedicated icon asset', async () => {
    const bundle = {
      ...themePackage({ id: 'icon-theme' }),
      assets: {
        images: {
          icon: {
            filename: 'icon.png',
            mimeType: 'image/png',
            base64: 'dGVzdA==',
          },
          hero: {
            filename: 'hero.png',
            mimeType: 'image/png',
            base64: 'aGVybw==',
          },
        },
      },
    };
    const source = await writePackage('icon-theme.agentskin-theme', bundle);
    const installed = await library.importPackage(source);
    expect(installed.iconDataUrl).toBe('data:image/png;base64,dGVzdA==');
    expect(installed.icon).toBe('data:image/png;base64,dGVzdA==');
    expect(installed.coverDataUrl).toBe('data:image/png;base64,aGVybw==');
  });

  it('has null iconDataUrl when bundle has no icon asset', async () => {
    const source = await writePackage('no-icon.agentskin-theme', themePackage({ id: 'no-icon' }));
    const installed = await library.importPackage(source);
    expect(installed.iconDataUrl).toBeNull();
    expect(installed.icon).toBeNull();
  });
});

// --- Catalog metadata propagation (Task 3/4) ---

describe('catalog metadata propagation', () => {
  it('reads author, category, tags and explicit supportedAgents from theme.copy', async () => {
    const bundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: 'meta-theme',
        displayName: 'Meta Theme',
        version: '3.0.0',
        copy: {
          tagline: 'A theme with rich metadata',
          author: 'Jane Doe',
          category: 'cyberpunk',
          tags: ['dark', 'neon'],
          license: 'MIT',
          mode: 'dark',
          unofficial: false,
          supportedAgents: ['traework', 'qoderwork', 'workbuddy'],
        },
      },
      targets: {
        traework: { css: 'body{}' },
        qoderwork: { css: 'body{}' },
        workbuddy: { css: 'body{}' },
      },
    };
    const installed = await library.importPackage(
      await writePackage('meta.agentskin-theme', bundle),
    );
    expect(installed.author).toBe('Jane Doe');
    expect(installed.category).toBe('cyberpunk');
    expect(installed.tags).toEqual(['dark', 'neon']);
    expect(installed.license).toBe('MIT');
    expect(installed.mode).toBe('dark');
    expect(installed.unofficial).toBe(false);
    expect(installed.supportedAgents).toEqual(
      expect.arrayContaining(['traework', 'qoderwork', 'workbuddy']),
    );
  });

  it('flattens an object author and falls back to target-derived agents', async () => {
    const bundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: 'obj-author',
        displayName: 'Obj Author',
        version: '1.0.0',
        copy: {
          author: { name: 'Team X', url: 'https://example.com' },
        },
      },
      targets: { traework: { css: 'body{}' } },
    };
    const installed = await library.importPackage(
      await writePackage('obj.agentskin-theme', bundle),
    );
    expect(installed.author).toBe('Team X');
    expect(installed.supportedAgents).toEqual(['traework']);
  });
});

// ---------------------------------------------------------------------------
// inferModeFromColors (exported standalone — direct unit tests)
// ---------------------------------------------------------------------------

describe('inferModeFromColors', () => {
  it('returns null for undefined input', () => {
    expect(inferModeFromColors(undefined)).toBeNull();
  });

  it('returns null when no background key is present', () => {
    expect(inferModeFromColors({ accent: '#ff0000' })).toBeNull();
  });

  it('detects dark mode from a dark hex background (#rrggbb)', () => {
    expect(inferModeFromColors({ background: '#000000' })).toBe('dark');
    expect(inferModeFromColors({ bg: '#1a1a1a' })).toBe('dark');
    expect(inferModeFromColors({ '--background': '#0d0d0d' })).toBe('dark');
  });

  it('detects light mode from a light hex background', () => {
    expect(inferModeFromColors({ background: '#ffffff' })).toBe('light');
    expect(inferModeFromColors({ bg: '#e0e0e0' })).toBe('light');
  });

  it('detects dark mode from a 3-digit hex (#rgb)', () => {
    expect(inferModeFromColors({ background: '#000' })).toBe('dark');
    expect(inferModeFromColors({ background: '#111' })).toBe('dark');
  });

  it('detects light mode from a 3-digit hex (#rgb)', () => {
    expect(inferModeFromColors({ background: '#fff' })).toBe('light');
    expect(inferModeFromColors({ background: '#ccc' })).toBe('light');
  });

  it('detects mode from rgb() notation', () => {
    expect(inferModeFromColors({ background: 'rgb(0, 0, 0)' })).toBe('dark');
    expect(inferModeFromColors({ background: 'rgb(255, 255, 255)' })).toBe('light');
  });

  it('detects mode from rgba() notation', () => {
    expect(inferModeFromColors({ background: 'rgba(10, 10, 10, 0.8)' })).toBe('dark');
    expect(inferModeFromColors({ background: 'rgba(240, 240, 240, 0.5)' })).toBe('light');
  });

  it('returns null for non-color background values', () => {
    expect(inferModeFromColors({ background: 'red' })).toBeNull();
    expect(inferModeFromColors({ background: 'var(--something)' })).toBeNull();
    expect(inferModeFromColors({ background: '' })).toBeNull();
  });

  it('returns null for non-string background', () => {
    expect(inferModeFromColors({ background: 123 as unknown as string })).toBeNull();
  });

  it('uses the first available background key (background > bg > --background)', () => {
    expect(inferModeFromColors({ background: '#000', bg: '#fff' })).toBe('dark');
    expect(inferModeFromColors({ bg: '#000', '--background': '#fff' })).toBe('dark');
  });

  it('treats hex without hash prefix', () => {
    expect(inferModeFromColors({ background: '000000' })).toBe('dark');
    expect(inferModeFromColors({ background: 'ffffff' })).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// extractWallpaper (exercised via toInstalledTheme with theme.copy.wallpaper)
// ---------------------------------------------------------------------------

describe('wallpaper extraction (toInstalledTheme)', () => {
  it('extracts a workshopId-based wallpaper config', () => {
    const installed = toInstalledTheme({
      bundle: makeBundle({
        copy: {
          wallpaper: {
            workshopId: '12345',
            poster: 'poster.jpg',
            speed: 0.5,
            loop: false,
            scrimOpacity: 40,
          },
        },
      }),
      filePath: '/fake',
    });
    expect(installed.wallpaper).toMatchObject({
      workshopId: '12345',
      video: undefined,
      poster: 'poster.jpg',
      speed: 0.5,
      loop: false,
      scrimOpacity: 40,
    });
  });

  it('extracts a video-based wallpaper config', () => {
    const installed = toInstalledTheme({
      bundle: makeBundle({ copy: { wallpaper: { video: 'bg.mp4' } } }),
      filePath: '/fake',
    });
    expect(installed.wallpaper).toMatchObject({ video: 'bg.mp4', workshopId: undefined });
  });

  it('returns null wallpaper when neither workshopId nor video is present', () => {
    const installed = toInstalledTheme({
      bundle: makeBundle({ copy: { wallpaper: { poster: 'poster.jpg' } } }),
      filePath: '/fake',
    });
    expect(installed.wallpaper).toBeNull();
  });

  it('returns null wallpaper for non-object wallpaper config', () => {
    const installed = toInstalledTheme({
      bundle: makeBundle({ copy: { wallpaper: 'not-an-object' } }),
      filePath: '/fake',
    });
    expect(installed.wallpaper).toBeNull();
  });

  it('returns null wallpaper when wallpaper key is absent', () => {
    const installed = toInstalledTheme({ bundle: makeBundle({}), filePath: '/fake' });
    expect(installed.wallpaper).toBeNull();
  });

  it('ignores non-string workshopId / video values', () => {
    const installed = toInstalledTheme({
      bundle: makeBundle({ copy: { wallpaper: { workshopId: 12345, video: true } } }),
      filePath: '/fake',
    });
    expect(installed.wallpaper).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// contentHash extraction (toInstalledTheme)
// ---------------------------------------------------------------------------

describe('contentHash extraction (toInstalledTheme)', () => {
  it('reads contentHash from theme.copy', () => {
    const bundle = makeBundle({ id: 'ch', displayName: 'CH', copy: { contentHash: 'abc123' } });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.contentHash).toBe('abc123');
  });

  it('returns undefined contentHash when not present', () => {
    const bundle = makeBundle({ id: 'ch', displayName: 'CH' });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.contentHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// colors fallback to copy.colors (toInstalledTheme)
// ---------------------------------------------------------------------------

describe('colors extraction (toInstalledTheme)', () => {
  it('prefers colors extracted from CSS targets over manifest copy.colors', () => {
    const bundle = makeBundle({
      id: 'c-theme',
      displayName: 'C',
      copy: { colors: { background: '#ff0000' } },
      targets: {
        traework: { css: '--agentskin-background: #00ff00; --agentskin-accent: #ff0000;' },
      },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    // CSS-extracted colors should win over copy.colors
    expect(installed.colors).toBeDefined();
    expect(installed.colors?.background).toBe('#00ff00');
  });

  it('falls back to copy.colors when no CSS tokens are found', () => {
    const bundle = makeBundle({
      id: 'c-theme',
      displayName: 'C',
      copy: { colors: { background: '#ff0000', accent: '#00ff00' } },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.colors).toEqual({ background: '#ff0000', accent: '#00ff00' });
  });

  it('returns undefined colors when neither CSS tokens nor copy.colors exist', () => {
    const bundle = makeBundle({ id: 'c-theme', displayName: 'C' });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.colors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mode detection (toInstalledTheme) — detectMode via CSS colors
// ---------------------------------------------------------------------------

describe('mode detection (toInstalledTheme)', () => {
  it('infers dark mode from dark background in CSS tokens', () => {
    const bundle = makeBundle({
      id: 'm',
      displayName: 'M',
      targets: {
        traework: {
          css: '--agentskin-background: #000000; --agentskin-accent: #ff0000; --agentskin-text: #fff;',
        },
      },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.mode).toBe('dark');
  });

  it('infers light mode from light background in CSS tokens', () => {
    const bundle = makeBundle({
      id: 'm',
      displayName: 'M',
      targets: {
        traework: {
          css: '--agentskin-background: #ffffff; --agentskin-accent: #ff0000; --agentskin-text: #000;',
        },
      },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.mode).toBe('light');
  });

  it('prefers explicit mode from copy over inferred mode', () => {
    const bundle = makeBundle({
      id: 'm',
      displayName: 'M',
      copy: { mode: 'auto' },
      targets: {
        traework: { css: '--agentskin-background: #000000;' },
      },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.mode).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// legacyTargets (toInstalledTheme) — non-AgentId target keys
// ---------------------------------------------------------------------------

describe('legacyTargets (toInstalledTheme)', () => {
  it('separates known AgentIds from legacy target keys', () => {
    const bundle = makeBundle({
      id: 'lt',
      displayName: 'LT',
      targets: {
        traework: { css: 'body{}' },
        oldapp: { css: 'body{}' },
        workbuddy: { css: 'body{}' },
        deprecated: { css: 'body{}' },
      },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.supportedAgents).toEqual(expect.arrayContaining(['traework', 'workbuddy']));
    expect(installed.legacyTargets).toEqual(expect.arrayContaining(['oldapp', 'deprecated']));
  });
});

// ---------------------------------------------------------------------------
// author edge cases (toInstalledTheme)
// ---------------------------------------------------------------------------

describe('author edge cases (toInstalledTheme)', () => {
  it('returns undefined author when author object has non-string name', () => {
    const bundle = makeBundle({
      id: 'a',
      displayName: 'A',
      copy: { author: { name: 123, url: 'https://x.com' } },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.author).toBeUndefined();
  });

  it('returns undefined author when author is a number', () => {
    const bundle = makeBundle({ id: 'a', displayName: 'A', copy: { author: 42 } });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.author).toBeUndefined();
  });

  it('falls back to legacy top-level theme fields when copy is absent', () => {
    const bundle = makeBundle({
      id: 'legacy',
      displayName: 'Legacy',
      themeExtras: { author: 'Legacy Author', tagline: 'Old style', category: 'retro' },
    });
    const installed = toInstalledTheme({ bundle, filePath: '/fake' });
    expect(installed.author).toBe('Legacy Author');
    expect(installed.tagline).toBe('Old style');
    expect(installed.category).toBe('retro');
  });
});

// ---------------------------------------------------------------------------
// coverPathFor / iconPathFor (scheme handler path resolution)
// ---------------------------------------------------------------------------

describe('coverPathFor / iconPathFor', () => {
  it('returns null for an unknown theme id (no cached cover)', () => {
    expect(library.coverPathFor('nonexistent')).toBeNull();
    expect(library.iconPathFor('nonexistent')).toBeNull();
  });

  it('returns the cached cover/icon path after a theme with assets is installed', async () => {
    const bundle = {
      ...themePackage({ id: 'asset-theme' }),
      assets: {
        images: {
          hero: { filename: 'hero.png', mimeType: 'image/png', base64: 'aGVybw==' },
          icon: { filename: 'icon.png', mimeType: 'image/png', base64: 'aWNvbg==' },
        },
      },
    };
    await library.importPackage(await writePackage('asset.agentskin-theme', bundle));

    const coverPath = library.coverPathFor('asset-theme');
    const iconPath = library.iconPathFor('asset-theme');
    expect(coverPath).not.toBeNull();
    expect(iconPath).not.toBeNull();
    expect(fsSync.existsSync(coverPath!)).toBe(true);
    expect(fsSync.existsSync(iconPath!)).toBe(true);
  });

  it('returns null for coverPathFor when the theme has no cover asset', async () => {
    await library.importPackage(
      await writePackage('no-cover.agentskin-theme', themePackage({ id: 'no-cover' })),
    );
    expect(library.coverPathFor('no-cover')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exportPackage
// ---------------------------------------------------------------------------

describe('exportPackage', () => {
  it('copies an installed theme package to a destination path', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    const dest = path.join(sources, 'exported.agentskin-theme');
    await library.exportPackage('neon', dest);
    expect(fsSync.existsSync(dest)).toBe(true);
    // The exported file should be a valid theme package
    const reLibrary = new ThemeLibrary(await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-re-')));
    await reLibrary.initialize();
    const installed = await reLibrary.importPackage(dest);
    expect(installed.id).toBe('neon');
  });

  it('throws when exporting a non-existent theme', async () => {
    const dest = path.join(sources, 'nope.agentskin-theme');
    await expect(library.exportPackage('nonexistent', dest)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('delete', () => {
  it('removes an installed theme from the library', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    expect(await library.summaries()).toHaveLength(1);
    await library.delete('neon');
    expect(await library.summaries()).toHaveLength(0);
  });

  it('clears the cached cover when deleting a theme with assets', async () => {
    const bundle = {
      ...themePackage({ id: 'del-asset' }),
      assets: {
        images: {
          hero: { filename: 'hero.png', mimeType: 'image/png', base64: 'aGVybw==' },
        },
      },
    };
    await library.importPackage(await writePackage('del.agentskin-theme', bundle));
    const coverPath = library.coverPathFor('del-asset');
    expect(coverPath).not.toBeNull();
    await library.delete('del-asset');
    expect(library.coverPathFor('del-asset')).toBeNull();
  });

  it('does not throw when deleting a theme that was never installed', async () => {
    await expect(library.delete('never-installed')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// find (error path)
// ---------------------------------------------------------------------------

describe('find', () => {
  it('throws when the theme is not in the library', async () => {
    await expect(library.find('nonexistent')).rejects.toThrow();
  });

  it('returns the theme entry when found', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    const entry = await library.find('neon');
    expect(entry.bundle.theme.id).toBe('neon');
    expect(entry.filePath).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// entries (sorting + invalid package skipping)
// ---------------------------------------------------------------------------

describe('entries', () => {
  it('returns entries sorted by displayName', async () => {
    await library.importPackage(
      await writePackage('z.agentskin-theme', themePackage({ id: 'zebra', displayName: 'Zebra' })),
    );
    await library.importPackage(
      await writePackage('a.agentskin-theme', themePackage({ id: 'apple', displayName: 'Apple' })),
    );
    await library.importPackage(
      await writePackage('m.agentskin-theme', themePackage({ id: 'mango', displayName: 'Mango' })),
    );
    const list = await library.entries();
    const names = list.map((e) => e.bundle.theme.displayName);
    expect(names).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('skips invalid package files without throwing', async () => {
    // Install a valid theme
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    // Drop a broken .agentskin-theme file directly into the library root
    const brokenPath = path.join(root, 'broken.agentskin-theme');
    await fs.writeFile(brokenPath, '{ not valid json', 'utf8');
    const list = await library.entries();
    expect(list).toHaveLength(1);
    expect(list[0].bundle.theme.id).toBe('neon');
  });

  it('ignores non-theme files in the library directory', async () => {
    await library.importPackage(await writePackage('neon.agentskin-theme', themePackage()));
    await fs.writeFile(path.join(root, 'readme.txt'), 'hello', 'utf8');
    await fs.writeFile(path.join(root, 'notes.json'), '{}', 'utf8');
    const list = await library.entries();
    expect(list).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// installFile (error paths)
// ---------------------------------------------------------------------------

describe('installFile (error paths)', () => {
  it('throws when the source file does not exist (stat fails)', async () => {
    await expect(
      library.installFile(path.join(sources, 'nonexistent.agentskin-theme')),
    ).rejects.toThrow();
  });

  it('throws when the package exceeds the size limit', async () => {
    // Create a file larger than 50 MB by writing padding bytes
    const largePath = path.join(sources, 'large.agentskin-theme');
    const handle = await fs.open(largePath, 'w');
    // Write 51 MB of null bytes
    const chunkSize = 1024 * 1024;
    const buffer = Buffer.alloc(chunkSize, 0);
    for (let i = 0; i < 51; i++) {
      await handle.write(buffer);
    }
    await handle.close();
    await expect(library.installFile(largePath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// installBytes (error paths)
// ---------------------------------------------------------------------------

describe('installBytes (error paths)', () => {
  it('throws when bytes exceed the size limit', async () => {
    const largeBytes = Buffer.alloc(51 * 1024 * 1024, 0);
    await expect(library.installBytes(largeBytes, 'fallback')).rejects.toThrow();
  });

  it('throws when parsed bundle has an invalid theme id', async () => {
    const bundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: { id: 'bad id with spaces!', displayName: 'Bad', version: '1.0.0' },
      targets: { traework: { css: 'body{}' } },
    };
    await expect(
      library.installBytes(Buffer.from(JSON.stringify(bundle)), 'fallback'),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyDirectories (converts unpacked legacy codex-theme directories)
// ---------------------------------------------------------------------------

describe('migrateLegacyDirectories', () => {
  it('converts a legacy codex-theme directory to an agentskin-theme package', async () => {
    // Create a legacy directory structure inside the library root
    const legacyDir = path.join(root, 'legacy-theme');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'legacy-dir',
        displayName: 'Legacy Dir',
        version: '0.1.0',
        css: 'theme.css',
      }),
      'utf8',
    );
    await fs.writeFile(path.join(legacyDir, 'theme.css'), 'body { color: blue; }', 'utf8');

    // Re-initialize to trigger migration
    const newLib = new ThemeLibrary(root);
    await newLib.initialize();

    // The theme should be installed as a package
    const summaries = await newLib.summaries();
    const migrated = summaries.find((s) => s.id === 'legacy-dir');
    expect(migrated).toBeDefined();
    expect(migrated?.displayName).toBe('Legacy Dir');
  });

  it('converts a legacy directory with an art image', async () => {
    const legacyDir = path.join(root, 'art-theme');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'art-theme',
        displayName: 'Art Theme',
        version: '1.0.0',
        css: 'theme.css',
        art: 'cover.png',
      }),
      'utf8',
    );
    await fs.writeFile(path.join(legacyDir, 'theme.css'), 'body { color: red; }', 'utf8');
    // Write a minimal valid PNG (1x1 transparent)
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    await fs.writeFile(path.join(legacyDir, 'cover.png'), pngBytes);

    const newLib = new ThemeLibrary(root);
    await newLib.initialize();

    const summaries = await newLib.summaries();
    const migrated = summaries.find((s) => s.id === 'art-theme');
    expect(migrated).toBeDefined();
    expect(migrated?.coverDataUrl).toContain('data:image/png;base64,');
  });

  it('detects mimeType from art file extension (jpg, webp, gif)', async () => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const cases: Array<{ ext: string; expectedMime: string }> = [
      { ext: 'jpg', expectedMime: 'image/jpeg' },
      { ext: 'jpeg', expectedMime: 'image/jpeg' },
      { ext: 'webp', expectedMime: 'image/webp' },
      { ext: 'gif', expectedMime: 'image/gif' },
    ];
    for (const { ext } of cases) {
      const dirName = `art-${ext}`;
      const legacyDir = path.join(root, dirName);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyDir, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: dirName,
          displayName: dirName,
          version: '1.0.0',
          css: 'theme.css',
          art: `cover.${ext}`,
        }),
        'utf8',
      );
      await fs.writeFile(path.join(legacyDir, 'theme.css'), 'body{}', 'utf8');
      await fs.writeFile(path.join(legacyDir, `cover.${ext}`), pngBytes);
    }

    const newLib = new ThemeLibrary(root);
    await newLib.initialize();

    const summaries = await newLib.summaries();
    for (const { ext, expectedMime } of cases) {
      const migrated = summaries.find((s) => s.id === `art-${ext}`);
      expect(migrated).toBeDefined();
      expect(migrated?.coverDataUrl).toContain(`data:${expectedMime};base64,`);
    }
  });

  it('skips directories without a valid manifest (no manifest.json)', async () => {
    const junkDir = path.join(root, 'not-a-theme');
    await fs.mkdir(junkDir, { recursive: true });
    await fs.writeFile(path.join(junkDir, 'random.txt'), 'hello', 'utf8');

    const newLib = new ThemeLibrary(root);
    await newLib.initialize();
    // The junk directory should still be there (migration skipped it)
    expect(fsSync.existsSync(junkDir)).toBe(true);
    expect(await newLib.summaries()).toHaveLength(0);
  });

  it('skips directories with a manifest missing required fields', async () => {
    const noIdDir = path.join(root, 'no-id');
    await fs.mkdir(noIdDir, { recursive: true });
    await fs.writeFile(
      path.join(noIdDir, 'manifest.json'),
      JSON.stringify({ displayName: 'No ID', css: 'theme.css' }),
      'utf8',
    );
    await fs.writeFile(path.join(noIdDir, 'theme.css'), 'body{}', 'utf8');

    const newLib = new ThemeLibrary(root);
    await newLib.initialize();
    expect(fsSync.existsSync(noIdDir)).toBe(true);
    expect(await newLib.summaries()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// packagePath (invalid id validation)
// ---------------------------------------------------------------------------

describe('packagePath validation', () => {
  it('throws when themeId contains unsafe characters', async () => {
    // find() calls packagePath() internally
    await expect(library.find('bad id!')).rejects.toThrow();
    await expect(library.find('../escape')).rejects.toThrow();
  });

  it('throws when deleting a theme with an unsafe id', async () => {
    await expect(library.delete('bad/id')).rejects.toThrow();
  });
});
