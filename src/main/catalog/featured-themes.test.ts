// SPDX-License-Identifier: MPL-2.0

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyFeaturedConfig, getFeaturedThemes, loadFeaturedList } from './featured-themes';
import type { ThemeManifest } from './theme-manifest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTheme(overrides: Partial<ThemeManifest> = {}): ThemeManifest {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    colors: { background: '#000', foreground: '#fff' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getFeaturedThemes — filter by featured flag
// ---------------------------------------------------------------------------

describe('getFeaturedThemes', () => {
  it('returns only themes with featured: true', () => {
    const themes = [
      makeTheme({ id: 'a', name: 'Alpha', featured: true }),
      makeTheme({ id: 'b', name: 'Beta' }),
      makeTheme({ id: 'c', name: 'Gamma', featured: false }),
      makeTheme({ id: 'd', name: 'Delta', featured: true }),
    ];
    const result = getFeaturedThemes(themes);
    expect(result.map((t) => t.id)).toEqual(['a', 'd']);
  });

  it('returns empty array when no themes are featured', () => {
    const themes = [makeTheme({ id: 'a' }), makeTheme({ id: 'b', featured: false })];
    expect(getFeaturedThemes(themes)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(getFeaturedThemes([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getFeaturedThemes — sort by priority
// ---------------------------------------------------------------------------

describe('getFeaturedThemes — sorting', () => {
  it('sorts by priority descending', () => {
    const themes = [
      makeTheme({ id: 'low', name: 'Low', featured: true, priority: 1 }),
      makeTheme({ id: 'high', name: 'High', featured: true, priority: 10 }),
      makeTheme({ id: 'mid', name: 'Mid', featured: true, priority: 5 }),
    ];
    const result = getFeaturedThemes(themes);
    expect(result.map((t) => t.id)).toEqual(['high', 'mid', 'low']);
  });

  it('sorts alphabetically when priorities are equal', () => {
    const themes = [
      makeTheme({ id: 'zebra', name: 'Zebra', featured: true, priority: 5 }),
      makeTheme({ id: 'alpha', name: 'Alpha', featured: true, priority: 5 }),
      makeTheme({ id: 'mid', name: 'Mid', featured: true, priority: 5 }),
    ];
    const result = getFeaturedThemes(themes);
    expect(result.map((t) => t.id)).toEqual(['alpha', 'mid', 'zebra']);
  });

  it('treats missing priority as 0', () => {
    const themes = [
      makeTheme({ id: 'no-priority', name: 'No Priority', featured: true }),
      makeTheme({ id: 'with-priority', name: 'With Priority', featured: true, priority: 3 }),
    ];
    const result = getFeaturedThemes(themes);
    expect(result.map((t) => t.id)).toEqual(['with-priority', 'no-priority']);
  });
});

// ---------------------------------------------------------------------------
// loadFeaturedList — config file loading
// ---------------------------------------------------------------------------

describe('loadFeaturedList', () => {
  it('reads featured IDs from a valid config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(
      configPath,
      JSON.stringify({ featured: ['theme-a', 'theme-b'], updatedAt: '2026-01-15T10:30:00Z' }),
    );
    const result = await loadFeaturedList(configPath);
    expect(result).toEqual(['theme-a', 'theme-b']);
  });

  it('returns empty array when config file does not exist', async () => {
    const result = await loadFeaturedList('/nonexistent/path/featured-themes.json');
    expect(result).toEqual([]);
  });

  it('returns empty array for malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, '{ not valid json }');
    const result = await loadFeaturedList(configPath);
    expect(result).toEqual([]);
  });

  it('returns empty array when featured is not an array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, JSON.stringify({ featured: 'not-an-array' }));
    const result = await loadFeaturedList(configPath);
    expect(result).toEqual([]);
  });

  it('returns empty array when featured contains non-string entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, JSON.stringify({ featured: ['valid', 123, null] }));
    const result = await loadFeaturedList(configPath);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyFeaturedConfig — merge manifest and config
// ---------------------------------------------------------------------------

describe('applyFeaturedConfig', () => {
  it('combines manifest-featured and config-featured themes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, JSON.stringify({ featured: ['config-only'] }));

    const themes = [
      makeTheme({ id: 'manifest-only', name: 'Manifest Only', featured: true }),
      makeTheme({ id: 'config-only', name: 'Config Only' }),
      makeTheme({ id: 'not-featured', name: 'Not Featured' }),
    ];
    const result = await applyFeaturedConfig(themes, configPath);
    expect(result.map((t) => t.id).sort()).toEqual(['config-only', 'manifest-only']);
  });

  it('skips config IDs that are not installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, JSON.stringify({ featured: ['installed', 'not-installed'] }));

    const themes = [makeTheme({ id: 'installed', name: 'Installed', featured: true })];
    const result = await applyFeaturedConfig(themes, configPath);
    expect(result.map((t) => t.id)).toEqual(['installed']);
  });

  it('falls back to manifest-only when config file is missing', async () => {
    const themes = [
      makeTheme({ id: 'a', name: 'Alpha', featured: true }),
      makeTheme({ id: 'b', name: 'Beta' }),
    ];
    const result = await applyFeaturedConfig(themes, '/nonexistent/config.json');
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('sorts combined results by priority then name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentskin-featured-'));
    const configPath = join(dir, 'featured-themes.json');
    await writeFile(configPath, JSON.stringify({ featured: ['config-theme'] }));

    const themes = [
      makeTheme({ id: 'config-theme', name: 'Config Theme' }),
      makeTheme({ id: 'high-priority', name: 'High Priority', featured: true, priority: 10 }),
      makeTheme({ id: 'low-priority', name: 'Low Priority', featured: true, priority: 1 }),
    ];
    const result = await applyFeaturedConfig(themes, configPath);
    expect(result.map((t) => t.id)).toEqual(['high-priority', 'low-priority', 'config-theme']);
  });
});
