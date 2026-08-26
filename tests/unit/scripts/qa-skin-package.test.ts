// SPDX-License-Identifier: MPL-2.0

/**
 * qa-skin-package.mjs — 20 tests
 *
 * Covers: manifest format validation, CSS syntax check, image resources,
 * script executability, directory structure, path leakage, and sensitive info.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkCssSyntax,
  checkDirectoryStructure,
  checkImageResources,
  checkManifestFormat,
  checkNoAbsolutePathLeakage,
  checkNoSensitiveInfo,
  checkScriptExecutability,
  qaSkinPackage,
} from '../../../scripts/qa-skin-package.mjs';

/** Create a unique temp directory for each test run. */
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `qa-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

/**
 * Helper: create a minimal valid scaffolded package for QA testing.
 */
function createValidPackage(dir: string) {
  mkdirSync(join(dir, 'assets', 'css'), { recursive: true });
  mkdirSync(join(dir, 'assets', 'images'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      $schema: 'https://agentskin.dev/schema/manifest-v2.json',
      schemaVersion: 2,
      id: 'test-theme',
      name: 'test-theme',
      displayName: 'Test Theme',
      version: '1.0.0',
      description: 'A test theme',
      mode: 'dark',
      colors: {
        accent: '#7c9cff',
        secondary: '#f097c8',
        background: '#13171a',
        foreground: '#f4f0eb',
        muted: '#cbc9c6',
        surface: '#292d30',
        surfaceElevated: '#373b3e',
        border: 'rgba(124,156,255,0.18)',
        codeBackground: '#111517',
        codeForeground: '#f4f0eb',
        inputBackground: '#24292c',
        buttonBackground: '#7c9cff',
        buttonForeground: '#ffffff',
        focusRing: '#7c9cff60',
      },
      targets: {
        workbuddy: { css: 'assets/css/workbuddy.css' },
      },
      supportedAgents: ['workbuddy'],
      icon: 'icon.png',
      preview: 'preview.png',
    }),
    'utf8',
  );

  writeFileSync(
    join(dir, 'assets', 'css', 'workbuddy.css'),
    ':root { color-scheme: dark !important; --agentskin-accent: #7c9cff; --agentskin-secondary: #f097c8; --agentskin-bg: #13171a; --agentskin-surface: #292d30; --agentskin-surface-elevated: #373b3e; --agentskin-text: #f4f0eb; --agentskin-muted: #cbc9c6; --agentskin-border: rgba(124,156,255,0.18); --agentskin-code-bg: #111517; --agentskin-code-fg: #f4f0eb; --agentskin-input-bg: #24292c; --agentskin-button-bg: #7c9cff; --agentskin-focus-ring: #7c9cff60; --agentskin-selection: #7c9cff52; }\n',
    'utf8',
  );

  // Fake image files
  writeFileSync(join(dir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  writeFileSync(
    join(dir, 'scripts', 'install.mjs'),
    '// install script\nconsole.log("installed");',
    'utf8',
  );
  writeFileSync(
    join(dir, 'scripts', 'verify.mjs'),
    '// verify script\nconsole.log("verified");',
    'utf8',
  );
  writeFileSync(
    join(dir, 'scripts', 'restore.mjs'),
    '// restore script\nconsole.log("restored");',
    'utf8',
  );

  writeFileSync(join(dir, 'SKILL.md'), '# Test Theme\n', 'utf8');
  writeFileSync(join(dir, 'README.md'), '# Test Theme\n', 'utf8');
}

// ---------------------------------------------------------------------------
// checkDirectoryStructure
// ---------------------------------------------------------------------------

describe('checkDirectoryStructure', () => {
  it('passes for a complete package', () => {
    createValidPackage(testDir);
    const result = checkDirectoryStructure(testDir);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('error');
  });

  it('fails when manifest.json is missing', () => {
    mkdirSync(join(testDir, 'assets', 'css'), { recursive: true });
    mkdirSync(join(testDir, 'assets', 'images'), { recursive: true });
    mkdirSync(join(testDir, 'scripts'), { recursive: true });
    writeFileSync(join(testDir, 'SKILL.md'), '');
    writeFileSync(join(testDir, 'README.md'), '');
    const result = checkDirectoryStructure(testDir);
    expect(result.passed).toBe(false);
  });

  it('fails when assets/css is missing', () => {
    writeFileSync(join(testDir, 'manifest.json'), '{}');
    const result = checkDirectoryStructure(testDir);
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkManifestFormat
// ---------------------------------------------------------------------------

describe('checkManifestFormat', () => {
  it('passes for a valid manifest', () => {
    createValidPackage(testDir);
    const result = checkManifestFormat(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails when manifest.json is missing', () => {
    const result = checkManifestFormat(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('fails for invalid JSON', () => {
    writeFileSync(join(testDir, 'manifest.json'), '{ invalid json }');
    const result = checkManifestFormat(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not valid JSON');
  });

  it('fails when required color keys are missing', () => {
    writeFileSync(
      join(testDir, 'manifest.json'),
      JSON.stringify({
        id: 'test',
        name: 'test',
        version: '1.0.0',
        colors: { accent: '#fff' },
        targets: { workbuddy: { css: 'assets/css/workbuddy.css' } },
        supportedAgents: ['workbuddy'],
      }),
    );
    const result = checkManifestFormat(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('missing keys');
  });

  it('fails when supportedAgents is empty', () => {
    writeFileSync(
      join(testDir, 'manifest.json'),
      JSON.stringify({
        id: 'test',
        name: 'test',
        version: '1.0.0',
        colors: {
          accent: '#7c9cff',
          secondary: '#f097c8',
          background: '#13171a',
          foreground: '#f4f0eb',
          muted: '#cbc9c6',
          surface: '#292d30',
          surfaceElevated: '#373b3e',
          border: 'rgba(124,156,255,0.18)',
          codeBackground: '#111517',
          codeForeground: '#f4f0eb',
          focusRing: '#7c9cff60',
          buttonBackground: '#7c9cff',
          inputBackground: '#24292c',
        },
        targets: { workbuddy: { css: 'assets/css/workbuddy.css' } },
        supportedAgents: [],
      }),
    );
    const result = checkManifestFormat(testDir);
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkCssSyntax
// ---------------------------------------------------------------------------

describe('checkCssSyntax', () => {
  it('passes for valid CSS', () => {
    createValidPackage(testDir);
    const result = checkCssSyntax(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails for unbalanced braces', () => {
    mkdirSync(join(testDir, 'assets', 'css'), { recursive: true });
    writeFileSync(
      join(testDir, 'manifest.json'),
      JSON.stringify({ targets: { workbuddy: { css: 'assets/css/workbuddy.css' } } }),
    );
    writeFileSync(join(testDir, 'assets', 'css', 'workbuddy.css'), ':root { color-scheme: dark; ');
    const result = checkCssSyntax(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('unclosed');
  });

  it('fails for missing required tokens', () => {
    mkdirSync(join(testDir, 'assets', 'css'), { recursive: true });
    writeFileSync(
      join(testDir, 'manifest.json'),
      JSON.stringify({ targets: { workbuddy: { css: 'assets/css/workbuddy.css' } } }),
    );
    writeFileSync(join(testDir, 'assets', 'css', 'workbuddy.css'), ':root { color-scheme: dark; }');
    const result = checkCssSyntax(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('missing');
  });

  it('fails when CSS file is missing', () => {
    writeFileSync(
      join(testDir, 'manifest.json'),
      JSON.stringify({ targets: { workbuddy: { css: 'assets/css/workbuddy.css' } } }),
    );
    const result = checkCssSyntax(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// checkImageResources
// ---------------------------------------------------------------------------

describe('checkImageResources', () => {
  it('passes when icon and preview exist', () => {
    createValidPackage(testDir);
    const result = checkImageResources(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails when icon is missing', () => {
    createValidPackage(testDir);
    rmSync(join(testDir, 'icon.png'));
    const result = checkImageResources(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('icon');
  });
});

// ---------------------------------------------------------------------------
// checkScriptExecutability
// ---------------------------------------------------------------------------

describe('checkScriptExecutability', () => {
  it('passes when all scripts exist and are valid', () => {
    createValidPackage(testDir);
    const result = checkScriptExecutability(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails when scripts directory is missing', () => {
    const result = checkScriptExecutability(testDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('fails for unbalanced braces in scripts', () => {
    mkdirSync(join(testDir, 'scripts'), { recursive: true });
    writeFileSync(join(testDir, 'scripts', 'install.mjs'), '{ broken');
    writeFileSync(join(testDir, 'scripts', 'verify.mjs'), '// ok');
    writeFileSync(join(testDir, 'scripts', 'restore.mjs'), '// ok');
    const result = checkScriptExecutability(testDir);
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkNoAbsolutePathLeakage
// ---------------------------------------------------------------------------

describe('checkNoAbsolutePathLeakage', () => {
  it('passes for a clean package', () => {
    createValidPackage(testDir);
    const result = checkNoAbsolutePathLeakage(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails when a file contains a Windows absolute path', () => {
    createValidPackage(testDir);
    writeFileSync(join(testDir, 'README.md'), '# Theme\nBuilt at C:\\Users\\dev\\project\n');
    const result = checkNoAbsolutePathLeakage(testDir);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// checkNoSensitiveInfo
// ---------------------------------------------------------------------------

describe('checkNoSensitiveInfo', () => {
  it('passes for a clean package', () => {
    createValidPackage(testDir);
    const result = checkNoSensitiveInfo(testDir);
    expect(result.passed).toBe(true);
  });

  it('fails when a file contains an API key pattern', () => {
    createValidPackage(testDir);
    writeFileSync(
      join(testDir, 'scripts', 'install.mjs'),
      '// api_key = "sk-abc123def456ghi789jkl012mno345pq"\n',
    );
    const result = checkNoSensitiveInfo(testDir);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// qaSkinPackage (full runner)
// ---------------------------------------------------------------------------

describe('qaSkinPackage', () => {
  it('passes for a valid package', () => {
    createValidPackage(testDir);
    const result = qaSkinPackage(testDir);
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('reports errors for an invalid package', () => {
    const result = qaSkinPackage(testDir);
    expect(result.passed).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('returns all 7 checks', () => {
    createValidPackage(testDir);
    const result = qaSkinPackage(testDir);
    expect(result.checks).toHaveLength(7);
  });
});
