// SPDX-License-Identifier: MPL-2.0

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  componentSpecificToCss,
  filterByAgent,
  loadVariations,
  tokenOverridesToCss,
} from '../../scripts/variations-loader.mjs';

describe('tokenOverridesToCss', () => {
  it('returns empty string for empty object', () => {
    expect(tokenOverridesToCss({})).toBe('');
  });

  it('generates correct CSS block with overrides', () => {
    const css = tokenOverridesToCss({
      '--radius': '8px',
      '--shadow-card': '0 2px 8px rgba(0,0,0,0.1)',
    });
    expect(css).toContain('--radius: 8px;');
    expect(css).toContain('--shadow-card: 0 2px 8px rgba(0,0,0,0.1);');
    expect(css).toContain(':root');
  });

  it('uses custom host selector', () => {
    const css = tokenOverridesToCss({ '--radius': '4px' }, '.theme-soft');
    expect(css).toContain('.theme-soft');
    expect(css).not.toContain(':root');
  });
});

describe('componentSpecificToCss', () => {
  it('returns empty string for empty object', () => {
    expect(componentSpecificToCss({})).toBe('');
  });

  it('generates correct CSS rules with component comments', () => {
    const css = componentSpecificToCss({ button: 'border-radius:9999px' });
    expect(css).toContain('/* button */');
    expect(css).toContain('border-radius:9999px');
  });

  it('handles multiple components', () => {
    const css = componentSpecificToCss({
      button: 'color:red',
      card: 'padding:16px',
    });
    expect(css).toContain('/* button */');
    expect(css).toContain('/* card */');
  });
});

describe('filterByAgent', () => {
  it('keeps variations with empty agents (support all)', () => {
    const variations = [{ id: 'v1', name: 'V1', css: '', agents: [] }];
    expect(filterByAgent(variations, 'traework')).toHaveLength(1);
  });

  it('keeps variations that explicitly support the agent', () => {
    const variations = [{ id: 'v1', name: 'V1', css: '', agents: ['traework', 'codex'] }];
    expect(filterByAgent(variations, 'traework')).toHaveLength(1);
  });

  it('filters out variations that do not support the agent', () => {
    const variations = [{ id: 'v1', name: 'V1', css: '', agents: ['codex'] }];
    expect(filterByAgent(variations, 'traework')).toHaveLength(0);
  });

  it('handles mixed variations correctly', () => {
    const variations = [
      { id: 'v1', name: 'V1', css: '', agents: [] },
      { id: 'v2', name: 'V2', css: '', agents: ['codex'] },
      { id: 'v3', name: 'V3', css: '', agents: ['traework'] },
    ];
    const result = filterByAgent(variations, 'traework');
    expect(result.map((v) => v.id)).toEqual(['v1', 'v3']);
  });
});

describe('loadVariations (integration)', () => {
  it('loads variations from a temp theme directory', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'variations-test-'));
    await writeFile(
      join(tmp, 'manifest.json'),
      JSON.stringify({
        componentVariations: {
          soft: { path: 'variations/soft.json', name: 'Soft Rounded' },
        },
      }),
    );
    await mkdir(join(tmp, 'variations'));
    await writeFile(
      join(tmp, 'variations/soft.json'),
      JSON.stringify({
        id: 'soft',
        name: 'Soft',
        tokenOverrides: { '--radius': '8px' },
      }),
    );

    const result = await loadVariations(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('soft');
    expect(result[0].name).toBe('Soft');
    expect(result[0].css).toContain('--radius: 8px');
  });

  it('returns empty array when manifest has no componentVariations', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'variations-test-'));
    await writeFile(join(tmp, 'manifest.json'), JSON.stringify({ id: 'test' }));
    const result = await loadVariations(tmp);
    expect(result).toEqual([]);
  });

  it('skips variation files missing id field', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'variations-test-'));
    await writeFile(
      join(tmp, 'manifest.json'),
      JSON.stringify({
        componentVariations: { bad: { path: 'variations/bad.json' } },
      }),
    );
    await mkdir(join(tmp, 'variations'));
    await writeFile(join(tmp, 'variations/bad.json'), JSON.stringify({ name: 'No ID' }));

    const result = await loadVariations(tmp);
    expect(result).toHaveLength(0);
  });
});
