// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { compareSemver, parseSemver } from './theme-installer';

// Regression coverage for the documented semver precedence rules in
// `theme-installer.ts` (P1 audit #19: prerelease ordering was previously
// reversed). These are pure functions with no I/O, so the tests are fully
// deterministic.

describe('parseSemver', () => {
  it('parses a full version into numeric tuples', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses a prerelease into a token array', () => {
    expect(parseSemver('1.0.0-alpha.1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', '1'],
    });
  });

  it('strips a leading v and surrounding whitespace', () => {
    expect(parseSemver('  v2.5.0  ')).toEqual({ major: 2, minor: 5, patch: 0, prerelease: [] });
  });

  it('returns null for non-semver strings', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('1')).toBeNull();
  });

  it('ignores the build metadata component', () => {
    expect(parseSemver('1.2.3+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });
});

describe('compareSemver', () => {
  it('orders by major.minor.patch numerically', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  // P1 audit #19 — prerelease precedence was historically reversed.
  it('treats a release as greater than its own prerelease', () => {
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
  });

  it('orders prereleases by identifier precedence', () => {
    // Numeric identifiers have lower precedence than alphanumeric.
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.beta', '1.0.0-beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.1')).toBe(0);
  });

  it('falls back to legacy numeric-split for non-semver inputs', () => {
    expect(compareSemver('5', '1.2')).toBeGreaterThan(0);
    expect(compareSemver('1.2', '5')).toBeLessThan(0);
    expect(compareSemver('1.2', '1.2')).toBe(0);
  });
});
