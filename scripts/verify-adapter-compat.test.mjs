// SPDX-License-Identifier: MPL-2.0
//
// Tests for verify-adapter-compat.mjs — CI Adapter Compatibility Verification.
//
// Covers: complete theme verification, missing token detection, manifest
// schema error detection, adapter CSS missing detection, image reference
// missing detection, CSS syntax validation, bracket matching, and edge cases.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_TOKENS,
  discoverThemes,
  extractPaletteTokens,
  KNOWN_ADAPTERS,
  PALETTE_TOKENS,
  validateCssSyntax,
  validateManifest,
  verifyTheme,
} from './verify-adapter-compat.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a directory path exists (recursive mkdir).
 * @param {string} dir
 */
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Create a temporary directory with sample theme files.
 * @param {Record<string, string>} files - Map of relative path to content.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function createTempTheme(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agentskin-compat-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    ensureDir(resolve(fullPath, '..'));
    writeFileSync(fullPath, content, 'utf8');
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Generate a palette CSS string with all 12 core tokens declared.
 * @returns {string}
 */
function makeFullPaletteCss() {
  return `:root {\n${PALETTE_TOKENS.map((t) => `  ${t}: #value;`).join('\n')}\n}`;
}

/**
 * Generate a palette CSS string with only some tokens (missing the rest).
 * @param {number} count - How many tokens to include.
 * @returns {string}
 */
function makePartialPaletteCss(count) {
  return `:root {\n${PALETTE_TOKENS.slice(0, count)
    .map((t) => `  ${t}: #value;`)
    .join('\n')}\n}`;
}

/**
 * Generate a valid adapter CSS string (bracket-balanced).
 * @returns {string}
 */
function makeAdapterCss() {
  return `html.agentskin-host-traework {\n  --agentskin-accent: #afcad2;\n  --agentskin-bg: #13171a;\n}\n`;
}

/**
 * Create a complete valid theme in a temp directory.
 * @param {Object} [options]
 * @param {string[]} [options.overrideAgents] - Override supportedAgents.
 * @param {boolean} [options.skipPalette] - Skip creating palette.css.
 * @param {boolean} [options.skipAdapterCss] - Skip creating adapter CSS files.
 * @param {boolean} [options.skipImages] - Skip creating image placeholders.
 * @param {string} [options.manifestOverride] - Extra manifest fields as object.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function createValidTheme(options = {}) {
  const agents = options.overrideAgents || ['traework'];
  const files = {};

  // manifest.json
  const manifest = {
    schemaVersion: 2,
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    mode: 'dark',
    category: 'test',
    tags: ['test'],
    icon: 'icon.png',
    preview: 'preview.png',
    colors: {
      accent: '#afcad2',
      secondary: '#bfd4db',
      background: '#13171a',
      foreground: '#f4f0eb',
    },
    targets: {},
    supportedAgents: agents,
    license: 'MPL-2.0',
    ...options.manifestOverride,
  };

  for (const agent of agents) {
    manifest.targets[agent] = { css: `assets/css/${agent}.css` };
  }

  files['manifest.json'] = JSON.stringify(manifest);

  // palette.css
  if (!options.skipPalette) {
    files['palette.css'] = makeFullPaletteCss();
  }

  // adapter CSS files
  if (!options.skipAdapterCss) {
    for (const agent of agents) {
      files[`assets/css/${agent}.css`] = makeAdapterCss();
    }
  }

  // Image placeholders (tiny valid files)
  if (!options.skipImages) {
    files['icon.png'] = 'PNG';
    files['preview.png'] = 'PNG';
  }

  const result = createTempTheme(files);
  return result;
}

// ---------------------------------------------------------------------------
// Test 1: extractPaletteTokens — full token extraction
// ---------------------------------------------------------------------------

describe('extractPaletteTokens', () => {
  it('extracts all 12 core tokens from a complete palette CSS string', () => {
    const css = makeFullPaletteCss();
    const tokens = extractPaletteTokens(css);

    expect(tokens.size).toBe(12);
    for (const token of PALETTE_TOKENS) {
      expect(tokens.has(token)).toBe(true);
    }
  });

  it('returns empty set when CSS has no --agentskin-* variables', () => {
    const css = 'body { background: white; }';
    const tokens = extractPaletteTokens(css);
    expect(tokens.size).toBe(0);
  });

  it('extracts only declared tokens from a partial CSS string', () => {
    const css = makePartialPaletteCss(5);
    const tokens = extractPaletteTokens(css);
    expect(tokens.size).toBe(5);
    expect(tokens.has('--agentskin-bg')).toBe(true);
    expect(tokens.has('--agentskin-selection')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: validateCssSyntax — CSS syntax validation
// ---------------------------------------------------------------------------

describe('validateCssSyntax', () => {
  it('passes for valid CSS with balanced braces', () => {
    const css = 'html.agentskin-host-traework {\n  --agentskin-accent: #afcad2;\n}\n';
    const result = validateCssSyntax(css);
    expect(result.valid).toBe(true);
  });

  it('fails for CSS with unbalanced braces (extra closing)', () => {
    const css = 'body { color: red; }}';
    const result = validateCssSyntax(css);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('unmatched');
  });

  it('fails for CSS with unbalanced braces (missing closing)', () => {
    const css = 'body { color: red;';
    const result = validateCssSyntax(css);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('unbalanced');
  });

  it('fails for CSS containing null bytes', () => {
    const css = 'body { color: red; }\0';
    const result = validateCssSyntax(css);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null bytes');
  });

  it('handles strings with braces inside correctly', () => {
    const css = 'body::before { content: "{"; }';
    const result = validateCssSyntax(css);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: validateManifest — manifest schema validation
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('passes for a valid manifest', () => {
    const manifest = {
      schemaVersion: 2,
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
      colors: { accent: '#fff' },
      supportedAgents: ['traework'],
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails when schemaVersion is not 2', () => {
    const manifest = {
      schemaVersion: 1,
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      colors: {},
      supportedAgents: ['traework'],
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('schemaVersion'))).toBe(true);
  });

  it('fails when required fields are missing', () => {
    const manifest = {
      schemaVersion: 2,
      colors: {},
      supportedAgents: ['traework'],
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('id'))).toBe(true);
    expect(result.issues.some((i) => i.includes('name'))).toBe(true);
    expect(result.issues.some((i) => i.includes('version'))).toBe(true);
  });

  it('fails when supportedAgents is empty', () => {
    const manifest = {
      schemaVersion: 2,
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      colors: {},
      supportedAgents: [],
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('supportedAgents'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4: verifyTheme — complete valid theme (happy path)
// ---------------------------------------------------------------------------

describe('verifyTheme — complete valid theme', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createValidTheme();
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns ok status for a complete valid theme', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('ok');
    expect(result.issues).toHaveLength(0);
  });

  it('passes all four checks', () => {
    const result = verifyTheme(tempDir);
    expect(result.checks.paletteComplete).toBe(true);
    expect(result.checks.manifestValid).toBe(true);
    expect(result.checks.adapterCssComplete).toBe(true);
    expect(result.checks.imagesExist).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5: verifyTheme — missing palette tokens detection
// ---------------------------------------------------------------------------

describe('verifyTheme — missing palette tokens', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'manifest.json': JSON.stringify({
        schemaVersion: 2,
        id: 'test-missing-tokens',
        name: 'Test Missing Tokens',
        version: '1.0.0',
        mode: 'dark',
        icon: 'icon.png',
        preview: 'preview.png',
        colors: { accent: '#fff', background: '#000', foreground: '#fff' },
        targets: {},
        supportedAgents: [],
        license: 'MPL-2.0',
      }),
      'palette.css': makePartialPaletteCss(5),
      'icon.png': 'PNG',
      'preview.png': 'PNG',
    };
    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when palette tokens are missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports paletteComplete as false', () => {
    const result = verifyTheme(tempDir);
    expect(result.checks.paletteComplete).toBe(false);
  });

  it('lists the missing tokens in issues', () => {
    const result = verifyTheme(tempDir);
    const paletteIssue = result.issues.find((i) => i.includes('palette.css'));
    expect(paletteIssue).toBeDefined();
    expect(paletteIssue).toContain('missing');
    expect(paletteIssue).toContain('token');
  });
});

// ---------------------------------------------------------------------------
// Test 6: verifyTheme — manifest schema error detection
// ---------------------------------------------------------------------------

describe('verifyTheme — manifest schema errors', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'manifest.json': JSON.stringify({
        // schemaVersion missing (not 2)
        id: 'test-bad-schema',
        name: 'Test Bad Schema',
        version: '1.0.0',
        colors: {},
        supportedAgents: ['traework'],
      }),
      'palette.css': makeFullPaletteCss(),
      'assets/css/traework.css': makeAdapterCss(),
    };
    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when schemaVersion is not 2', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports manifest validation issue', () => {
    const result = verifyTheme(tempDir);
    const manifestIssue = result.issues.find((i) => i.includes('schemaVersion'));
    expect(manifestIssue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 7: verifyTheme — adapter CSS missing detection
// ---------------------------------------------------------------------------

describe('verifyTheme — adapter CSS missing', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createValidTheme({ skipAdapterCss: true });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when adapter CSS is missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports adapterCssComplete as false', () => {
    const result = verifyTheme(tempDir);
    expect(result.checks.adapterCssComplete).toBe(false);
  });

  it('lists the missing CSS file in issues', () => {
    const result = verifyTheme(tempDir);
    const cssIssue = result.issues.find((i) => i.includes('CSS file not found'));
    expect(cssIssue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 8: verifyTheme — image reference missing detection
// ---------------------------------------------------------------------------

describe('verifyTheme — image reference missing', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createValidTheme({ skipImages: true });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns unknown status when images are missing (not broken)', () => {
    const result = verifyTheme(tempDir);
    // Image missing is a warning, status should be unknown not broken
    expect(result.status).toBe('unknown');
  });

  it('reports imagesExist as false', () => {
    const result = verifyTheme(tempDir);
    expect(result.checks.imagesExist).toBe(false);
  });

  it('lists the missing image in issues', () => {
    const result = verifyTheme(tempDir);
    const imageIssue = result.issues.find((i) => i.includes('image'));
    expect(imageIssue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 9: verifyTheme — CSS syntax error detection
// ---------------------------------------------------------------------------

describe('verifyTheme — CSS syntax error', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'manifest.json': JSON.stringify({
        schemaVersion: 2,
        id: 'test-css-syntax',
        name: 'Test CSS Syntax',
        version: '1.0.0',
        mode: 'dark',
        icon: 'icon.png',
        preview: 'preview.png',
        colors: { accent: '#fff', background: '#000', foreground: '#fff' },
        targets: { traework: { css: 'assets/css/traework.css' } },
        supportedAgents: ['traework'],
        license: 'MPL-2.0',
      }),
      'palette.css': makeFullPaletteCss(),
      'assets/css/traework.css': 'body { color: red; unbalanced',
      'icon.png': 'PNG',
      'preview.png': 'PNG',
    };
    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when CSS has syntax errors', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports CSS syntax error in issues', () => {
    const result = verifyTheme(tempDir);
    const syntaxIssue = result.issues.find((i) => i.includes('CSS syntax error'));
    expect(syntaxIssue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 10: verifyTheme — missing manifest.json
// ---------------------------------------------------------------------------

describe('verifyTheme — missing manifest', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'palette.css': makeFullPaletteCss(),
    };
    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when manifest.json is missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports manifest not found in issues', () => {
    const result = verifyTheme(tempDir);
    expect(result.issues.some((i) => i.includes('manifest.json not found'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 11: verifyTheme — missing palette.css
// ---------------------------------------------------------------------------

describe('verifyTheme — missing palette.css', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createValidTheme({ skipPalette: true });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when palette.css is missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports palette.css not found in issues', () => {
    const result = verifyTheme(tempDir);
    expect(result.issues.some((i) => i.includes('palette.css not found'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 12: verifyTheme — multi-agent theme (all 6 adapters)
// ---------------------------------------------------------------------------

describe('verifyTheme — multi-agent theme with all adapters', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createValidTheme({ overrideAgents: [...KNOWN_ADAPTERS] });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns ok status when all adapters have valid CSS', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('ok');
  });

  it('passes adapterCssComplete for all 6 adapters', () => {
    const result = verifyTheme(tempDir);
    expect(result.checks.adapterCssComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 13: verifyTheme — malformed manifest JSON
// ---------------------------------------------------------------------------

describe('verifyTheme — malformed manifest JSON', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'manifest.json': '{ invalid json !!!',
    };
    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when manifest is not valid JSON', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports parse error in issues', () => {
    const result = verifyTheme(tempDir);
    expect(result.issues.some((i) => i.includes('parse error'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 14: discoverThemes — theme discovery
// ---------------------------------------------------------------------------

describe('discoverThemes', () => {
  it('discovers themes in the themes/ directory', () => {
    const themes = discoverThemes();
    expect(themes.length).toBeGreaterThan(0);
  });

  it('discovers theme directories that contain manifest.json', () => {
    const themes = discoverThemes();
    for (const themePath of themes) {
      expect(themePath).toContain('themes');
      // The directory name should not end with .agentskin-theme
      expect(themePath.endsWith('.agentskin-theme')).toBe(false);
    }
  });

  it('excludes .agentskin-theme packages', () => {
    const themes = discoverThemes();
    for (const themePath of themes) {
      expect(themePath.endsWith('.agentskin-theme')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 15: Constants validation
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('PALETTE_TOKENS contains exactly 12 tokens', () => {
    expect(PALETTE_TOKENS).toHaveLength(12);
  });

  it('CANONICAL_TOKENS contains exactly 14 tokens', () => {
    expect(CANONICAL_TOKENS).toHaveLength(14);
  });

  it('KNOWN_ADAPTERS contains all 6 adapters', () => {
    expect(KNOWN_ADAPTERS).toHaveLength(6);
    expect(KNOWN_ADAPTERS).toContain('traework');
    expect(KNOWN_ADAPTERS).toContain('qoderwork');
    expect(KNOWN_ADAPTERS).toContain('workbuddy');
    expect(KNOWN_ADAPTERS).toContain('doubao');
    expect(KNOWN_ADAPTERS).toContain('codex');
    expect(KNOWN_ADAPTERS).toContain('zcode');
  });

  it('PALETTE_TOKENS is a subset of CANONICAL_TOKENS', () => {
    for (const token of PALETTE_TOKENS) {
      expect(CANONICAL_TOKENS).toContain(token);
    }
  });
});
