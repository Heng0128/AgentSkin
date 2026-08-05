// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledTheme } from '../../shared/types';
import type { ThemeLibraryApi } from '../services/contracts';
import {
  pruneRemovedBuiltInThemes,
  REMOVED_BUILTIN_THEME_IDS,
  seedBuiltInThemes,
} from './theme-seeder';

/** A 1x1 transparent PNG so manifest icon/preview checks pass. */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Minimal v1 manifest that passes ThemePackageLoader validation. */
function minimalManifest(themeId: string): string {
  return JSON.stringify({
    id: themeId,
    name: `Test ${themeId}`,
    version: '1.0.0',
    description: 'seeder regression test',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark',
    colors: { background: '#050816', foreground: '#e0e8ff' },
  });
}

/** Write a complete minimal theme package directory on disk. */
async function writePackage(root: string, themeId: string): Promise<void> {
  const dir = path.join(root, themeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), minimalManifest(themeId), 'utf8');
  await fs.writeFile(path.join(dir, 'icon.png'), Buffer.from(PLACEHOLDER_PNG, 'base64'));
  await fs.writeFile(path.join(dir, 'preview.png'), Buffer.from(PLACEHOLDER_PNG, 'base64'));
}

/** Fake library that records which themes were installed / deleted. */
function createFakeLibrary(): ThemeLibraryApi & {
  installedIds: string[];
  deletedIds: string[];
} {
  const state = { installedIds: [] as string[], deletedIds: [] as string[] };
  const library: ThemeLibraryApi = {
    initialize: async () => {},
    entries: async () => [],
    summaries: async () => [],
    coverPathFor: () => null,
    iconPathFor: () => null,
    find: async (id: string) => ({ id }) as never,
    installFile: async (sourcePath: string) => {
      // The installer writes the bundle JSON to a temp file; parse the real
      // theme id so the test can assert exactly which themes got installed.
      const raw = await fs.readFile(sourcePath, 'utf8');
      const bundle = JSON.parse(raw) as { theme?: { id?: string } };
      const id = bundle.theme?.id ?? 'unknown';
      state.installedIds.push(id);
      return {
        id,
        displayName: id,
        version: '1.0.0',
        supportedAgents: [],
        coverDataUrl: null,
        tagline: null,
      } as InstalledTheme;
    },
    installBytes: async () =>
      ({
        id: 'x',
        displayName: 'x',
        version: '1.0.0',
        supportedAgents: [],
        coverDataUrl: null,
        tagline: null,
      }) as InstalledTheme,
    importPackage: async () =>
      ({
        id: 'x',
        displayName: 'x',
        version: '1.0.0',
        supportedAgents: [],
        coverDataUrl: null,
        tagline: null,
      }) as InstalledTheme,
    inspectPackage: async () => ({}) as never,
    exportPackage: async () => {},
    delete: async (themeId: string) => {
      state.deletedIds.push(themeId);
    },
  };
  return Object.assign(library, state);
}

describe('seedBuiltInThemes — removed themes must never be reseeded', () => {
  let themesRoot: string;

  beforeEach(async () => {
    themesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-seed-test-'));
  });

  afterEach(async () => {
    await fs.rm(themesRoot, { recursive: true, force: true });
  });

  it('only installs shipped themes, skipping every REMOVED_BUILTIN_THEME_IDS package', async () => {
    // Pick two ids from the actual removed list so the test tracks the list.
    const removedA = REMOVED_BUILTIN_THEME_IDS[0];
    const removedB = REMOVED_BUILTIN_THEME_IDS[1];
    const kept = 'nordic-minimal'; // a shipped theme id (not in the removed list)
    await writePackage(themesRoot, removedA);
    await writePackage(themesRoot, removedB);
    await writePackage(themesRoot, kept);

    const library = createFakeLibrary();
    // No installed snapshots → every scanned package would be installed
    // without the removed-filter. This is exactly the bug: on a fresh boot
    // the seeder re-installs every theme directory that still exists.
    const installed = await seedBuiltInThemes(library, themesRoot, new Map());

    // Only the kept theme was installed.
    expect(installed.map((t) => t.id)).toEqual([kept]);
    // installFile was reached exactly once — for the kept theme.
    expect(library.installedIds.length).toBe(1);
  });

  it('pruneRemovedBuiltInThemes deletes lingering removed themes from the library', async () => {
    // Themes installed by an older version survive in userData (the installer
    // does not wipe it). Pruning must remove them.
    const removedA = REMOVED_BUILTIN_THEME_IDS[0];
    const library = createFakeLibrary();
    await pruneRemovedBuiltInThemes(library, new Set([removedA, 'nordic-minimal']));
    expect(library.deletedIds).toEqual([removedA]);
  });
});
