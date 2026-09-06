// SPDX-License-Identifier: MPL-2.0
//
// Tests for verify-theme-compatibility.mjs — Theme registry verification
// evidence chain.
//
// Covers: complete theme verification, missing token detection, CSS
// reference integrity, version compatibility check, manifest validation,
// selector verification, cross-field consistency, evidence formatting.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_TOKENS,
  collectContractSelectors,
  evidence,
  extractCssVariables,
  KNOWN_AGENTS,
  loadContract,
  verifyTheme,
} from './verify-theme-compatibility.mjs';

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
  const dir = mkdtempSync(join(tmpdir(), 'agentskin-verify-test-'));
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
 * Generate a CSS string with all 14 canonical tokens declared.
 * @returns {string}
 */
function makeFullTokenCss() {
  return CANONICAL_TOKENS.map((t) => `${t}: #value;`).join('\n');
}

/**
 * Generate a CSS string with only some tokens (missing the rest).
 * @param {number} count - How many tokens to include.
 * @returns {string}
 */
function makePartialTokenCss(count) {
  return CANONICAL_TOKENS.slice(0, count)
    .map((t) => `${t}: #value;`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Test 1: extractCssVariables — full token extraction
// ---------------------------------------------------------------------------

describe('extractCssVariables', () => {
  it('extracts all 14 canonical tokens from a complete CSS string', () => {
    const css = makeFullTokenCss();
    const vars = extractCssVariables(css);

    expect(Object.keys(vars)).toHaveLength(14);
    for (const token of CANONICAL_TOKENS) {
      expect(vars[token]).toBe('#value');
    }
  });

  it('returns empty object when CSS has no --agentskin-* variables', () => {
    const css = 'body { background: white; color: black; }';
    const vars = extractCssVariables(css);
    expect(Object.keys(vars)).toHaveLength(0);
  });

  it('extracts only declared tokens from a partial CSS string', () => {
    const css = makePartialTokenCss(5);
    const vars = extractCssVariables(css);
    expect(Object.keys(vars)).toHaveLength(5);
    expect(vars['--agentskin-accent']).toBe('#value');
    expect(vars['--agentskin-selection']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: evidence — entry creation
// ---------------------------------------------------------------------------

describe('evidence', () => {
  it('creates a passing evidence entry without detail', () => {
    const entry = evidence('manifest.json', 'exists', true);
    expect(entry).toEqual({ path: 'manifest.json', key: 'exists', passed: true });
  });

  it('creates a failing evidence entry with detail', () => {
    const entry = evidence(
      'assets/css/traework.css',
      '14-token-complete',
      false,
      'missing 3 tokens',
    );
    expect(entry).toEqual({
      path: 'assets/css/traework.css',
      key: '14-token-complete',
      passed: false,
      detail: 'missing 3 tokens',
    });
  });
});

// ---------------------------------------------------------------------------
// Test 3: loadContract — contract loading
// ---------------------------------------------------------------------------

describe('loadContract', () => {
  it('loads a valid contract for a known agent', () => {
    const contract = loadContract('traework');
    expect(contract).not.toBeNull();
    expect(contract.targets).toBeDefined();
    expect(contract.targets.traework).toBeDefined();
  });

  it('returns null for an unknown agent', () => {
    const contract = loadContract('nonexistent-agent');
    expect(contract).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4: collectContractSelectors — selector collection
// ---------------------------------------------------------------------------

describe('collectContractSelectors', () => {
  it('collects selectors from required and recommended checks', () => {
    const contract = loadContract('traework');
    expect(contract).not.toBeNull();

    const selectors = collectContractSelectors(contract);
    expect(selectors.size).toBeGreaterThan(0);
    // traework contract has these selectors
    expect(selectors.has('html.agentskin-host-traework')).toBe(true);
    expect(selectors.has('body')).toBe(true);
  });

  it('returns empty set for a contract with no verification block', () => {
    const selectors = collectContractSelectors({ targets: {} });
    expect(selectors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: verifyTheme — complete theme verification (happy path)
// ---------------------------------------------------------------------------

describe('verifyTheme — complete valid theme', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-valid-theme',
        name: 'Test Valid Theme',
        version: '1.0.0',
        supportedAgents: ['traework'],
        targets: {
          traework: {
            css: 'assets/css/traework.css',
            verification: {
              required: [
                {
                  name: 'host-class-present',
                  any: ['html.agentskin-host-traework'],
                },
              ],
              recommended: [],
            },
          },
        },
      }),
      'assets/css/traework.css': makeFullTokenCss(),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns verified status for a complete valid theme', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('verified');
    expect(result.errors).toHaveLength(0);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('produces evidence entries for each check', () => {
    const result = verifyTheme(tempDir);
    const keys = result.evidence.map((e) => e.key);

    expect(keys).toContain('exists');
    expect(keys).toContain('valid-json');
    expect(keys).toContain('field-id');
    expect(keys).toContain('field-name');
    expect(keys).toContain('field-version');
    expect(keys).toContain('supportedAgents-nonempty');
    expect(keys).toContain('14-token-complete');
  });
});

// ---------------------------------------------------------------------------
// Test 6: verifyTheme — missing token detection
// ---------------------------------------------------------------------------

describe('verifyTheme — missing token detection', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-missing-tokens',
        name: 'Test Missing Tokens',
        version: '1.0.0',
        supportedAgents: ['traework'],
        targets: {
          traework: {
            css: 'assets/css/traework.css',
          },
        },
      }),
      'assets/css/traework.css': makePartialTokenCss(5),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when tokens are missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports the specific missing tokens in evidence detail', () => {
    const result = verifyTheme(tempDir);
    const tokenEvidence = result.evidence.find((e) => e.key === '14-token-complete');

    expect(tokenEvidence).toBeDefined();
    expect(tokenEvidence.passed).toBe(false);
    expect(tokenEvidence.detail).toContain('missing');
    expect(tokenEvidence.detail).toContain('token(s)');
  });
});

// ---------------------------------------------------------------------------
// Test 7: verifyTheme — CSS reference integrity
// ---------------------------------------------------------------------------

describe('verifyTheme — CSS reference integrity', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-broken-css-ref',
        name: 'Test Broken CSS Ref',
        version: '1.0.0',
        supportedAgents: ['traework'],
        targets: {
          traework: {
            css: 'assets/css/traework.css',
          },
        },
      }),
      // Intentionally NOT creating assets/css/traework.css
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when target CSS file is missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports css-resolves failure in evidence', () => {
    const result = verifyTheme(tempDir);
    const cssEvidence = result.evidence.find((e) => e.key === 'css-resolves');

    expect(cssEvidence).toBeDefined();
    expect(cssEvidence.passed).toBe(false);
    expect(cssEvidence.detail).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Test 8: verifyTheme — manifest validation (missing required fields)
// ---------------------------------------------------------------------------

describe('verifyTheme — manifest validation', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        // Missing id, name, version
        supportedAgents: [],
        targets: {},
      }),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns broken status when required fields are missing', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('broken');
  });

  it('reports each missing field as a separate evidence failure', () => {
    const result = verifyTheme(tempDir);
    const fieldEvidence = result.evidence.filter((e) => e.key.startsWith('field-') && !e.passed);

    expect(fieldEvidence.length).toBeGreaterThanOrEqual(3); // id, name, version
    const failedKeys = fieldEvidence.map((e) => e.key);
    expect(failedKeys).toContain('field-id');
    expect(failedKeys).toContain('field-name');
    expect(failedKeys).toContain('field-version');
  });

  it('reports empty supportedAgents as failure', () => {
    const result = verifyTheme(tempDir);
    const agentEvidence = result.evidence.find((e) => e.key === 'supportedAgents-nonempty');
    expect(agentEvidence).toBeDefined();
    expect(agentEvidence.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 9: verifyTheme — cross-field consistency (targets vs supportedAgents)
// ---------------------------------------------------------------------------

describe('verifyTheme — cross-field consistency', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-cross-field',
        name: 'Test Cross Field',
        version: '1.0.0',
        supportedAgents: ['traework'],
        targets: {
          traework: { css: 'assets/css/traework.css' },
          qoderwork: { css: 'assets/css/qoderwork.css' },
        },
      }),
      'assets/css/traework.css': makeFullTokenCss(),
      'assets/css/qoderwork.css': makeFullTokenCss(),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('reports targets not in supportedAgents as error', () => {
    const result = verifyTheme(tempDir);
    const subsetEvidence = result.evidence.find((e) => e.key === 'targets-subset-supportedAgents');

    expect(subsetEvidence).toBeDefined();
    expect(subsetEvidence.passed).toBe(false);
    expect(subsetEvidence.detail).toContain('qoderwork');
  });
});

// ---------------------------------------------------------------------------
// Test 10: verifyTheme — selector verification against contract
// ---------------------------------------------------------------------------

describe('verifyTheme — selector verification', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-selectors',
        name: 'Test Selectors',
        version: '1.0.0',
        supportedAgents: ['traework'],
        targets: {
          traework: {
            css: 'assets/css/traework.css',
            verification: {
              required: [
                {
                  name: 'unknown-check',
                  any: ['.totally-unknown-selector', '.another-fake'],
                },
              ],
              recommended: [],
            },
          },
        },
      }),
      'assets/css/traework.css': makeFullTokenCss(),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('reports unmatched selectors as warnings', () => {
    const result = verifyTheme(tempDir);
    const selEvidence = result.evidence.find((e) => e.key === 'verification-traework-selectors');

    expect(selEvidence).toBeDefined();
    expect(selEvidence.passed).toBe(false);
    expect(selEvidence.detail).toContain('selector(s) not in contract');
  });
});

// ---------------------------------------------------------------------------
// Test 11: verifyTheme — unknown agent in targets
// ---------------------------------------------------------------------------

describe('verifyTheme — unknown agent detection', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': JSON.stringify({
        id: 'test-unknown-agent',
        name: 'Test Unknown Agent',
        version: '1.0.0',
        supportedAgents: ['traework', 'fakeagent'],
        targets: {
          traework: { css: 'assets/css/traework.css' },
          fakeagent: { css: 'assets/css/fakeagent.css' },
        },
      }),
      'assets/css/traework.css': makeFullTokenCss(),
      'assets/css/fakeagent.css': makeFullTokenCss(),
    });
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('reports unknown agents in targets as warning', () => {
    const result = verifyTheme(tempDir);
    const knownEvidence = result.evidence.find((e) => e.key === 'targets-known-agents');

    expect(knownEvidence).toBeDefined();
    expect(knownEvidence.passed).toBe(false);
    expect(knownEvidence.detail).toContain('fakeagent');
  });
});

// ---------------------------------------------------------------------------
// Test 12: verifyTheme — malformed manifest JSON
// ---------------------------------------------------------------------------

describe('verifyTheme — malformed manifest', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      'manifest.json': '{ invalid json !!!',
    });
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

  it('reports valid-json evidence as failed', () => {
    const result = verifyTheme(tempDir);
    const jsonEvidence = result.evidence.find((e) => e.key === 'valid-json');

    expect(jsonEvidence).toBeDefined();
    expect(jsonEvidence.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 13: verifyTheme — missing manifest
// ---------------------------------------------------------------------------

describe('verifyTheme — missing manifest', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const result = createTempTheme({
      // No manifest.json
      'palette.css': ':root { --color: red; }',
    });
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

  it('reports exists evidence as failed', () => {
    const result = verifyTheme(tempDir);
    const existsEvidence = result.evidence.find((e) => e.key === 'exists');

    expect(existsEvidence).toBeDefined();
    expect(existsEvidence.passed).toBe(false);
    expect(existsEvidence.detail).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Test 14: verifyTheme — multi-agent theme with all valid
// ---------------------------------------------------------------------------

describe('verifyTheme — multi-agent complete theme', () => {
  let tempDir;
  let cleanup;

  beforeEach(() => {
    const files = {
      'manifest.json': JSON.stringify({
        id: 'test-multi-agent',
        name: 'Test Multi Agent',
        version: '2.0.0',
        supportedAgents: ['traework', 'qoderwork', 'workbuddy'],
        targets: {
          traework: {
            css: 'assets/css/traework.css',
            verification: {
              required: [{ name: 'host-class-present', any: ['html.agentskin-host-traework'] }],
              recommended: [],
            },
          },
          qoderwork: {
            css: 'assets/css/qoderwork.css',
            verification: {
              required: [{ name: 'host-class-present', any: ['html.agentskin-host-qoderwork'] }],
              recommended: [],
            },
          },
          workbuddy: {
            css: 'assets/css/workbuddy.css',
            verification: {
              required: [{ name: 'host-class-present', any: ['html.agentskin-host-workbuddy'] }],
              recommended: [],
            },
          },
        },
      }),
    };

    for (const agent of ['traework', 'qoderwork', 'workbuddy']) {
      files[`assets/css/${agent}.css`] = makeFullTokenCss();
    }

    const result = createTempTheme(files);
    tempDir = result.dir;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('verifies all agents and returns verified status', () => {
    const result = verifyTheme(tempDir);
    expect(result.status).toBe('verified');
    expect(result.errors).toHaveLength(0);
  });

  it('produces evidence for each agent CSS file', () => {
    const result = verifyTheme(tempDir);
    const agentEvidence = result.evidence.filter((e) => e.key === '14-token-complete' && e.passed);
    expect(agentEvidence.length).toBe(3); // traework, qoderwork, workbuddy
  });
});

// ---------------------------------------------------------------------------
// Test 15: verifyTheme — version compatibility evidence
// ---------------------------------------------------------------------------

describe('verifyTheme — version compatibility', () => {
  it('KNOWN_AGENTS contains all 6 supported agents', () => {
    expect(KNOWN_AGENTS).toHaveLength(6);
    expect(KNOWN_AGENTS).toContain('traework');
    expect(KNOWN_AGENTS).toContain('qoderwork');
    expect(KNOWN_AGENTS).toContain('workbuddy');
    expect(KNOWN_AGENTS).toContain('doubao');
    expect(KNOWN_AGENTS).toContain('codex');
    expect(KNOWN_AGENTS).toContain('zcode');
  });

  it('CANONICAL_TOKENS contains exactly 14 tokens', () => {
    expect(CANONICAL_TOKENS).toHaveLength(14);
    expect(CANONICAL_TOKENS).toContain('--agentskin-accent');
    expect(CANONICAL_TOKENS).toContain('--agentskin-selection');
  });
});
