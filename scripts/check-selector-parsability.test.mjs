// SPDX-License-Identifier: MPL-2.0
/**
 * check-selector-parsability.test.mjs — C15 guard self-tests.
 *
 * Run: npx vitest run scripts/check-selector-parsability.test.mjs
 */

import { describe, expect, it } from 'vitest';
import { validateSelector } from './check-selector-parsability.mjs';

describe('validateSelector — accepts valid selectors', () => {
  it.each([
    'button',
    "[role='dialog']",
    ':is(.a, .b, [data-x="y"])',
    "main:is(.main-surface, [data-app-shell-main-surface], [class*='_MainContentSurface_'])",
    '[class*="input-container"][class*="flex"]',
    ':not(.quick-actions__item)',
    "body[data-application-name='workbuddy']",
    '[title="a,b"]', // comma inside quotes must not trip comma hygiene
    'div > span::before',
    ':has(> .teams-content-wrapper)',
  ])('%s', (sel) => {
    expect(validateSelector(sel)).toBe(null);
  });
});

describe('validateSelector — rejects the real-world bug classes', () => {
  it('catches the S1 bug: missing closing bracket (semantic-selectors qoderwork, 2026-09-08)', () => {
    const err = validateSelector("[role='navigation'");
    expect(err).toBeTruthy();
    expect(err).toContain("unclosed '['");
  });

  it('catches unclosed function parens', () => {
    expect(validateSelector(':is(.a, .b')).toContain('unclosed');
  });

  it('catches the workbuddy L225 bug class: trailing comma after closer', () => {
    expect(validateSelector(':is(.a, .b),')).toContain('trailing comma');
  });

  it('catches leading and doubled commas', () => {
    expect(validateSelector(',.a')).toContain('leading comma');
    expect(validateSelector('.a,,.b')).toContain('empty candidate');
  });

  it('catches empty / non-string candidates', () => {
    expect(validateSelector('')).toBe('empty selector');
    expect(validateSelector('   ')).toBe('empty selector');
    expect(validateSelector(null)).toContain('not a string');
    expect(validateSelector(42)).toContain('not a string');
  });

  it('catches stray closers', () => {
    expect(validateSelector('.a]')).toContain("unbalanced ']'");
  });
});
