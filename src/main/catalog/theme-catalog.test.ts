// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { AgentId, InstalledTheme } from '../../shared/types';
import { ThemeCatalog, type ThemeDataProvider } from './theme-catalog';

const mockThemes: InstalledTheme[] = [
  {
    id: 'neon',
    displayName: 'Neon',
    version: '1.0.0',
    supportedAgents: ['traework', 'workbuddy'] as AgentId[],
    legacyTargets: [],
    coverDataUrl: 'data:image/png;base64,abc',
    tagline: 'A neon theme',
    icon: 'data:image/png;base64,icon-abc',
  },
  {
    id: 'retro',
    displayName: 'Retro',
    version: '0.3.0',
    supportedAgents: [] as AgentId[],
    legacyTargets: ['codex'],
    coverDataUrl: null,
    tagline: null,
    icon: null,
  },
  {
    id: 'dark-ai',
    displayName: 'Dark AI',
    version: '2.1.0',
    supportedAgents: ['qoderwork'] as AgentId[],
    legacyTargets: [],
    coverDataUrl: null,
    tagline: 'Dark mode for AI coding',
    icon: 'data:image/png;base64,icon-dark',
  },
];

const mockSource: ThemeDataProvider = {
  summaries: async () => mockThemes,
};

describe('ThemeCatalog', () => {
  const catalog = new ThemeCatalog(mockSource);

  describe('listThemes', () => {
    it('returns all themes as catalog items', async () => {
      const themes = await catalog.listThemes();
      expect(themes).toHaveLength(3);
      expect(themes.map((t) => t.id)).toEqual(['neon', 'retro', 'dark-ai']);
    });

    it('maps displayName to name', async () => {
      const themes = await catalog.listThemes();
      expect(themes[0].name).toBe('Neon');
    });

    it('maps tagline to description', async () => {
      const themes = await catalog.listThemes();
      expect(themes[0].description).toBe('A neon theme');
    });

    it('uses empty string for null tagline', async () => {
      const themes = await catalog.listThemes();
      expect(themes[1].description).toBe('');
    });

    it('preserves legacyTargets', async () => {
      const themes = await catalog.listThemes();
      expect(themes[1].legacyTargets).toEqual(['codex']);
    });

    it('marks all themes as installed', async () => {
      const themes = await catalog.listThemes();
      expect(themes.every((t) => t.installed)).toBe(true);
    });

    it('sets source to local for library themes', async () => {
      const themes = await catalog.listThemes();
      expect(themes.every((t) => t.source === 'local')).toBe(true);
    });
  });

  describe('getTheme', () => {
    it('returns a single theme by id', async () => {
      const theme = await catalog.getTheme('neon');
      expect(theme).not.toBeNull();
      expect(theme!.id).toBe('neon');
      expect(theme!.version).toBe('1.0.0');
    });

    it('returns null for unknown id', async () => {
      expect(await catalog.getTheme('unknown')).toBeNull();
    });
  });

  describe('searchThemes', () => {
    it('matches by name (case-insensitive)', async () => {
      const results = await catalog.searchThemes('DARK');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('dark-ai');
    });

    it('matches by description', async () => {
      const results = await catalog.searchThemes('neon theme');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('neon');
    });

    it('returns all themes for empty query', async () => {
      const results = await catalog.searchThemes('');
      expect(results).toHaveLength(3);
    });

    it('returns empty for no match', async () => {
      const results = await catalog.searchThemes('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('filterByAgent', () => {
    it('returns themes supporting the given agent', async () => {
      const results = await catalog.filterByAgent('traework');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('neon');
    });

    it('returns empty when no themes support the agent', async () => {
      // T4: previously used 'workbuddy', but 'neon' supports workbuddy — so
      // the assertion (length 1) contradicted the test name. Use 'doubao'
      // instead: no theme in the mock data declares doubao in its
      // supportedAgents, so this actually exercises the empty-result path.
      const results = await catalog.filterByAgent('doubao');
      expect(results).toHaveLength(0);
    });

    it('returns themes with empty supportedAgents for no match', async () => {
      const results = await catalog.filterByAgent('qoderwork');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('dark-ai');
    });
  });

  // --- P3.1 icon propagation tests ---

  describe('icon propagation (P3.1)', () => {
    it('uses icon from InstalledTheme.icon as primary source', async () => {
      const themes = await catalog.listThemes();
      const neon = themes.find((t) => t.id === 'neon');
      expect(neon!.icon).toBe('data:image/png;base64,icon-abc');
    });

    it('sets icon to null when no icon available', async () => {
      const themes = await catalog.listThemes();
      const retro = themes.find((t) => t.id === 'retro');
      expect(retro!.icon).toBe(null);
    });

    it('propagates icon for themes with icon data', async () => {
      const themes = await catalog.listThemes();
      const darkAi = themes.find((t) => t.id === 'dark-ai');
      expect(darkAi!.icon).toBe('data:image/png;base64,icon-dark');
    });
  });
});

describe('ThemeCatalog scheme merging (v2.2+)', () => {
  const base: InstalledTheme = {
    id: 'nordic-minimal',
    displayName: '极简北欧',
    version: '2.2.0',
    supportedAgents: ['traework'] as AgentId[],
    legacyTargets: [],
    coverDataUrl: 'data:image/png;base64,c',
    tagline: 't',
    icon: null,
    colors: { accent: '#c41e2a', background: '#0a0a14' },
    mode: 'dark',
    scheme: 'default',
    colorSchemes: ['nord', 'tokyo-night'],
    schemes: [
      { id: 'default', name: 'Default', colors: { accent: '#c41e2a' } },
      { id: 'nord', name: 'Nord', colors: { accent: '#88c0d0' } },
      { id: 'tokyo-night', name: 'Tokyo Night', colors: { accent: '#7aa2f7' } },
    ],
  };
  const nordVariant: InstalledTheme = {
    ...base,
    id: 'nordic-minimal--nord',
    displayName: '极简北欧 · Nord',
    scheme: 'nord',
    colors: { accent: '#88c0d0', background: '#10141c' },
  };
  const tokyoVariant: InstalledTheme = {
    ...base,
    id: 'nordic-minimal--tokyo-night',
    displayName: '极简北欧 · Tokyo Night',
    scheme: 'tokyo-night',
    colors: { accent: '#7aa2f7', background: '#12141f' },
  };

  it('merges scheme variants into a single entry with per-scheme colors', async () => {
    const catalog = new ThemeCatalog({
      summaries: async () => [base, nordVariant, tokyoVariant],
    });
    const themes = await catalog.listThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe('nordic-minimal');
    expect(themes[0].schemes).toEqual([
      { id: 'default', name: 'Default', colors: { accent: '#c41e2a', background: '#0a0a14' } },
      { id: 'nord', name: 'Nord', colors: { accent: '#88c0d0', background: '#10141c' } },
      {
        id: 'tokyo-night',
        name: 'Tokyo Night',
        colors: { accent: '#7aa2f7', background: '#12141f' },
      },
    ]);
  });

  it('passes themes without scheme metadata through unchanged', async () => {
    const plain: InstalledTheme = { ...base, schemes: undefined, colorSchemes: undefined };
    const catalog = new ThemeCatalog({ summaries: async () => [plain] });
    const themes = await catalog.listThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0].schemes).toBeUndefined();
  });
});
