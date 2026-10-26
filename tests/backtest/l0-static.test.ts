// SPDX-License-Identifier: MPL-2.0

/**
 * # L0 — Static Pure-Function Tests
 *
 * No side effects, no network, no file system, no timers.
 * Tests pure functions that compute outputs from inputs deterministically.
 *
 * Run: npm run test:backtest:l0
 */

import { describe, expect, it } from 'vitest';
import {
  type AdapterPortConfig,
  DEFAULT_PORT_CONFIGS,
  getAdapterPortConfig,
  isWithinFallbackRange,
  resolveEndPort,
  resolveStartPort,
  validatePortOverride,
} from '../../src/main/cdp/port-manager';
import { targetKeyFor } from '../../src/main/cdp/session-pool';
import {
  contrastRatio,
  getContrastColor,
  hexToRgb,
  parseCssColor,
  rgbToHex,
  wcagLuminance,
  wcagRelativeLuminance,
} from '../../src/shared/contrast-utils';

// ---------------------------------------------------------------------------
// port-config — pure configuration functions
// ---------------------------------------------------------------------------

describe('L0 — port-config: resolveStartPort', () => {
  it('returns 0 for preferredPort=0 (random port)', () => {
    expect(resolveStartPort('traework', 0)).toBe(0);
    expect(resolveStartPort(undefined, 0)).toBe(0);
    expect(resolveStartPort(null, 0)).toBe(0);
  });

  it('returns explicit valid preferredPort', () => {
    expect(resolveStartPort('traework', 9500)).toBe(9500);
    expect(resolveStartPort(undefined, 3000)).toBe(3000);
  });

  it('returns 0 for null/undefined without useAdapterPreferredPort', () => {
    expect(resolveStartPort('traework', undefined)).toBe(0);
    expect(resolveStartPort('traework', null)).toBe(0);
  });

  it('returns 0 (random) for invalid explicit ports — no fixed fallback exists', () => {
    // 2026-09-07 no-fixed-port policy: invalid overrides resolve to random.
    expect(resolveStartPort('traework', -1)).toBe(0);
    expect(resolveStartPort('traework', 70000)).toBe(0);
    expect(resolveStartPort('traework', 3.14)).toBe(0);
  });

  it('returns 0 (random) for every adapter preferred port — never fixed', () => {
    expect(resolveStartPort('traework', undefined, true)).toBe(0);
    expect(resolveStartPort('qoderwork', null, true)).toBe(0);
    expect(resolveStartPort('zcode', undefined, true)).toBe(0);
  });
});

describe('L0 — port-config: resolveEndPort', () => {
  it('returns adapter fallbackRange upper bound', () => {
    expect(resolveEndPort('traework')).toBe(9357);
    expect(resolveEndPort('zcode')).toBe(9357);
  });

  it('returns AGENT_PORT_FALLBACK_MAX for unknown adapter', () => {
    expect(resolveEndPort('unknown')).toBe(9357);
    expect(resolveEndPort(undefined)).toBe(9357);
  });
});

describe('L0 — port-config: isWithinFallbackRange', () => {
  it('returns true for ports within [9222, 9357]', () => {
    expect(isWithinFallbackRange(9222)).toBe(true);
    expect(isWithinFallbackRange(9300)).toBe(true);
    expect(isWithinFallbackRange(9357)).toBe(true);
  });

  it('returns false for ports outside range', () => {
    expect(isWithinFallbackRange(9221)).toBe(false);
    expect(isWithinFallbackRange(9358)).toBe(false);
  });
});

describe('L0 — port-config: validatePortOverride', () => {
  it('accepts valid ports', () => {
    expect(validatePortOverride(9222)).toBeNull();
    expect(validatePortOverride(9300)).toBeNull();
  });

  it('rejects ports below 1024', () => {
    expect(validatePortOverride(1023)).toBe('invalidPort');
    expect(validatePortOverride(0)).toBe('invalidPort');
  });

  it('rejects ports above 65535', () => {
    expect(validatePortOverride(65536)).toBe('invalidPort');
  });

  it('flags ports in [1024, 9221] as invalidCdpPort', () => {
    expect(validatePortOverride(5000)).toBe('invalidCdpPort');
  });

  it('rejects non-integer ports', () => {
    expect(validatePortOverride(3.14)).toBe('invalidPort');
  });
});

describe('L0 — port-config: getAdapterPortConfig', () => {
  it('returns config for known adapters', () => {
    const cfg = getAdapterPortConfig('traework');
    expect(cfg).toBeDefined();
    expect(cfg?.preferredPort).toBe(0);
  });

  it('returns undefined for unknown adapter', () => {
    expect(getAdapterPortConfig('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getAdapterPortConfig('')).toBeUndefined();
  });
});

describe('L0 — port-config: DEFAULT_PORT_CONFIGS integrity', () => {
  it('has exactly 6 adapter configs', () => {
    expect(DEFAULT_PORT_CONFIGS).toHaveLength(6);
  });

  it('sets every preferred port to 0 (random, never fixed)', () => {
    // 2026-09-07 no-fixed-port policy: Chromium assigns random free ports at
    // launch; uniqueness comes from the OS bind, not static reservation.
    const ports = DEFAULT_PORT_CONFIGS.map((c) => c.preferredPort);
    expect(ports.every((p) => p === 0)).toBe(true);
  });

  it('covers all built-in adapters', () => {
    const ids = DEFAULT_PORT_CONFIGS.map((c: AdapterPortConfig) => c.adapterId).sort();
    expect(ids).toEqual(['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode']);
  });
});

// ---------------------------------------------------------------------------
// contrast-utils — pure color math
// ---------------------------------------------------------------------------

describe('L0 — contrast-utils: hexToRgb', () => {
  it('parses #rrggbb correctly', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('parses lowercase and uppercase', () => {
    expect(hexToRgb('#abcdef')).toEqual({ r: 171, g: 205, b: 239 });
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 171, g: 205, b: 239 });
  });

  it('returns null for invalid input', () => {
    expect(hexToRgb('ff0000')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });
});

describe('L0 — contrast-utils: rgbToHex', () => {
  it('converts rgb to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('clamps values to [0, 255]', () => {
    expect(rgbToHex(-1, 300, 128)).toBe('#00ff80');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(127.4, 127.5, 127.6)).toBe('#7f8080');
  });
});

describe('L0 — contrast-utils: wcagRelativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(wcagRelativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
  });

  it('returns 1 for white', () => {
    expect(wcagRelativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('returns a mid-range value for grey', () => {
    const lum = wcagRelativeLuminance(128, 128, 128);
    expect(lum).toBeGreaterThan(0.15);
    expect(lum).toBeLessThan(0.25);
  });
});

describe('L0 — contrast-utils: contrastRatio', () => {
  it('returns 21 for black on white (maximum)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('returns 1 for identical colors (minimum)', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#000000'), 5);
  });

  it('returns 1 for invalid input', () => {
    expect(contrastRatio('invalid', '#ffffff')).toBe(1);
    expect(contrastRatio('#000000', 'invalid')).toBe(1);
  });
});

describe('L0 — contrast-utils: getContrastColor', () => {
  it('returns black for light backgrounds', () => {
    expect(getContrastColor('#ffffff')).toBe('#000000');
    expect(getContrastColor('#eeeeee')).toBe('#000000');
  });

  it('returns white for dark backgrounds', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff');
    expect(getContrastColor('#1a1a2e')).toBe('#ffffff');
  });

  it('returns white for invalid input', () => {
    expect(getContrastColor('invalid')).toBe('#ffffff');
  });
});

describe('L0 — contrast-utils: parseCssColor', () => {
  it('parses rgb() format', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(parseCssColor('rgb(0,255,0)')).toBe('#00ff00');
  });

  it('parses rgba() format', () => {
    expect(parseCssColor('rgba(0, 0, 255, 0.5)')).toBe('#0000ff');
  });

  it('passes through valid hex', () => {
    expect(parseCssColor('#abcdef')).toBe('#abcdef');
  });

  it('returns null for invalid input', () => {
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(parseCssColor('hsl(0,100%,50%)')).toBeNull();
  });
});

describe('L0 — contrast-utils: wcagLuminance', () => {
  it('returns 0.5 for invalid hex (fallback)', () => {
    expect(wcagLuminance('invalid')).toBe(0.5);
  });

  it('computes luminance from hex', () => {
    expect(wcagLuminance('#000000')).toBeCloseTo(0, 5);
    expect(wcagLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// session-pool — pure key derivation
// ---------------------------------------------------------------------------

describe('L0 — session-pool: targetKeyFor', () => {
  it('prefers id over webSocketDebuggerUrl', () => {
    expect(targetKeyFor('abc', 'ws://x')).toBe('abc');
  });

  it('falls back to webSocketDebuggerUrl when id is null', () => {
    expect(targetKeyFor(null, 'ws://x')).toBe('ws://x');
  });

  it('falls back to webSocketDebuggerUrl when id is undefined', () => {
    expect(targetKeyFor(undefined, 'ws://x')).toBe('ws://x');
  });

  it('generates unique keys when both id and url are absent', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 10; i++) {
      keys.add(targetKeyFor(undefined, null));
    }
    expect(keys.size).toBe(10);
  });

  it('generates keys matching /^unknown-\\d+$/', () => {
    const key = targetKeyFor(undefined, null);
    expect(key).toMatch(/^unknown-\d+$/);
  });
});
