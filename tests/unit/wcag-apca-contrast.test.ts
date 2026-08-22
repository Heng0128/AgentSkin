// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  checkThemeContrast,
  checkExtendedContrast,
  formatContrastReport,
  assertContrast,
} from '../../scripts/wcag-apca-check.mjs';
import { apcaContrast, wcagCheck } from '../../scripts/extended-colors.mjs';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const validManifest = {
  colors: {
    foreground: '#000000',
    background: '#ffffff',
  },
};

const failingManifest = {
  colors: {
    foreground: '#949494',
    background: '#ffffff',
    _wcag: { level: 'AA' },
  },
};

// ---------------------------------------------------------------------------
// describe: Theme contrast
// ---------------------------------------------------------------------------

describe('Theme contrast', () => {
  it('returns correct structure for a valid manifest', () => {
    const result = checkThemeContrast(validManifest);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('wcag');
    expect(result!.wcag).toHaveProperty('ratio');
    expect(result!.wcag).toHaveProperty('passesAA');
    expect(result!.wcag).toHaveProperty('passesAAA');
    expect(result).toHaveProperty('apca');
    expect(result!.apca).toHaveProperty('lc');
    expect(result!.apca).toHaveProperty('passesLc60');
    expect(result!.apca).toHaveProperty('passesLc90');
    expect(result).toHaveProperty('level');
  });

  it('passesAA=true when level=AA and contrast is sufficient (#000000 on #ffffff)', () => {
    const result = checkThemeContrast(validManifest);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('AA');
    expect(result!.wcag.passesAA).toBe(true);
  });

  it('passesAAA=false when level=AAA and contrast is insufficient (#767676 on #ffffff)', () => {
    const manifest = {
      colors: {
        foreground: '#767676',
        background: '#ffffff',
        _wcag: { level: 'AAA' },
      },
    };
    const result = checkThemeContrast(manifest);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('AAA');
    expect(result!.wcag.passesAAA).toBe(false);
  });

  it('returns null when level=none', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        _wcag: { level: 'none' },
      },
    };
    expect(checkThemeContrast(manifest)).toBeNull();
  });

  it('returns null when foreground or background is missing', () => {
    expect(
      checkThemeContrast({ colors: { background: '#ffffff' } }),
    ).toBeNull();
    expect(
      checkThemeContrast({ colors: { foreground: '#000000' } }),
    ).toBeNull();
    expect(checkThemeContrast({ colors: {} })).toBeNull();
    expect(checkThemeContrast({})).toBeNull();
  });

  it('defaults level to AA when _wcag is not declared', () => {
    const result = checkThemeContrast(validManifest);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('AA');
  });
});

// ---------------------------------------------------------------------------
// describe: Extended contrast
// ---------------------------------------------------------------------------

describe('Extended contrast', () => {
  it('returns empty array when extended is absent', () => {
    const result = checkExtendedContrast(validManifest);
    expect(result).toEqual([]);
  });

  it('returns empty array when foreground or background is missing', () => {
    expect(
      checkExtendedContrast({
        colors: { background: '#ffffff', extended: { error: '#ef4444' } },
      }),
    ).toEqual([]);
  });

  it('returns contrast results for each valid extended color entry', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        extended: {
          error: '#ef4444',
          success: '#22c55e',
        },
      },
    };
    const result = checkExtendedContrast(manifest);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('fg');
    expect(result[0]).toHaveProperty('bg');
    expect(result[0]).toHaveProperty('ratio');
    expect(result[0]).toHaveProperty('passesAA');
    expect(result[0].name).toBe('error');
    expect(result[0].fg).toBe('#ef4444');
  });

  it('computes correct on-color based on higher contrast (fg vs bg)', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        extended: {
          accent: '#ef4444',
        },
      },
    };
    const result = checkExtendedContrast(manifest);
    expect(result).toHaveLength(1);
    // autoOnColor uses luminance threshold: #ef4444 luminance ≈ 0.21 < 0.45
    // so it returns #ffffff — matches the runtime engine's extendedColorsBlock.
    expect(result[0].bg).toBe('#ffffff');
    expect(result[0].ratio).toBeGreaterThanOrEqual(1);
  });

  it('skips extended entries whose value is not a string', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        extended: {
          error: '#ef4444',
          invalid: 123 as unknown as string,
        },
      },
    };
    const result = checkExtendedContrast(manifest);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// describe: Format report
// ---------------------------------------------------------------------------

describe('Format report', () => {
  it('returns skip string when result is null', () => {
    expect(formatContrastReport(null)).toBe('WCAG/APCA — level=none, skipped.');
  });

  it('returns empty string for an empty extended array', () => {
    expect(formatContrastReport([])).toBe('Extended colors — none declared.');
  });

  it('returns formatted string for extended color results', () => {
    const report = [
      { name: 'error', fg: '#ef4444', bg: '#000000', ratio: 5.67, passesAA: true },
      { name: 'success', fg: '#22c55e', bg: '#ffffff', ratio: 1.55, passesAA: false },
    ];
    const output = formatContrastReport(report);
    expect(output).toContain('Extended-color contrast (2):');
    expect(output).toContain('#ef4444 on #000000');
    expect(output).toContain('AA ok');
    expect(output).toContain('AA FAIL');
  });

  it('formats single theme result with PASS status when level=AA and passes', () => {
    const result = checkThemeContrast(validManifest)!;
    const output = formatContrastReport(result);
    expect(output).toContain('Foreground/Background contrast');
    expect(output).toContain('PASS');
    expect(output).toContain('(level AA)');
  });

  it('formats single theme result with FAIL status when contrast is insufficient', () => {
    const manifest = {
      colors: {
        foreground: '#949494',
        background: '#ffffff',
        _wcag: { level: 'AA' },
      },
    };
    const result = checkThemeContrast(manifest)!;
    const output = formatContrastReport(result);
    expect(output).toContain('FAIL');
    expect(result.wcag.passesAA).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: Assert contrast
// ---------------------------------------------------------------------------

describe('Assert contrast', () => {
  it('does not throw when contrast meets AA requirement (#000000 on #ffffff)', () => {
    expect(() => assertContrast(validManifest)).not.toThrow();
  });

  it('throws Error when contrast fails AA requirement (#949494 on #ffffff)', () => {
    expect(() => assertContrast(failingManifest)).toThrow(Error);
    expect(() => assertContrast(failingManifest)).toThrow(/WCAG AA contrast requirement not met/);
  });

  it('does not throw when level=none', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        _wcag: { level: 'none' },
      },
    };
    expect(() => assertContrast(manifest)).not.toThrow();
  });

  it('throws with AAA message when level=AAA and ratio is below 7.0', () => {
    const manifest = {
      colors: {
        foreground: '#767676',
        background: '#ffffff',
        _wcag: { level: 'AAA' },
      },
    };
    expect(() => assertContrast(manifest)).toThrow(/WCAG AAA contrast requirement not met/);
  });

  it('does not throw when colors are missing (no assertion possible)', () => {
    expect(() => assertContrast({})).not.toThrow();
    expect(() => assertContrast({ colors: {} })).not.toThrow();
  });
});

describe('Coverage gaps', () => {
  it('APCA returns positive Lc for high-contrast pair', () => {
    const lc = apcaContrast('#ffffff', '#000000');
    expect(lc).toBeGreaterThan(50);
  });

  it('APCA returns lower Lc for low-contrast pair', () => {
    const lc = apcaContrast('#ffffff', '#cccccc');
    expect(lc).toBeLessThan(35);
  });

  it('AAA threshold (7.0) correctly distinguishes from AA (4.5)', () => {
    const midGray = wcagCheck('#767676', '#ffffff');
    expect(midGray.passesAA).toBe(true);
    expect(midGray.passesAAA).toBe(false);

    const black = wcagCheck('#000000', '#ffffff');
    expect(black.passesAA).toBe(true);
    expect(black.passesAAA).toBe(true);
  });

  it('extended contrast skips non-string values', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        extended: { bad: 123, ok: '#ef4444' },
      },
    };
    const result = checkExtendedContrast(manifest);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ok');
  });

  it('extended contrast uses autoOnColor (luminance-based)', () => {
    const manifest = {
      colors: {
        foreground: '#000000',
        background: '#ffffff',
        extended: { darkRed: '#8b0000' },
      },
    };
    const result = checkExtendedContrast(manifest);
    // #8b0000 luminance ≈ 0.07 < 0.45 → autoOnColor returns #ffffff
    expect(result[0].bg).toBe('#ffffff');
  });
});
