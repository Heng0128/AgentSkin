// SPDX-License-Identifier: MPL-2.0

/**
 * # check-themes.test.mjs
 *
 * Unit tests for the layered validation logic in check-themes.mjs:
 *   - detectThemeSource  (priority-based source detection)
 *   - validateThemeMetadataInline  (P2 署名链 compliance)
 *   - Full flow integration (source → token set selection)
 */

import { describe, expect, it } from 'vitest';
import { detectThemeSource, validateThemeMetadataInline } from './check-themes.mjs';

// ---------------------------------------------------------------------------
// detectThemeSource
// ---------------------------------------------------------------------------

describe('detectThemeSource', () => {
  const FAKE_DIR = '/fake/themes/test-theme';

  it('returns "community" when manifest has a "community" tag', () => {
    const manifest = {
      id: 'some-theme',
      tags: ['community', 'dark'],
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('community');
  });

  it('returns "community" when manifest has a "community" tag (case-insensitive)', () => {
    const manifest = {
      id: 'some-theme',
      tags: ['Community'],
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('community');
  });

  it('returns "community" when id starts with "community-"', () => {
    const manifest = {
      id: 'community-my-theme',
      tags: [],
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('community');
  });

  it('returns "community" (tag takes priority over builtin id)', () => {
    // Even if the id is in the builtin list, community tag wins
    const manifest = {
      id: 'galactic-garden',
      tags: ['community'],
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('community');
  });

  it('returns "builtin" when author.name is "Auto-generated"', () => {
    const manifest = {
      id: 'custom-theme',
      author: { name: 'Auto-generated' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('builtin');
  });

  it('returns "builtin" when author.name is "AgentSkin Team"', () => {
    const manifest = {
      id: 'custom-theme',
      author: { name: 'AgentSkin Team' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('builtin');
  });

  it('returns "builtin" when author.name is "Internal"', () => {
    const manifest = {
      id: 'custom-theme',
      author: { name: 'Internal' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('builtin');
  });

  it('returns "builtin" when id is in BUILTIN_THEME_IDS', () => {
    const manifest = {
      id: 'galactic-garden',
      author: { name: 'External Author' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('builtin');
  });

  it('returns "imported" for an external theme with no community/builtin signals', () => {
    const manifest = {
      id: 'my-custom-theme',
      author: { name: 'John Doe' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('imported');
  });

  it('returns "imported" when manifest has empty tags and unknown author', () => {
    const manifest = {
      id: 'another-theme',
      tags: [],
      author: { name: 'Someone' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('imported');
  });

  it('returns "imported" when manifest has no author and unknown id', () => {
    const manifest = {
      id: 'unknown-theme',
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('imported');
  });

  it('falls back to path basename when manifest.id is missing for builtin check', () => {
    // id is undefined → uses path.basename(themeDir) = 'test-theme'
    // 'test-theme' is not in BUILTIN_THEME_IDS → imported
    const manifest = {
      author: { name: 'Unknown' },
    };
    expect(detectThemeSource(FAKE_DIR, manifest)).toBe('imported');
  });
});

// ---------------------------------------------------------------------------
// validateThemeMetadataInline
// ---------------------------------------------------------------------------

describe('validateThemeMetadataInline', () => {
  it('returns no errors and no warnings when all fields are present and valid', () => {
    const manifest = {
      author: { name: 'AgentSkin Team', url: 'https://example.com' },
      license: 'MPL-2.0',
      version: '1.0.0',
      colors: { accent: '#a78bfa' },
      wiring: { id: 'ui-skin-cyber-neon' },
    };
    const result = validateThemeMetadataInline(manifest, 'test-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns a warning (not error) when author is missing', () => {
    const manifest = {
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'no-author-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing author');
  });

  it('returns a warning when author.name is empty string', () => {
    const manifest = {
      author: { name: '   ' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'empty-author-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing author');
  });

  it('returns a warning (not error) when license is missing', () => {
    const manifest = {
      author: { name: 'John' },
      version: '2.0.0',
      colors: { accent: '#00ff00' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'no-license-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing license');
  });

  it('returns a warning (not error) when wiring.id is missing', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#0000ff' },
    };
    const result = validateThemeMetadataInline(manifest, 'no-wiring-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing wiring.id');
  });

  it('returns a warning when wiring.id does not match the required pattern', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#0000ff' },
      wiring: { id: 'Invalid_Uppercase' },
    };
    const result = validateThemeMetadataInline(manifest, 'bad-wiring-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('wiring.id');
    expect(result.warnings[0]).toContain('should match pattern');
  });

  it('returns an error when version is missing (blocking for all sources)', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'no-version-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('missing required version');
  });

  it('returns an error when version is not valid semver', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: 'v1.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'bad-version-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('not valid semver');
  });

  it('returns an error when accent color is missing (blocking for all sources)', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: '1.0.0',
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'no-accent-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('missing required accent color');
  });

  it('returns an error when accent color is not a valid CSS hex color', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: 'red' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'bad-accent-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('not a valid CSS color');
  });

  it('accepts colors.primary as fallback for accent', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'MIT',
      version: '1.0.0',
      colors: { primary: '#a78bfa' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'primary-theme', 'builtin');
    expect(result.errs).toHaveLength(0);
  });

  it('returns an error when license is unknown SPDX identifier', () => {
    const manifest = {
      author: { name: 'John' },
      license: 'Custom-License',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'unknown-license-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('not a known SPDX identifier');
  });

  it('returns an error when author.url is not a valid URL', () => {
    const manifest = {
      author: { name: 'John', url: 'not-a-url' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'bad-url-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('not a valid URL');
  });

  it('returns an error when author.url uses disallowed protocol', () => {
    const manifest = {
      author: { name: 'John', url: 'ftp://example.com' },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'ftp-url-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('must be an http, https, or mailto URL');
  });

  it('returns an error when author.url is not a string', () => {
    const manifest = {
      author: { name: 'John', url: 123 },
      license: 'MIT',
      version: '1.0.0',
      colors: { accent: '#ff0000' },
      wiring: { id: 'valid-id' },
    };
    const result = validateThemeMetadataInline(manifest, 'num-url-theme', 'builtin');
    expect(result.errs).toHaveLength(1);
    expect(result.errs[0]).toContain('must be a string');
  });

  it('accumulates multiple errors and warnings simultaneously', () => {
    const manifest = {
      // no author → warning
      // no license → warning
      version: 'invalid', // error
      colors: { accent: 'blue' }, // error
      // no wiring.id → warning
    };
    const result = validateThemeMetadataInline(manifest, 'multi-issue-theme', 'builtin');
    expect(result.errs).toHaveLength(2); // version + accent
    expect(result.warnings).toHaveLength(3); // author + license + wiring.id
  });
});

// ---------------------------------------------------------------------------
// Full flow integration — source detection drives token set selection
// ---------------------------------------------------------------------------

describe('full flow — source drives validation level', () => {
  it('builtin theme: detectThemeSource returns "builtin" → standard token set (14 tokens)', () => {
    const manifest = {
      id: 'galactic-garden',
      author: { name: 'AgentSkin Team' },
      license: 'MPL-2.0',
      version: '1.0.0',
      colors: { accent: '#a78bfa' },
      wiring: { id: 'valid-id' },
    };
    const source = detectThemeSource('/fake/themes/galactic-garden', manifest);
    expect(source).toBe('builtin');

    // Builtin → standard level → full 14 tokens required
    const STANDARD_TOKENS = [
      '--agentskin-accent',
      '--agentskin-bg',
      '--agentskin-text',
      '--agentskin-surface',
      '--agentskin-muted',
      '--agentskin-border',
      '--agentskin-secondary',
      '--agentskin-code-bg',
      '--agentskin-code-fg',
      '--agentskin-surface-elevated',
      '--agentskin-input-bg',
      '--agentskin-button-bg',
      '--agentskin-button-fg',
      '--agentskin-focus-ring',
    ];
    expect(STANDARD_TOKENS).toHaveLength(14);

    // Metadata validation passes for a complete builtin theme
    const { errs, warnings } = validateThemeMetadataInline(manifest, 'galactic-garden', source);
    expect(errs).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('community theme: detectThemeSource returns "community" → relaxed token set (core 8)', () => {
    const manifest = {
      id: 'community-neon-wave',
      tags: ['community'],
      author: { name: 'Community Contributor' },
      license: 'CC-BY-NC-SA-4.0',
      version: '1.0.0',
      colors: { accent: '#ff6600' },
      wiring: { id: 'neon-wave' },
    };
    const source = detectThemeSource('/fake/themes/community-neon-wave', manifest);
    expect(source).toBe('community');

    // Community → relaxed level → core 8 tokens only
    const CORE_8_TOKENS = [
      '--agentskin-accent',
      '--agentskin-bg',
      '--agentskin-text',
      '--agentskin-surface',
      '--agentskin-muted',
      '--agentskin-border',
      '--agentskin-secondary',
      '--agentskin-code-bg',
    ];
    expect(CORE_8_TOKENS).toHaveLength(8);

    // Metadata validation passes for a complete community theme
    const { errs, warnings } = validateThemeMetadataInline(manifest, 'community-neon-wave', source);
    expect(errs).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('imported theme: detectThemeSource returns "imported" → relaxed token set (core 8)', () => {
    const manifest = {
      id: 'my-imported-theme',
      author: { name: 'External Author' },
      license: 'MIT',
      version: '2.1.0',
      colors: { accent: '#10b981' },
      wiring: { id: 'imported-skin' },
    };
    const source = detectThemeSource('/fake/themes/my-imported-theme', manifest);
    expect(source).toBe('imported');

    // Imported → relaxed level → core 8 tokens only
    const CORE_8_TOKENS = [
      '--agentskin-accent',
      '--agentskin-bg',
      '--agentskin-text',
      '--agentskin-surface',
      '--agentskin-muted',
      '--agentskin-border',
      '--agentskin-secondary',
      '--agentskin-code-bg',
    ];
    expect(CORE_8_TOKENS).toHaveLength(8);

    // Metadata validation passes for a complete imported theme
    const { errs, warnings } = validateThemeMetadataInline(manifest, 'my-imported-theme', source);
    expect(errs).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('community theme with missing author/license/wiring.id produces warnings but no errors', () => {
    const manifest = {
      id: 'community-minimal',
      tags: ['community'],
      version: '1.0.0',
      colors: { accent: '#e11d48' },
    };
    const source = detectThemeSource('/fake/themes/community-minimal', manifest);
    expect(source).toBe('community');

    const { errs, warnings } = validateThemeMetadataInline(manifest, 'community-minimal', source);
    expect(errs).toHaveLength(0);
    expect(warnings).toHaveLength(3); // author + license + wiring.id
    expect(warnings.some((w) => w.includes('missing author'))).toBe(true);
    expect(warnings.some((w) => w.includes('missing license'))).toBe(true);
    expect(warnings.some((w) => w.includes('missing wiring.id'))).toBe(true);
  });

  it('imported theme with missing author/license/wiring.id produces warnings but no errors', () => {
    const manifest = {
      id: 'imported-minimal',
      version: '0.1.0',
      colors: { accent: '#6366f1' },
    };
    const source = detectThemeSource('/fake/themes/imported-minimal', manifest);
    expect(source).toBe('imported');

    const { errs, warnings } = validateThemeMetadataInline(manifest, 'imported-minimal', source);
    expect(errs).toHaveLength(0);
    expect(warnings).toHaveLength(3); // author + license + wiring.id
  });

  it('builtin theme with missing version/accent produces blocking errors', () => {
    const manifest = {
      id: 'void-donut-boy',
      author: { name: 'AgentSkin Team' },
      license: 'MPL-2.0',
      wiring: { id: 'valid-id' },
    };
    const source = detectThemeSource('/fake/themes/void-donut-boy', manifest);
    expect(source).toBe('builtin');

    const { errs, warnings } = validateThemeMetadataInline(manifest, 'void-donut-boy', source);
    expect(errs).toHaveLength(2); // version + accent
    expect(errs.some((e) => e.includes('missing required version'))).toBe(true);
    expect(errs.some((e) => e.includes('missing required accent color'))).toBe(true);
    // author present, license present, wiring.id present → 0 warnings
    expect(warnings).toHaveLength(0);
  });
});
