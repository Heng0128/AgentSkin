// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { formatSchemaErrors, KNOWN_AGENT_IDS, validateManifest } from './manifest-validator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validManifest(): Record<string, unknown> {
  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    id: 'cyber-neon',
    name: 'Cyber Neon',
    displayName: '赛博霓虹',
    version: '1.0.0',
    description: 'A valid test theme for the validator suite.',
    author: { name: 'tester', url: 'https://example.com' },
    mode: 'dark',
    colors: {
      accent: '#00ffff',
      background: '#050816',
      foreground: '#e0e8ff',
      surface: '#0a0a12',
    },
    icon: 'icon.png',
    preview: 'preview.png',
    hero: 'hero.png',
    targets: {
      traework: { css: 'assets/css/traework.css' },
      zcode: { css: 'assets/css/zcode.css' },
    },
    supportedAgents: ['traework', 'zcode'],
    category: 'cyberpunk',
    tags: ['neon', 'dark'],
    license: 'MPL-2.0',
    unofficial: true,
  };
}

// ---------------------------------------------------------------------------
// Core schema validation
// ---------------------------------------------------------------------------

describe('validateManifest — core schema', () => {
  it('accepts a valid manifest', () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it('rejects a manifest missing colors.background with a JSON path', () => {
    const m = validManifest();
    delete (m.colors as Record<string, unknown>).background;
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path === 'colors' && e.message.includes('background'))).toBe(true);
  });

  it('rejects a manifest with unknown top-level properties', () => {
    const m = validManifest();
    (m as Record<string, unknown>).bogusField = 'x';
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === '' && e.message.includes('bogusField'))).toBe(true);
  });

  it('rejects an invalid mode enum', () => {
    const m = validManifest();
    (m as Record<string, unknown>).mode = 'neon';
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'mode')).toBe(true);
  });

  it('rejects an invalid schemaVersion', () => {
    const m = validManifest();
    // schemaVersion 99 is not in the allowed enum [1, 2, 3]
    (m as Record<string, unknown>).schemaVersion = 99;
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'schemaVersion')).toBe(true);
  });

  it('rejects a non-semver version', () => {
    const m = validManifest();
    (m as Record<string, unknown>).version = 'not-a-version';
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('rejects a targets entry missing css', () => {
    const m = validManifest();
    (m.targets as Record<string, unknown>).traework = {};
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'targets.traework' && e.message.includes('css'))).toBe(
      true,
    );
  });

  it('accepts a v1-style manifest (no targets, v1 color names)', () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).targets;
    delete (m as Record<string, unknown>).supportedAgents;
    (m as Record<string, unknown>).schemaVersion = 1;
    (m.colors as Record<string, unknown>).primary = '#00ffff';
    (m.colors as Record<string, unknown>).text = '#e0e8ff';
    expect(validateManifest(m)).toEqual([]);
  });

  it('accepts wallpaper with workshopId (Steam reference) — matches loader contract', () => {
    const m = validManifest();
    (m as Record<string, unknown>).wallpaper = { workshopId: '1234567890' };
    expect(validateManifest(m)).toEqual([]);
  });

  it('rejects wallpaper with neither workshopId nor video', () => {
    const m = validManifest();
    (m as Record<string, unknown>).wallpaper = { speed: 2.0 };
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'wallpaper')).toBe(true);
  });

  it('rejects a non-numeric workshopId', () => {
    const m = validManifest();
    (m as Record<string, unknown>).wallpaper = { workshopId: 'abc' };
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'wallpaper.workshopId')).toBe(true);
  });

  it('rejects fonts entries missing src (array item path)', () => {
    const m = validManifest();
    (m as Record<string, unknown>).fonts = [{ family: 'Custom' }];
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'fonts[0]' && e.message.includes('src'))).toBe(true);
  });

  it('rejects out-of-range wallpaper speed', () => {
    const m = validManifest();
    (m as Record<string, unknown>).wallpaper = { video: 'bg.mp4', speed: 9.9 };
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'wallpaper.speed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-field checks (SPEC-3)
// ---------------------------------------------------------------------------

describe('validateManifest — cross-field (SPEC-3)', () => {
  it('rejects a targets key that is not a known agent id', () => {
    const m = validManifest();
    (m.targets as Record<string, unknown>).traewrok = { css: 'a.css' }; // typo
    const errors = validateManifest(m);
    expect(
      errors.some((e) => e.path === 'targets.traewrok' && e.message.includes('unknown agent')),
    ).toBe(true);
  });

  it('rejects unknown ids in supportedAgents', () => {
    const m = validManifest();
    (m as Record<string, unknown>).supportedAgents = ['traework', 'nonsense'];
    const errors = validateManifest(m);
    expect(
      errors.some((e) => e.path === 'supportedAgents[1]' && e.message.includes('nonsense')),
    ).toBe(true);
  });

  it('rejects supportedAgents that omit a targets key', () => {
    const m = validManifest();
    (m as Record<string, unknown>).supportedAgents = ['traework'];
    const errors = validateManifest(m);
    expect(errors.some((e) => e.path === 'supportedAgents' && e.message.includes('zcode'))).toBe(
      true,
    );
  });

  it('rejects unknown agent ids (experimental removed in v1.4)', () => {
    const m = validManifest();
    (m.targets as Record<string, unknown>).codebuddy = { css: 'codebuddy.css' };
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.path.includes('codebuddy') && e.message.includes('unknown agent')),
    ).toBe(true);
  });

  it('KNOWN_AGENT_IDS covers the six active product agents (v1.4)', () => {
    for (const id of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
      expect(KNOWN_AGENT_IDS).toContain(id);
    }
    // v1.4: Experimental removed
    expect(KNOWN_AGENT_IDS).not.toContain('codebuddy');
    expect(KNOWN_AGENT_IDS).not.toContain('marscode');
  });
});

// ---------------------------------------------------------------------------
// formatSchemaErrors
// ---------------------------------------------------------------------------

describe('formatSchemaErrors', () => {
  it('renders root-path errors without a dangling dot', () => {
    const line = formatSchemaErrors([{ path: '', message: 'expected object' }]);
    expect(line).toBe('<root>: expected object');
  });

  it('joins multiple errors with a separator', () => {
    const line = formatSchemaErrors([
      { path: 'a', message: 'x' },
      { path: 'b.c', message: 'y' },
    ]);
    expect(line).toContain('a: x');
    expect(line).toContain('b.c: y');
  });
});

describe('validateManifest — colorSchemes (v2.2+)', () => {
  it('accepts valid colorSchemes ids', () => {
    const manifest = validManifest();
    manifest.colorSchemes = ['nord', 'tokyo-night'];
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('rejects a reserved "default" scheme id', () => {
    const manifest = validManifest();
    manifest.colorSchemes = ['default'];
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.path === 'colorSchemes[0]' && e.message.includes('reserved'))).toBe(
      true,
    );
  });

  it('rejects an invalid scheme id (path separators)', () => {
    const manifest = validManifest();
    manifest.colorSchemes = ['../evil'];
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.path === 'colorSchemes[0]')).toBe(true);
  });

  it('rejects duplicate scheme ids', () => {
    const manifest = validManifest();
    manifest.colorSchemes = ['nord', 'nord'];
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  it('rejects non-array colorSchemes', () => {
    const manifest = validManifest();
    manifest.colorSchemes = 'nord';
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.path === 'colorSchemes')).toBe(true);
  });
});
