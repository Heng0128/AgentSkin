// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from './theme-manifest';
import {
  extractThemeMetadata,
  isAttributionCompliant,
  KNOWN_LICENSES,
  validateThemeMetadata,
} from './theme-metadata';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validManifest(): ThemeManifest {
  return {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    version: '1.0.0',
    description: 'A valid test theme.',
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
    targets: {
      traework: { css: 'assets/css/traework.css' },
      qoderwork: { css: 'assets/css/qoderwork.css' },
      workbuddy: { css: 'assets/css/workbuddy.css' },
      doubao: { css: 'assets/css/doubao.css' },
      codex: { css: 'assets/css/codex.css' },
      zcode: { css: 'assets/css/zcode.css' },
    },
    supportedAgents: ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'],
    category: 'cyberpunk',
    tags: ['neon', 'dark'],
    license: 'MPL-2.0',
    wiring: { id: 'ui-skin-cyber-neon', bundleWired: false },
  };
}

// ---------------------------------------------------------------------------
// validateThemeMetadata — strict mode
// ---------------------------------------------------------------------------

describe('validateThemeMetadata — strict mode', () => {
  it('accepts a fully compliant manifest', () => {
    const result = validateThemeMetadata(validManifest(), 'strict');
    expect(result.compliant).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing author', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).author;
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'author')).toBe(true);
  });

  it('reports empty author.name', () => {
    const m = validManifest();
    m.author = { name: '' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'author.name')).toBe(true);
  });

  it('reports invalid author.url', () => {
    const m = validManifest();
    m.author = { name: 'tester', url: 'not-a-url' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'author.url')).toBe(true);
  });

  it('reports missing license', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).license;
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'license')).toBe(true);
  });

  it('warns on unknown license (non-blocking)', () => {
    const m = validManifest();
    m.license = 'Custom-License';
    const result = validateThemeMetadata(m, 'strict');
    // Unknown license is a warning, not an error
    expect(result.compliant).toBe(true);
    expect(result.warnings.some((w) => w.path === 'license')).toBe(true);
  });

  it('reports missing version', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).version;
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('reports invalid semver', () => {
    const m = validManifest();
    m.version = 'not-a-version';
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('reports missing accent color', () => {
    const m = validManifest();
    delete (m.colors as unknown as Record<string, string>).accent;
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'colors.accent')).toBe(true);
  });

  it('falls back to colors.primary when accent is absent', () => {
    const m = validManifest();
    const colors = m.colors as unknown as Record<string, string>;
    delete colors.accent;
    colors.primary = '#ff0000';
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(true);
  });

  it('reports missing wiring.id', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).wiring;
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'wiring.id')).toBe(true);
  });

  it('reports invalid wiring.id format', () => {
    const m = validManifest();
    m.wiring = { id: 'Invalid_Uppercase' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'wiring.id')).toBe(true);
  });

  it('accepts valid wiring.id with hyphens and underscores', () => {
    const m = validManifest();
    m.wiring = { id: 'ui-skin_cyber-neon-01' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateThemeMetadata — lenient mode
// ---------------------------------------------------------------------------

describe('validateThemeMetadata — lenient mode', () => {
  it('downgrades missing author to warning in lenient mode', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).author;
    const result = validateThemeMetadata(m, 'lenient');
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.path === 'author')).toBe(true);
  });

  it('downgrades missing wiring.id to warning in lenient mode', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).wiring;
    const result = validateThemeMetadata(m, 'lenient');
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.path === 'wiring.id')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractThemeMetadata
// ---------------------------------------------------------------------------

describe('extractThemeMetadata', () => {
  it('extracts all fields from a valid manifest', () => {
    const meta = extractThemeMetadata(validManifest());
    expect(meta.author.name).toBe('tester');
    expect(meta.author.url).toBe('https://example.com');
    expect(meta.license).toBe('MPL-2.0');
    expect(meta.version).toBe('1.0.0');
    expect(meta.accent).toBe('#00ffff');
    expect(meta.wiringId).toBe('ui-skin-cyber-neon');
  });

  it('fills defaults for missing fields', () => {
    const meta = extractThemeMetadata({
      id: 'bare',
      name: 'Bare',
      version: '',
      icon: 'i.png',
      preview: 'p.png',
      colors: { background: '#000', foreground: '#fff' },
    });
    expect(meta.author.name).toBe('');
    expect(meta.license).toBe('');
    expect(meta.accent).toBe('');
    expect(meta.wiringId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isAttributionCompliant
// ---------------------------------------------------------------------------

describe('isAttributionCompliant', () => {
  it('returns true for a compliant manifest', () => {
    expect(isAttributionCompliant(validManifest())).toBe(true);
  });

  it('returns false for a manifest missing author', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).author;
    expect(isAttributionCompliant(m)).toBe(false);
  });

  it('returns false for a manifest missing wiring', () => {
    const m = validManifest();
    delete (m as unknown as Record<string, unknown>).wiring;
    expect(isAttributionCompliant(m)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KNOWN_LICENSES
// ---------------------------------------------------------------------------

describe('KNOWN_LICENSES', () => {
  it('includes common open-source licenses', () => {
    expect(KNOWN_LICENSES).toContain('MPL-2.0');
    expect(KNOWN_LICENSES).toContain('MIT');
    expect(KNOWN_LICENSES).toContain('Apache-2.0');
    expect(KNOWN_LICENSES).toContain('GPL-3.0');
  });

  it('includes CC licenses (for community themes)', () => {
    expect(KNOWN_LICENSES).toContain('CC-BY-NC-SA-4.0');
    expect(KNOWN_LICENSES).toContain('CC-BY-4.0');
  });

  it('includes Proprietary for closed-source themes', () => {
    expect(KNOWN_LICENSES).toContain('Proprietary');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles author with only name (no url)', () => {
    const m = validManifest();
    m.author = { name: 'solo-author' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(true);
  });

  it('rejects whitespace-only author.name', () => {
    const m = validManifest();
    m.author = { name: '   ' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
  });

  it('accepts pre-release semver', () => {
    const m = validManifest();
    m.version = '2.0.0-beta.1';
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(true);
  });

  it('rejects malformed accent color', () => {
    const m = validManifest();
    (m.colors as unknown as Record<string, string>).accent = 'not-a-color';
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
    expect(result.errors.some((e) => e.path === 'colors.accent')).toBe(true);
  });

  it('accepts 8-digit hex accent color', () => {
    const m = validManifest();
    (m.colors as unknown as Record<string, string>).accent = '#00ffff80';
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(true);
  });

  it('rejects wiring.id starting with a hyphen', () => {
    const m = validManifest();
    m.wiring = { id: '-bad-start' };
    const result = validateThemeMetadata(m, 'strict');
    expect(result.compliant).toBe(false);
  });
});
