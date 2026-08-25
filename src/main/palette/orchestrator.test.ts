// SPDX-License-Identifier: MPL-2.0

/**
 * Engine Injection Orchestrator — Unit Tests
 *
 * Tests for `tryEngineInjection` covering:
 *   - Engine file absence → returns null (legacy fallback)
 *   - Palette CSS build failure → returns null
 *   - Successful injection → calls injectThemeViaEngine with correct args
 *   - Shared module concatenation order in adapter JS
 *   - Exception handling → logs error + returns null
 *   - Custom CSS layer passthrough
 *   - Default verify timing values
 *   - Image data URL vs file path priority
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedThemeTarget } from '../../legacy/agentskin-core-runtime';
import type { CdpSession } from '../cdp/cdp-client';
import { type EngineInjectionDeps, tryEngineInjection } from './orchestrator';

// ---------------------------------------------------------------------------
// Mock state (shared across tests, reset in beforeEach)
// ---------------------------------------------------------------------------

const mockAccess = vi.fn();
const mockReadFile = vi.fn();
let mockInjectThemeViaEngine: ReturnType<typeof vi.fn>;
let mockBuildPaletteCss: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  promises: {
    access: (...args: unknown[]) => mockAccess(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

vi.mock('../cdp/cdp-inject', async () => {
  const actual = await vi.importActual<typeof import('../cdp/cdp-inject')>('../cdp/cdp-inject');
  return {
    ...actual,
    injectThemeViaEngine: vi.fn(),
  };
});

vi.mock('./generator', async () => {
  const actual = await vi.importActual<typeof import('./generator')>('./generator');
  return {
    ...actual,
    buildPaletteCss: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_SESSION = {} as unknown as CdpSession;

const MOCK_BUNDLE = {
  theme: { id: 'test-theme', name: 'Test', version: '1.0.0' },
} as unknown as Parameters<typeof tryEngineInjection>[2];

const MOCK_TARGET: ResolvedThemeTarget = {
  css: ':root { --agentskin-bg: #ffffff; --agentskin-fg: #000000; }',
} as unknown as ResolvedThemeTarget;

/** Deps that resolve to a virtual engine dir */
function makeDeps(
  opts: {
    engineDir?: string;
    customCss?: string;
    verifyDelayMs?: number;
    verifyIntervalMs?: number;
  } = {},
): EngineInjectionDeps {
  return {
    resolveEngineDir: vi.fn(async () => opts.engineDir ?? '/engines/traework'),
    log: vi.fn(),
    // customCss is guaranteed to be defined when the ternary selects this branch
    customThemeCss: opts.customCss !== undefined ? () => opts.customCss! : undefined,
    verifyDelayMs: opts.verifyDelayMs,
    verifyIntervalMs: opts.verifyIntervalMs,
  };
}

/** Configure all engine files to exist with given content */
function setupEngineFiles(
  opts: {
    tokensCss?: string;
    adapterJs?: string;
    cosmeticCss?: string;
    sharedFilesExist?: boolean;
  } = {},
) {
  mockAccess.mockResolvedValue(undefined);
  mockReadFile.mockImplementation(async (filePath: string) => {
    if (filePath.includes('tokens.css')) return opts.tokensCss ?? '/* tokens */';
    if (filePath.includes('adapter.mjs')) return opts.adapterJs ?? '/* adapter */';
    if (filePath.includes('cosmetic.css')) return opts.cosmeticCss ?? '/* cosmetic */';
    if (filePath.includes('adopted-sheets-manager.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* adopted-sheets */';
    if (filePath.includes('token-discovery.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* token-discovery */';
    if (filePath.includes('deep-core.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* deep-core */';
    return '';
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tryEngineInjection', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockAccess.mockReset();
    mockReadFile.mockReset();

    // Re-acquire mock references after clearAllMocks
    const cdpInject = await import('../cdp/cdp-inject');
    const generator = await import('./generator');
    mockInjectThemeViaEngine = vi.mocked(cdpInject.injectThemeViaEngine);
    mockBuildPaletteCss = vi.mocked(generator.buildPaletteCss);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when engine files do not exist (triggers legacy fallback)', async () => {
    mockAccess.mockImplementation(async (filePath: string) => {
      if (filePath.includes('adapter.mjs')) {
        throw new Error('ENOENT');
      }
      return undefined;
    });

    const result = await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    expect(result).toBeNull();
    expect(mockInjectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('returns null when palette CSS build fails', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue(null);

    const result = await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    expect(result).toBeNull();
    expect(mockInjectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('calls injectThemeViaEngine with correct CSS layers on success', async () => {
    const paletteCss = ':root { --agentskin-accent-raw: 255,0,0; }';
    setupEngineFiles({
      tokensCss: '/* tokens-css */',
      adapterJs: '/* adapter-code */',
      cosmeticCss: '/* cosmetic-css */',
    });
    mockBuildPaletteCss.mockReturnValue(paletteCss);
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    const result = await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    expect(result).toEqual({ ok: true });
    expect(mockInjectThemeViaEngine).toHaveBeenCalledTimes(1);

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.paletteCss).toBe(paletteCss);
    expect(callArgs.tokensCss).toBe('/* tokens-css */');
    expect(callArgs.themeCss).toBe(MOCK_TARGET.css);
    expect(callArgs.agent).toBe('traework');
    expect(callArgs.themeId).toBe('test-theme');
  });

  it('concatenates shared modules before adapter in correct order', async () => {
    setupEngineFiles({ adapterJs: '/* adapter-code */' });
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    const adapterJs = callArgs.adapterJs;

    const adoptedIdx = adapterJs.indexOf('/* adopted-sheets */');
    const discoveryIdx = adapterJs.indexOf('/* token-discovery */');
    const deepCoreIdx = adapterJs.indexOf('/* deep-core */');
    const adapterIdx = adapterJs.indexOf('/* adapter-code */');

    expect(adoptedIdx).toBeGreaterThanOrEqual(0);
    expect(discoveryIdx).toBeGreaterThan(adoptedIdx);
    expect(deepCoreIdx).toBeGreaterThan(discoveryIdx);
    expect(adapterIdx).toBeGreaterThan(deepCoreIdx);
  });

  it('omits shared modules from concatenation when they do not exist', async () => {
    setupEngineFiles({ adapterJs: '/* adapter-code */', sharedFilesExist: false });
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.adapterJs).not.toContain('/* adopted-sheets */');
    expect(callArgs.adapterJs).not.toContain('/* token-discovery */');
    expect(callArgs.adapterJs).not.toContain('/* deep-core */');
    expect(callArgs.adapterJs).toContain('/* adapter-code */');
  });

  it('uses default verifyDelayMs=500 and verifyIntervalMs=50 when not provided', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.verifyDelayMs).toBe(500);
    expect(callArgs.verifyIntervalMs).toBe(50);
  });

  it('uses custom verifyDelayMs and verifyIntervalMs from deps', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps({ verifyDelayMs: 1000, verifyIntervalMs: 75 }),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.verifyDelayMs).toBe(1000);
    expect(callArgs.verifyIntervalMs).toBe(75);
  });

  it('passes customThemeCss as the final CSS layer when provided', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps({ customCss: '/* user-override */' }),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.customCss).toBe('/* user-override */');
  });

  it('does not pass customThemeCss when not provided', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.customCss).toBeUndefined();
  });

  it('logs error and returns null on unexpected exception', async () => {
    mockBuildPaletteCss.mockImplementation(() => {
      throw new Error('Unexpected generator failure');
    });
    const deps = makeDeps();

    const result = await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      deps,
    );

    expect(result).toBeNull();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('engine injection failed'));
    expect(mockInjectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('passes imageDataUrls correctly when hero is embedded', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    const imageDataUrls = { hero: 'data:image/png;base64,abc' };

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      imageDataUrls,
      null,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.imageDataUrls).toEqual(imageDataUrls);
    expect(callArgs.heroPath).toBeUndefined();
  });

  it('uses heroPath when imageDataUrls has no hero but file path exists', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    const imageDataUrls = { thumbnail: 'data:image/png;base64,xyz' };
    const imageFilePaths = { hero: '/path/to/hero.jpg' };

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      imageDataUrls,
      imageFilePaths,
      makeDeps(),
    );

    const callArgs = mockInjectThemeViaEngine.mock.calls[0][1];
    expect(callArgs.heroPath).toBe('/path/to/hero.jpg');
  });
});
