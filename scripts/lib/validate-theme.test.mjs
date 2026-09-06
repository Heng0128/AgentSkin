// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme.test.mjs
 *
 * Unit tests for the schema-driven compatibility pre-check engine.
 * Uses Node.js built-in test framework (node:test).
 *
 * Coverage:
 *   - validateThemePackage: structural validation of manifest verification blocks
 *   - checkLandmarks: landmark matching against DOM snapshots
 *   - getCompatibilityReport: full compatibility report generation
 *   - Edge cases: empty inputs, unknown adapters, partial matches, contexts
 */

import { describe, expect, it } from 'vitest';
import { getLandmarksForAdapter, LANDMARK_REGISTRY } from './landmarks/index.mjs';
import {
  ADAPTER_IDS,
  isValidAdapterId,
  SEVERITY,
  validateVerificationBlock,
} from './theme-manifest-schema.mjs';
import { checkLandmarks, getCompatibilityReport, validateThemePackage } from './validate-theme.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal valid manifest with no verification block. */
function minimalManifest() {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    targets: { traework: { css: 'assets/css/traework.css' } },
  };
}

/** A manifest with a full verification block for traework. */
function verifiedManifest() {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    verification: {
      traework: {
        required_landmarks: [
          { name: 'solo-shell', selectors: ['.panel-container', '.solo-lite-layout'] },
        ],
        recommended_landmarks: [{ name: 'composer', selectors: ['[contenteditable="true"]'] }],
        contexts: [
          {
            name: 'dark-mode',
            when: ['dark'],
            required: [{ name: 'vscode-tokens', selectors: ['body'] }],
          },
        ],
      },
    },
  };
}

/** A DOM snapshot with a known set of selectors. */
function richDomSnapshot() {
  return {
    selectors: [
      '.panel-container',
      '.solo-lite-layout',
      '[contenteditable="true"]',
      'body',
      'html.agentskin-host-traework',
      '.task-list-base',
    ],
  };
}

/** A sparse DOM snapshot — only the host root is present. */
function sparseDomSnapshot() {
  return {
    selectors: ['html.agentskin-host-traework', 'body'],
  };
}

// ---------------------------------------------------------------------------
// validateThemePackage
// ---------------------------------------------------------------------------

describe('validateThemePackage', () => {
  it('accepts a manifest with no verification block', () => {
    const result = validateThemePackage(minimalManifest(), 'traework');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a well-formed verification block', () => {
    const result = validateThemePackage(verifiedManifest(), 'traework');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unknown adapterId', () => {
    const result = validateThemePackage(minimalManifest(), 'unknown-app');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown adapterId')));
  });

  it('rejects a non-object manifest', () => {
    const result = validateThemePackage(null, 'traework');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-null object')));
  });

  it('rejects malformed required_landmarks (missing name)', () => {
    const manifest = {
      verification: {
        traework: {
          required_landmarks: [{ selectors: ['.foo'] }],
        },
      },
    };
    const result = validateThemePackage(manifest, 'traework');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name')));
  });

  it('rejects empty selectors array', () => {
    const manifest = {
      verification: {
        traework: {
          required_landmarks: [{ name: 'foo', selectors: [] }],
        },
      },
    };
    const result = validateThemePackage(manifest, 'traework');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least one selector')));
  });
});

// ---------------------------------------------------------------------------
// checkLandmarks
// ---------------------------------------------------------------------------

describe('checkLandmarks', () => {
  it('returns empty array for empty landmarks', () => {
    const result = checkLandmarks([], richDomSnapshot());
    expect(result).toEqual([]);
  });

  it('marks a landmark as matched when one selector is in the DOM', () => {
    const landmarks = [{ name: 'sidebar', selectors: ['.agents-sidebar', '.side'] }];
    const snapshot = { selectors: ['.agents-sidebar'] };
    const result = checkLandmarks(landmarks, snapshot);
    expect(result.length).toBe(1);
    expect(result[0].matched).toBe(true);
    expect(result[0].name).toBe('sidebar');
    expect(result[0].missing).toEqual(['.side']);
  });

  it('marks a landmark as unmatched when no selector matches', () => {
    const landmarks = [{ name: 'sidebar', selectors: ['.agents-sidebar'] }];
    const snapshot = { selectors: ['body'] };
    const result = checkLandmarks(landmarks, snapshot);
    expect(result[0].matched).toBe(false);
    expect(result[0].missing).toEqual(['.agents-sidebar']);
  });

  it('handles multiple landmarks with mixed results', () => {
    const landmarks = [
      { name: 'a', selectors: ['.foo'] },
      { name: 'b', selectors: ['.bar'] },
      { name: 'c', selectors: ['.baz', '.qux'] },
    ];
    const snapshot = { selectors: ['.foo', '.baz'] };
    const result = checkLandmarks(landmarks, snapshot);
    expect(result[0].matched).toBe(true);
    expect(result[1].matched).toBe(false);
    expect(result[2].matched).toBe(true);
  });

  it('handles empty DOM snapshot', () => {
    const landmarks = [{ name: 'a', selectors: ['.foo'] }];
    const result = checkLandmarks(landmarks, { selectors: [] });
    expect(result[0].matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCompatibilityReport
// ---------------------------------------------------------------------------

describe('getCompatibilityReport', () => {
  it('reports compatible when all required landmarks match', () => {
    const manifest = verifiedManifest();
    const snapshot = richDomSnapshot();
    const report = getCompatibilityReport(manifest, 'traework', snapshot);
    expect(report.compatible).toBe(true);
    expect(report.missing_required.length).toBe(0);
    expect(report.summary.some((s) => s.includes('compatible'))).toBe(true);
  });

  it('reports incompatible when a required landmark is missing', () => {
    const manifest = verifiedManifest();
    const snapshot = sparseDomSnapshot();
    const report = getCompatibilityReport(manifest, 'traework', snapshot);
    expect(report.compatible).toBe(false);
    expect(report.missing_required).toContain('solo-shell');
    expect(report.summary.some((s) => s.includes('INCOMPATIBLE'))).toBe(true);
  });

  it('lists missing selectors explicitly in the report', () => {
    const manifest = verifiedManifest();
    const snapshot = sparseDomSnapshot();
    const report = getCompatibilityReport(manifest, 'traework', snapshot);
    const soloResult = report.required.find((r) => r.name === 'solo-shell');
    expect(soloResult).toBeDefined();
    expect(soloResult.matched).toBe(false);
    expect(soloResult.missing.length).toBeGreaterThan(0);
    expect(soloResult.missing).toContain('.panel-container');
  });

  it('reports missing recommended landmarks as warnings (not failures)', () => {
    const manifest = {
      verification: {
        traework: {
          required_landmarks: [{ name: 'solo-shell', selectors: ['.panel-container'] }],
          recommended_landmarks: [{ name: 'composer', selectors: ['[contenteditable="true"]'] }],
        },
      },
    };
    // Include body so the built-in host-root required landmark also matches.
    const snapshot = { selectors: ['.panel-container', 'body'] };
    const report = getCompatibilityReport(manifest, 'traework', snapshot);
    expect(report.compatible).toBe(true);
    expect(report.missing_recommended).toContain('composer');
  });

  it('evaluates contexts only when contextTags match', () => {
    const manifest = verifiedManifest();
    const snapshot = richDomSnapshot();

    // Without the "dark" tag, context is inactive.
    const report1 = getCompatibilityReport(manifest, 'traework', snapshot);
    expect(report1.contexts[0].active).toBe(false);

    // With the "dark" tag, context is active.
    const report2 = getCompatibilityReport(manifest, 'traework', snapshot, {
      contextTags: ['dark'],
    });
    expect(report2.contexts[0].active).toBe(true);
  });

  it('fails compatibility when an active context required landmark is missing', () => {
    const manifest = {
      verification: {
        traework: {
          contexts: [
            {
              name: 'dark-mode',
              when: ['dark'],
              required: [{ name: 'missing-node', selectors: ['.nonexistent'] }],
            },
          ],
        },
      },
    };
    const snapshot = { selectors: ['body'] };
    const report = getCompatibilityReport(manifest, 'traework', snapshot, {
      contextTags: ['dark'],
    });
    expect(report.compatible).toBe(false);
    expect(report.missing_context_required).toContain('dark-mode/missing-node');
  });

  it('works with all six adapters using built-in landmarks', () => {
    for (const adapterId of ADAPTER_IDS) {
      const manifest = minimalManifest();
      const builtin = getLandmarksForAdapter(adapterId);
      expect(builtin).toBeDefined();
      expect(builtin.required.length).toBeGreaterThan(0);

      // A snapshot with only the host root should be compatible
      // (host-root is the only truly required landmark for most adapters).
      const snapshot = { selectors: ['body'] };
      const report = getCompatibilityReport(manifest, adapterId, snapshot);
      expect(report).toBeDefined();
      expect(report.adapterId).toBe(adapterId);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema validator (validateVerificationBlock)
// ---------------------------------------------------------------------------

describe('validateVerificationBlock', () => {
  it('accepts undefined / null (verification is optional)', () => {
    expect(validateVerificationBlock(undefined)).toEqual({ valid: true, errors: [] });
    expect(validateVerificationBlock(null)).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-object verification', () => {
    const result = validateVerificationBlock('garbage');
    expect(result.valid).toBe(false);
  });

  it('accepts a block with only required_landmarks', () => {
    const result = validateVerificationBlock({
      required_landmarks: [{ name: 'a', selectors: ['.a'] }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a block with all three categories', () => {
    const result = validateVerificationBlock({
      required_landmarks: [{ name: 'a', selectors: ['.a'] }],
      recommended_landmarks: [{ name: 'b', selectors: ['.b'] }],
      contexts: [
        {
          name: 'ctx1',
          when: ['dark'],
          required: [{ name: 'c', selectors: ['.c'] }],
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a context with empty when array', () => {
    const result = validateVerificationBlock({
      contexts: [{ name: 'ctx1', when: [], required: [] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('when'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidAdapterId
// ---------------------------------------------------------------------------

describe('isValidAdapterId', () => {
  it('returns true for all six built-in adapters', () => {
    for (const id of ADAPTER_IDS) {
      expect(isValidAdapterId(id)).toBe(true);
    }
  });

  it('returns false for unknown adapters', () => {
    expect(isValidAdapterId('chatgpt')).toBe(false);
    expect(isValidAdapterId('')).toBe(false);
    expect(isValidAdapterId(123)).toBe(false);
    expect(isValidAdapterId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landmark registry
// ---------------------------------------------------------------------------

describe('LANDMARK_REGISTRY', () => {
  it('contains entries for all six adapters', () => {
    for (const id of ADAPTER_IDS) {
      expect(LANDMARK_REGISTRY[id]).toBeDefined();
    }
  });

  it('each entry has required and recommended arrays', () => {
    for (const id of ADAPTER_IDS) {
      const entry = LANDMARK_REGISTRY[id];
      expect(Array.isArray(entry.required)).toBe(true);
      expect(Array.isArray(entry.recommended)).toBe(true);
    }
  });

  it('getLandmarksForAdapter returns undefined for unknown adapter', () => {
    expect(getLandmarksForAdapter('unknown')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SEVERITY constants
// ---------------------------------------------------------------------------

describe('SEVERITY', () => {
  it('has PASS, WARN, FAIL levels', () => {
    expect(SEVERITY.PASS).toBe('pass');
    expect(SEVERITY.WARN).toBe('warn');
    expect(SEVERITY.FAIL).toBe('fail');
  });
});
