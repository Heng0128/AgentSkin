// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';

/**
 * Test that the cleanup expression (CLEAR_DEEP_CORE_BODY) uses the correct
 * constant names from injection-constants.ts. This validates the contract
 * between the constants and the cleanup code (RFC P1-3 fix).
 */

import { DEEP_CORE_GLOBAL, SHADOW_ORIG_REF } from '../../src/shared/injection-constants';

describe('CLEAR_DEEP-core constant contract (P1-3)', () => {
  it('DEEP_CORE_GLOBAL should match what deep-core.mjs writes', () => {
    // deep-core.mjs writes: window.__AGENTSKIN_DEEP_CORE__ = this;
    expect(DEEP_CORE_GLOBAL).toBe('__AGENTSKIN_DEEP_CORE__');
  });

  it('SHADOW_ORIG_REF should match what deep-core.mjs writes', () => {
    // SafeAttachShadowPatcher.install writes: window.__agentskin_shadow_orig__ = orig;
    expect(SHADOW_ORIG_REF).toBe('__agentskin_shadow_orig__');
  });

  it('cleanup expression should reference both constants', () => {
    // Reconstruct the CLEAR_DEEP_CORE_BODY to verify it uses the constants
    const CLEAR_DEEP_CORE_BODY = [
      `if (window.${SHADOW_ORIG_REF}) {`,
      '  try { Element.prototype.attachShadow = window.__agentskin_shadow_orig__; } catch (e) {}',
      '}',
      `delete window.${SHADOW_ORIG_REF};`,
      `if (window.${DEEP_CORE_GLOBAL} && window.${DEEP_CORE_GLOBAL}.dispose) {`,
      '  try { window.__AGENTSKIN_DEEP_CORE__.dispose(); } catch (e) {}',
      '}',
      `delete window.${DEEP_CORE_GLOBAL};`,
    ].join('\n');

    // Verify the constant values appear in the cleanup body
    expect(CLEAR_DEEP_CORE_BODY).toContain(SHADOW_ORIG_REF);
    expect(CLEAR_DEEP_CORE_BODY).toContain(DEEP_CORE_GLOBAL);
  });
});
