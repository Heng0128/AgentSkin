// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { PixelData } from '../profile/image-analyzer';
import {
  buildThemeBundle,
  createQuickApplyEngine,
  generateThemeId,
  type QuickApplyDeps,
  type QuickApplyTokens,
} from './quick-apply-engine';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTestPixels(): PixelData {
  // 4x4 dark image with blue accent pixels.
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 15;
    data[i + 1] = 20;
    data[i + 2] = 30;
    data[i + 3] = 255;
  }
  // Set one pixel to blue.
  data[0] = 122;
  data[1] = 162;
  data[2] = 247;
  return { data, width: 4, height: 4 };
}

function makeTestTokens(): QuickApplyTokens {
  return {
    accent: '#7AA2F7',
    accentMuted: '#5A7FD4',
    secondary: '#9ECE6A',
    background: '#0F1419',
    foreground: '#E6EDF3',
    muted: '#8B949E',
    surface: '#161B22',
    surfaceElevated: '#21262D',
    border: '#7AA2F72E',
    codeBackground: '#0D1117',
    codeForeground: '#E6EDF3',
    inputBackground: '#21262D',
    buttonBackground: '#7AA2F733',
    buttonForeground: '#E6EDF3',
    focusRing: '#7AA2F799',
  };
}

function makeMockDeps(overrides: Partial<QuickApplyDeps> = {}): QuickApplyDeps {
  return {
    decodeImage: vi.fn().mockResolvedValue(makeTestPixels()),
    extractTokens: vi.fn().mockReturnValue(makeTestTokens()),
    analyzePixels: vi.fn().mockReturnValue({
      dominantColors: ['#7AA2F7', '#0F1419'],
      safeArea: 'left' as const,
      mode: 'dark' as const,
      averageLuminance: 0.1,
    }),
    installTheme: vi.fn().mockResolvedValue('qa-test-theme'),
    applyTheme: vi.fn().mockResolvedValue({ status: 'applied', message: 'ok' }),
    restoreAgent: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: buildThemeBundle
// ---------------------------------------------------------------------------

describe('buildThemeBundle', () => {
  it('produces valid JSON with theme id and agent CSS target', () => {
    const tokens = makeTestTokens();
    const json = buildThemeBundle(tokens, 'qa-test', 'codex');
    const parsed = JSON.parse(json);

    expect(parsed.format).toBe('agentskin-theme');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.theme.id).toBe('qa-test');
    expect(parsed.theme.copy.colors).toEqual(tokens);
    expect(parsed.targets.codex).toBeDefined();
    expect(typeof parsed.targets.codex.css).toBe('string');
  });

  it('includes all 14 token variables in CSS', () => {
    const tokens = makeTestTokens();
    const json = buildThemeBundle(tokens, 'qa-test', 'traework');
    const parsed = JSON.parse(json);
    const css: string = parsed.targets.traework.css;

    expect(css).toContain('--agentskin-accent:');
    expect(css).toContain('--agentskin-background:');
    expect(css).toContain('--agentskin-foreground:');
    expect(css).toContain('--agentskin-focus-ring:');
    expect(css).toContain(':root');
  });

  it('converts camelCase token names to kebab-case CSS variables', () => {
    const tokens = makeTestTokens();
    const json = buildThemeBundle(tokens, 'qa-test', 'codex');
    const parsed = JSON.parse(json);
    const css: string = parsed.targets.codex.css;

    expect(css).toContain('--agentskin-code-background:');
    expect(css).toContain('--agentskin-surface-elevated:');
    expect(css).toContain('--agentskin-button-background:');
  });

  it('filters out the mode key from CSS variables', () => {
    const tokens = { ...makeTestTokens(), mode: 'dark' };
    const json = buildThemeBundle(tokens, 'qa-test', 'codex');
    const parsed = JSON.parse(json);
    const css: string = parsed.targets.codex.css;

    expect(css).not.toContain('--agentskin-mode:');
  });
});

// ---------------------------------------------------------------------------
// Tests: generateThemeId
// ---------------------------------------------------------------------------

describe('generateThemeId', () => {
  it('generates a unique id with qa- prefix', () => {
    const id = generateThemeId('/path/to/my_wallpaper.png');
    expect(id).toMatch(/^qa-my_wallpaper-/);
  });

  it('sanitizes special characters', () => {
    const id = generateThemeId('/path/to/my file (1).jpeg');
    expect(id).not.toContain(' ');
    expect(id).not.toContain('(');
    expect(id).toMatch(/^qa-my_file_1_-/);
  });

  it('produces different ids for the same path at different times', () => {
    const id1 = generateThemeId('/path/to/same.png');
    // Advance Date.now by mocking.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    const id2 = generateThemeId('/path/to/same.png');
    spy.mockRestore();
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Tests: createQuickApplyEngine.run
// ---------------------------------------------------------------------------

describe('createQuickApplyEngine.run', () => {
  it('runs the full pipeline and returns success', async () => {
    const deps = makeMockDeps();
    const engine = createQuickApplyEngine(deps);

    const result = await engine.run({
      imagePath: '/test/image.png',
      targetAppId: 'codex',
    });

    expect(result.success).toBe(true);
    expect(result.themeId).toBe('qa-test-theme');
    expect(result.tokens).toEqual(makeTestTokens());
    expect(result.analysis).toBeDefined();
    expect(result.appliedAt).toBeTypeOf('number');
  });

  it('calls all pipeline steps in order', async () => {
    const callOrder: string[] = [];
    const deps = makeMockDeps({
      decodeImage: vi.fn().mockImplementation(async () => {
        callOrder.push('decode');
        return makeTestPixels();
      }),
      analyzePixels: vi.fn().mockImplementation(() => {
        callOrder.push('analyze');
        return {
          dominantColors: [],
          safeArea: 'left' as const,
          mode: 'dark' as const,
          averageLuminance: 0.1,
        };
      }),
      extractTokens: vi.fn().mockImplementation(() => {
        callOrder.push('extract');
        return makeTestTokens();
      }),
      installTheme: vi.fn().mockImplementation(async () => {
        callOrder.push('install');
        return 'qa-test';
      }),
      applyTheme: vi.fn().mockImplementation(async () => {
        callOrder.push('apply');
        return { status: 'applied' };
      }),
    });
    const engine = createQuickApplyEngine(deps);

    await engine.run({ imagePath: '/test/img.png', targetAppId: 'codex' });

    expect(callOrder).toEqual(['decode', 'analyze', 'extract', 'install', 'apply']);
  });

  it('pushes progress events during pipeline', async () => {
    const progressEvents: string[] = [];
    const deps = makeMockDeps({
      onProgress: vi.fn((p) => progressEvents.push(p.phase)),
    });
    const engine = createQuickApplyEngine(deps);

    await engine.run({ imagePath: '/test/img.png', targetAppId: 'codex' });

    expect(progressEvents).toContain('decoding');
    expect(progressEvents).toContain('analyzing');
    expect(progressEvents).toContain('extracting');
    expect(progressEvents).toContain('building');
    expect(progressEvents).toContain('installing');
    expect(progressEvents).toContain('applying');
    expect(progressEvents).toContain('done');
  });

  it('returns failure when decodeImage throws', async () => {
    const deps = makeMockDeps({
      decodeImage: vi.fn().mockRejectedValue(new Error('File not found')),
    });
    const engine = createQuickApplyEngine(deps);

    const result = await engine.run({ imagePath: '/nonexistent.png', targetAppId: 'codex' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('File not found');
  });

  it('returns failure when applyTheme returns non-applied status', async () => {
    const deps = makeMockDeps({
      applyTheme: vi
        .fn()
        .mockResolvedValue({ status: 'requires-restart', message: 'App not running' }),
    });
    const engine = createQuickApplyEngine(deps);

    const result = await engine.run({ imagePath: '/test/img.png', targetAppId: 'codex' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('App not running');
  });

  it('passes colorCount and forceMode to extractTokens', async () => {
    const extractTokens = vi.fn().mockReturnValue(makeTestTokens());
    const deps = makeMockDeps({ extractTokens });
    const engine = createQuickApplyEngine(deps);

    await engine.run({
      imagePath: '/test/img.png',
      targetAppId: 'codex',
      colorCount: 8,
      forceMode: 'light',
    });

    expect(extractTokens).toHaveBeenCalledWith(expect.any(Object), 8, 'light');
  });

  it('uses default colorCount of 6 when not specified', async () => {
    const extractTokens = vi.fn().mockReturnValue(makeTestTokens());
    const deps = makeMockDeps({ extractTokens });
    const engine = createQuickApplyEngine(deps);

    await engine.run({ imagePath: '/test/img.png', targetAppId: 'codex' });

    expect(extractTokens).toHaveBeenCalledWith(expect.any(Object), 6, undefined);
  });

  it('pushes error phase on failure', async () => {
    const progressEvents: string[] = [];
    const deps = makeMockDeps({
      decodeImage: vi.fn().mockRejectedValue(new Error('decode failed')),
      onProgress: vi.fn((p) => progressEvents.push(p.phase)),
    });
    const engine = createQuickApplyEngine(deps);

    await engine.run({ imagePath: '/test/img.png', targetAppId: 'codex' });

    expect(progressEvents).toContain('error');
  });
});

// ---------------------------------------------------------------------------
// Tests: createQuickApplyEngine.undo
// ---------------------------------------------------------------------------

describe('createQuickApplyEngine.undo', () => {
  it('calls restoreAgent and returns success', async () => {
    const restoreAgent = vi.fn().mockResolvedValue(undefined);
    const deps = makeMockDeps({ restoreAgent });
    const engine = createQuickApplyEngine(deps);

    const result = await engine.undo('codex');

    expect(result.success).toBe(true);
    expect(restoreAgent).toHaveBeenCalledWith('codex');
  });

  it('returns failure when restoreAgent throws', async () => {
    const deps = makeMockDeps({
      restoreAgent: vi.fn().mockRejectedValue(new Error('Restore failed')),
    });
    const engine = createQuickApplyEngine(deps);

    const result = await engine.undo('codex');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Restore failed');
  });
});
