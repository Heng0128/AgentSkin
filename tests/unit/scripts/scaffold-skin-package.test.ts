// SPDX-License-Identifier: MPL-2.0

/**
 * scaffold-skin-package.mjs — 25 tests
 *
 * Covers: argument parsing, validation, color derivation, manifest/CSS/script
 * generation, and end-to-end scaffold output.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveColors,
  generateCss,
  generateInstallScript,
  generateManifest,
  generateReadme,
  generateRestoreScript,
  generateSkillMd,
  generateVerifyScript,
  MANIFEST_COLOR_KEYS,
  parseArgs,
  SUPPORTED_AGENTS,
  scaffoldSkinPackage,
  validateOptions,
} from '../../../scripts/scaffold-skin-package.mjs';
import { REQUIRED_TOKENS } from '../../../scripts/theme-tokens.mjs';

/** Create a unique temp directory for each test run. */
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `scaffold-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses --key value form', () => {
    const opts = parseArgs(['--name', 'My Theme', '--agent', 'workbuddy']);
    expect(opts.name).toBe('My Theme');
    expect(opts.agent).toBe('workbuddy');
  });

  it('parses --key=value form', () => {
    const opts = parseArgs(['--name=My Theme', '--agent=codex']);
    expect(opts.name).toBe('My Theme');
    expect(opts.agent).toBe('codex');
  });

  it('parses dotted keys into nested objects', () => {
    const opts = parseArgs(['--colors.primary', '#ff0000']);
    expect(opts.colors).toEqual({ primary: '#ff0000' });
  });

  it('handles boolean flags (no value)', () => {
    const opts = parseArgs(['--unofficial']);
    expect(opts.unofficial).toBe(true);
  });

  it('returns empty object for empty argv', () => {
    expect(parseArgs([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// validateOptions
// ---------------------------------------------------------------------------

describe('validateOptions', () => {
  it('returns no errors for valid options', () => {
    const errors = validateOptions({
      name: 'Test Theme',
      slug: 'test-theme',
      agent: 'workbuddy',
      output: testDir,
    });
    expect(errors).toEqual([]);
  });

  it('reports missing --name', () => {
    const errors = validateOptions({ slug: 'test', agent: 'codex', output: testDir });
    expect(errors.some((e) => e.includes('--name'))).toBe(true);
  });

  it('reports invalid slug with uppercase', () => {
    const errors = validateOptions({
      name: 'Test',
      slug: 'Invalid_Slug',
      agent: 'codex',
      output: testDir,
    });
    expect(errors.some((e) => e.includes('Invalid slug'))).toBe(true);
  });

  it('reports unsupported agent', () => {
    const errors = validateOptions({
      name: 'Test',
      slug: 'test-slug',
      agent: 'unknown-agent',
      output: testDir,
    });
    expect(errors.some((e) => e.includes('Unsupported agent'))).toBe(true);
  });

  it('reports invalid color values', () => {
    const errors = validateOptions({
      name: 'Test',
      slug: 'test-slug',
      agent: 'codex',
      output: testDir,
      colors: { accent: 'not-a-color' },
    });
    expect(errors.some((e) => e.includes('Invalid color'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveColors
// ---------------------------------------------------------------------------

describe('deriveColors', () => {
  it('returns all 14 keys when given empty input', () => {
    const colors = deriveColors({});
    expect(Object.keys(colors).length).toBeGreaterThanOrEqual(14);
    expect(colors.accent).toBeTruthy();
    expect(colors.background).toBeTruthy();
  });

  it('preserves provided colors', () => {
    const colors = deriveColors({ accent: '#ff0000', background: '#000000' });
    expect(colors.accent).toBe('#ff0000');
    expect(colors.background).toBe('#000000');
  });

  it('derives dark mode colors for dark background', () => {
    const colors = deriveColors({ background: '#13171a' });
    expect(colors.foreground).toBeTruthy();
  });

  it('derives light mode colors for light background', () => {
    const colors = deriveColors({ background: '#f5f5f7' });
    expect(colors.foreground).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  const baseOptions = {
    name: 'Test Theme',
    slug: 'test-theme',
    agent: 'workbuddy' as const,
    output: testDir,
  };

  it('generates a valid manifest with all required fields', () => {
    const manifest = generateManifest(baseOptions);
    expect(manifest.id).toBe('test-theme');
    expect(manifest.name).toBe('test-theme');
    expect(manifest.displayName).toBe('Test Theme');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.schemaVersion).toBe(2);
  });

  it('contains all 13 manifest color keys', () => {
    const manifest = generateManifest(baseOptions);
    for (const key of MANIFEST_COLOR_KEYS) {
      expect(typeof manifest.colors[key]).toBe('string', `Missing color key: ${key}`);
    }
  });

  it('sets supportedAgents to the target agent', () => {
    const manifest = generateManifest(baseOptions);
    expect(manifest.supportedAgents).toEqual(['workbuddy']);
  });

  it('sets mode to dark for dark backgrounds', () => {
    const manifest = generateManifest({
      ...baseOptions,
      colors: { background: '#13171a' },
    });
    expect(manifest.mode).toBe('dark');
  });

  it('sets mode to light for light backgrounds', () => {
    const manifest = generateManifest({
      ...baseOptions,
      colors: { background: '#f5f5f7' },
    });
    expect(manifest.mode).toBe('light');
  });

  it('includes targets with CSS path', () => {
    const manifest = generateManifest(baseOptions);
    expect(manifest.targets.workbuddy).toBeDefined();
    expect(manifest.targets.workbuddy.css).toBe('assets/css/workbuddy.css');
  });
});

// ---------------------------------------------------------------------------
// generateCss
// ---------------------------------------------------------------------------

describe('generateCss', () => {
  const baseOptions = {
    name: 'Test Theme',
    slug: 'test-theme',
    agent: 'workbuddy' as const,
    output: testDir,
  };

  it('declares all 14 required --agentskin-* tokens', () => {
    const css = generateCss(baseOptions);
    for (const token of REQUIRED_TOKENS) {
      expect(css).toContain(`${token}:`);
    }
  });

  it('includes the host selector for the target agent', () => {
    const css = generateCss(baseOptions);
    expect(css).toContain('body[data-application-name="workbuddy"]');
  });

  it('includes color-scheme matching the mode', () => {
    const css = generateCss(baseOptions);
    expect(css).toContain('color-scheme:');
  });

  it('generates different CSS for different agents', () => {
    const cssWorkbuddy = generateCss(baseOptions);
    const cssCodex = generateCss({ ...baseOptions, agent: 'codex' });
    expect(cssWorkbuddy).not.toBe(cssCodex);
  });
});

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

describe('script generation', () => {
  const baseOptions = {
    name: 'Test Theme',
    slug: 'test-theme',
    agent: 'workbuddy' as const,
    output: testDir,
  };

  it('generateInstallScript includes the slug', () => {
    const script = generateInstallScript(baseOptions);
    expect(script).toContain('test-theme');
    expect(script).toContain('Install');
  });

  it('generateVerifyScript includes manifest check', () => {
    const script = generateVerifyScript(baseOptions);
    expect(script).toContain('manifest.json');
    expect(script).toContain('test-theme');
  });

  it('generateRestoreScript includes removal logic', () => {
    const script = generateRestoreScript(baseOptions);
    expect(script).toContain('test-theme');
    expect(script).toContain('rmSync');
  });
});

// ---------------------------------------------------------------------------
// SKILL.md + README.md generation
// ---------------------------------------------------------------------------

describe('documentation generation', () => {
  const baseOptions = {
    name: 'Test Theme',
    slug: 'test-theme',
    agent: 'workbuddy' as const,
    output: testDir,
  };

  it('generateSkillMd includes token table', () => {
    const md = generateSkillMd(baseOptions);
    expect(md).toContain('Test Theme');
    expect(md).toContain('--agentskin-accent');
  });

  it('generateReadme includes directory structure', () => {
    const md = generateReadme(baseOptions);
    expect(md).toContain('Test Theme');
    expect(md).toContain('manifest.json');
    expect(md).toContain('assets/css');
  });
});

// ---------------------------------------------------------------------------
// End-to-end scaffold
// ---------------------------------------------------------------------------

describe('scaffoldSkinPackage (end-to-end)', () => {
  it('creates the full directory structure', () => {
    const dir = scaffoldSkinPackage({
      name: 'E2E Theme',
      slug: 'e2e-theme',
      agent: 'codex',
      output: join(testDir, 'e2e-theme'),
    });

    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dir, 'assets', 'css', 'codex.css'))).toBe(true);
    expect(existsSync(join(dir, 'assets', 'images'))).toBe(true);
    expect(existsSync(join(dir, 'scripts', 'install.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'scripts', 'verify.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'scripts', 'restore.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
  });

  it('writes a valid manifest.json', () => {
    const dir = scaffoldSkinPackage({
      name: 'Manifest Test',
      slug: 'manifest-test',
      agent: 'traework',
      output: join(testDir, 'manifest-test'),
    });
    const raw = readFileSync(join(dir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(raw);
    expect(manifest.id).toBe('manifest-test');
    expect(manifest.supportedAgents).toEqual(['traework']);
  });

  it('writes CSS with all 14 tokens', () => {
    const dir = scaffoldSkinPackage({
      name: 'CSS Test',
      slug: 'css-test',
      agent: 'doubao',
      output: join(testDir, 'css-test'),
    });
    const css = readFileSync(join(dir, 'assets', 'css', 'doubao.css'), 'utf-8');
    for (const token of REQUIRED_TOKENS) {
      expect(css).toContain(`${token}:`);
    }
  });

  it('throws on invalid options', () => {
    expect(() =>
      scaffoldSkinPackage({
        name: '',
        slug: 'bad slug!',
        agent: 'invalid',
        output: testDir,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_AGENTS constant
// ---------------------------------------------------------------------------

describe('SUPPORTED_AGENTS', () => {
  it('contains exactly 6 agents', () => {
    expect(SUPPORTED_AGENTS).toHaveLength(6);
  });

  it('includes all expected agent ids', () => {
    for (const agent of ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']) {
      expect(SUPPORTED_AGENTS).toContain(agent);
    }
  });
});
