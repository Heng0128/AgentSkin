// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeLibrary } from './theme-library';

let root = '';
let sources = '';
let library: ThemeLibrary;

function themePackage(overrides: { id?: string; displayName?: string; version?: string } = {}) {
  return {
    format: 'codedrobe-theme',
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
    const source = await writePackage('neon.codedrobe-theme', themePackage());
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
    await library.importPackage(await writePackage('neon.codedrobe-theme', themePackage()));
    const update = await writePackage('neon-2.codedrobe-theme', themePackage({ version: '2.0.0' }));
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
      supportedAgents: [],
      legacyTargets: ['codex'],
    });
    expect(inspection.existing).toBeNull();
  });

  it('rejects unknown extensions and invalid packages', async () => {
    await expect(library.inspectPackage(path.join(sources, 'note.txt'))).rejects.toThrow();
    const broken = await writePackage('broken.codedrobe-theme', { format: 'codedrobe-theme' });
    await expect(library.inspectPackage(broken)).rejects.toThrow();
  });
});

describe('importPackage', () => {
  it('installs a package and replaces same-id installs atomically', async () => {
    await library.importPackage(await writePackage('neon.codedrobe-theme', themePackage()));
    const updated = await library.importPackage(
      await writePackage('neon-2.codedrobe-theme', themePackage({ version: '2.0.0' })),
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
      format: 'codedrobe-theme',
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
    const source = await writePackage('icon-theme.codedrobe-theme', bundle);
    const installed = await library.importPackage(source);
    expect(installed.iconDataUrl).toBe('data:image/png;base64,dGVzdA==');
    expect(installed.icon).toBe('data:image/png;base64,dGVzdA==');
    expect(installed.coverDataUrl).toBe('data:image/png;base64,aGVybw==');
  });

  it('has null iconDataUrl when bundle has no icon asset', async () => {
    const source = await writePackage('no-icon.codedrobe-theme', themePackage({ id: 'no-icon' }));
    const installed = await library.importPackage(source);
    expect(installed.iconDataUrl).toBeNull();
    expect(installed.icon).toBeNull();
  });
});

// --- Catalog metadata propagation (Task 3/4) ---

describe('catalog metadata propagation', () => {
  it('reads author, category, tags and explicit supportedAgents from theme.copy', async () => {
    const bundle = {
      format: 'codedrobe-theme',
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
      await writePackage('meta.codedrobe-theme', bundle),
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
      format: 'codedrobe-theme',
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
      await writePackage('obj.codedrobe-theme', bundle),
    );
    expect(installed.author).toBe('Team X');
    expect(installed.supportedAgents).toEqual(['traework']);
  });
});
