// SPDX-License-Identifier: MPL-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { convert } from '../index';
import { normalizeColors } from '../ir/normalize';
import { contractCheck } from '../verify/contract-check';

describe('Theme Asset Engine — P1 Pipeline', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'theme-asset-test-'));

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createCodedrobePackage(dir: string, colors: Record<string, string>) {
    mkdirSync(dir, { recursive: true });
    const manifest = {
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
      colors,
      targets: {
        traework: { css: 'targets/traework.css' },
        codex: { css: 'targets/codex.css' },
      },
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  it('should convert a codedrobe package to 6-agent CSS', async () => {
    const pkgDir = join(testDir, 'codedrobe-pkg');
    createCodedrobePackage(pkgDir, {
      accent: '#ff5500',
      background: '#1a1a2e',
      foreground: '#eaeaea',
    });

    const result = await convert({ path: pkgDir }, { themeId: 'test-theme' });

    // 6 agents should have CSS output
    expect(Object.keys(result.cssOutputs)).toHaveLength(6);
    expect(result.cssOutputs.traework).toContain('--agentskin-accent');
    expect(result.cssOutputs.codex).toContain('--agentskin-accent');

    // Colors should be normalized (missing tokens get fallbacks)
    const colors = normalizeColors({
      colors: { accent: '#ff5500', background: '#1a1a2e', foreground: '#eaeaea' },
      meta: { sourceFormat: 'test' },
    });
    expect(colors.accent).toBe('#ff5500');
    expect(colors.surface).toBeDefined(); // fallback applied
  });

  it('should pass contract check for a valid package', async () => {
    const pkgDir = join(testDir, 'valid-pkg');
    createCodedrobePackage(pkgDir, {
      accent: '#ff5500',
      secondary: '#00cc88',
      background: '#1a1a2e',
      foreground: '#eaeaea',
      muted: '#999999',
      surface: '#2a2a3e',
      surfaceElevated: '#3a3a4e',
      border: '#4a4a5e',
      codeBackground: '#0a0a1e',
      codeForeground: '#ddeeff',
      inputBackground: '#2a2a3e',
      buttonBackground: '#ff5500',
      buttonForeground: '#ffffff',
      focusRing: '#ff550080',
    });

    const result = await convert({ path: pkgDir }, { themeId: 'test-theme' });

    expect(result.report.passed).toBe(true);
    expect(result.report.tokenCoverage).toBe(1);
  });

  it('should handle a legacy-codex JSON file', async () => {
    const jsonPath = join(testDir, 'theme.codex-theme');
    const theme = {
      name: 'Codex Theme',
      colors: {
        accent: '#0066cc',
        background: '#ffffff',
        foreground: '#1a1a1a',
      },
    };
    writeFileSync(jsonPath, JSON.stringify(theme, null, 2));

    const result = await convert(
      { path: jsonPath, filename: 'theme.codex-theme' },
      { themeId: 'codex-test' },
    );

    expect(Object.keys(result.cssOutputs)).toHaveLength(6);
    expect(result.cssOutputs.codex).toContain('--agentskin-accent');
  });

  it('should mark low-coverage packages as failed', () => {
    const result = contractCheck({
      // only 1 of 14 tokens provided
      colors: { accent: '#ff5500', background: '#000000', foreground: '#ffffff' },
      meta: { sourceFormat: 'test' },
      confidence: 0.3,
    });

    expect(result.passed).toBe(false); // coverage < 0.8
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
