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

const MOCK_SESSION = {
  send: vi.fn(async () => ({ identifier: 'persist-1' })),
  evaluate: vi.fn(async () => 'null'),
  close: vi.fn(),
} as unknown as CdpSession;

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
    usePersistScript?: boolean;
  } = {},
): EngineInjectionDeps {
  return {
    resolveEngineDir: vi.fn(async () => opts.engineDir ?? '/engines/traework'),
    log: vi.fn(),
    // customCss is guaranteed to be defined when the ternary selects this branch
    customThemeCss: opts.customCss !== undefined ? () => opts.customCss! : undefined,
    verifyDelayMs: opts.verifyDelayMs,
    verifyIntervalMs: opts.verifyIntervalMs,
    usePersistScript: opts.usePersistScript,
  };
}

/** Configure all engine files to exist with given content */
function setupEngineFiles(
  opts: {
    tokensCss?: string;
    adapterJs?: string;
    cosmeticCss?: string;
    /** Legacy 7-module mocks (kept for the 'omits shared modules' test). */
    sharedFilesExist?: boolean;
    /** Source returned for the unified engine (engines/unified/engine.mjs). */
    unifiedEngineSource?: string;
  } = {},
) {
  mockAccess.mockResolvedValue(undefined);
  mockReadFile.mockImplementation(async (filePath: string) => {
    // Normalize Windows backslashes so path checks work cross-platform.
    const fp = filePath.replace(/\\/g, '/');
    if (fp.includes('tokens.css')) return opts.tokensCss ?? '/* tokens */';
    if (fp.includes('adapter-config.mjs')) return ''; // no per-agent config by default
    if (fp.includes('adapter.mjs')) return opts.adapterJs ?? '/* adapter */';
    if (fp.includes('cosmetic.css')) return opts.cosmeticCss ?? '/* cosmetic */';
    // Unified engine (merges former 7 shared modules into one IIFE).
    // Path pattern: engines/unified/engine.mjs — must NOT clash with adapter-engine.mjs.
    if (fp.includes('unified/engine.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : (opts.unifiedEngineSource ?? '/* unified-engine */');
    // Legacy shared modules — kept only for the 'omits shared modules' test below.
    if (fp.includes('adapter-engine.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* adapter-engine */';
    if (fp.includes('style-injector.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* style-injector */';
    if (fp.includes('token-discovery.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* token-discovery */';
    if (fp.includes('self-heal.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* self-heal */';
    if (fp.includes('deep-core.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* deep-core */';
    if (fp.includes('visual-engine.mjs'))
      return opts.sharedFilesExist === false
        ? Promise.reject(new Error('ENOENT'))
        : '/* visual-engine */';
    if (fp.includes('verify-and-feedback.mjs'))
      return opts.sharedFilesExist === false ? Promise.reject(new Error('ENOENT')) : '/* verify */';
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

  it('throws when palette CSS build fails (so caller can notify user)', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue(null);
    const deps = makeDeps();

    await expect(
      tryEngineInjection(MOCK_SESSION, 'traework', MOCK_BUNDLE, MOCK_TARGET, null, null, deps),
    ).rejects.toThrow('Failed to build palette CSS');
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

  it('concatenates unified engine before adapter in correct order', async () => {
    // The unified engine (merging the former 7 shared modules) must appear
    // in the final adapterJs BEFORE the agent's own adapter-code, per the
    // layer order: palette → tokens → cosmetic → unified-engine → adapter.
    setupEngineFiles({
      adapterJs: '/* adapter-code */',
      unifiedEngineSource: '/* unified-engine */',
    });
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

    const unifiedEngineIdx = adapterJs.indexOf('/* unified-engine */');
    const adapterIdx = adapterJs.indexOf('/* adapter-code */');

    expect(unifiedEngineIdx).toBeGreaterThanOrEqual(0);
    expect(adapterIdx).toBeGreaterThan(unifiedEngineIdx);
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
    expect(callArgs.adapterJs).not.toContain('/* adapter-engine */');
    expect(callArgs.adapterJs).not.toContain('/* style-injector */');
    expect(callArgs.adapterJs).not.toContain('/* token-discovery */');
    expect(callArgs.adapterJs).not.toContain('/* self-heal */');
    expect(callArgs.adapterJs).not.toContain('/* deep-core */');
    expect(callArgs.adapterJs).not.toContain('/* visual-engine */');
    expect(callArgs.adapterJs).not.toContain('/* verify */');
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

  it('logs error and re-throws on unexpected exception (so caller can notify user)', async () => {
    // Set up engine files so the code reaches buildPaletteCss() — without
    // this, mockAccess returning undefined fails on .then() before we get
    // to the palette build step.
    setupEngineFiles();
    mockBuildPaletteCss.mockImplementation(() => {
      throw new Error('Unexpected generator failure');
    });
    const deps = makeDeps();

    await expect(
      tryEngineInjection(MOCK_SESSION, 'traework', MOCK_BUNDLE, MOCK_TARGET, null, null, deps),
    ).rejects.toThrow('Engine injection failed for agent=traework: Unexpected generator failure');
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('engine injection failed'));
    expect(mockInjectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('passes heroDataUrl correctly when hero is embedded', async () => {
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
    expect(callArgs.heroDataUrl).toBe('data:image/png;base64,abc');
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
    expect(callArgs.heroDataUrl).toBeNull();
    expect(callArgs.heroPath).toBe('/path/to/hero.jpg');
  });

  // ---------------------------------------------------------------------------
  // Phase 4 — usePersistScript feature flag
  // ---------------------------------------------------------------------------

  it('does NOT call send("Page.addScriptToEvaluateOnNewDocument") when usePersistScript is false (default)', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });
    const mockSend = vi.mocked(MOCK_SESSION.send);

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps(),
    );

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('registers engine + config + persist bootstrap via Page.addScriptToEvaluateOnNewDocument when usePersistScript is true', async () => {
    // The unified engine registers itself at both __agentskin_unified_engine__
    // (primary) and __agentskin_shared_engine__ (backward-compat).  The
    // orchestrator now reads engines/unified/engine.mjs, so the mock source
    // must be delivered via unifiedEngineSource.
    const realisticEngineSource =
      "(function(){var MARKER='__agentskin_unified_engine__';" +
      'if(window[MARKER])return;' +
      'window[MARKER]={createAdapter:function(){return{apply:function(){}}},' +
      "installPersistScript:function(){return '';}};})();";
    setupEngineFiles({ unifiedEngineSource: realisticEngineSource });
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    const mockSend = vi.mocked(MOCK_SESSION.send);
    const mockEvaluate = vi.mocked(MOCK_SESSION.evaluate);
    // Step 3 returns a JSON data-only capture; force a real payload so step 4 fires.
    mockEvaluate
      .mockResolvedValueOnce(/* data-config JSON */ '{"agentId":"traework"}')
      .mockResolvedValueOnce(/* installPersistScript result */ '(function(){})()');

    await tryEngineInjection(
      MOCK_SESSION,
      'traework',
      MOCK_BUNDLE,
      MOCK_TARGET,
      null,
      null,
      makeDeps({ usePersistScript: true }),
    );

    // Page.enable sent first
    expect(mockSend).toHaveBeenCalledWith('Page.enable');
    // 3 addScriptToEvaluateOnNewDocument registrations: engine, config (empty here), persist
    const regCalls = mockSend.mock.calls.filter(
      ([method]) => method === 'Page.addScriptToEvaluateOnNewDocument',
    );
    // With no adapterConfigSource in the mock readFile, only 2 registrations
    // fire: engine + persist bootstrap (config registration is gated on empty source).
    expect(regCalls.length).toBeGreaterThanOrEqual(2);
    // The first registration is always the unified engine factory source.
    const firstSource = regCalls[0][1]?.source ?? '';
    expect(firstSource).toContain('__agentskin_unified_engine__');
  });

  it('logs best-effort failure when usePersistScript is true but Page.enable throws', async () => {
    setupEngineFiles();
    mockBuildPaletteCss.mockReturnValue('/* palette */');
    mockInjectThemeViaEngine.mockResolvedValue({ ok: true });

    const mockSend = vi.mocked(MOCK_SESSION.send);
    const deps = makeDeps({ usePersistScript: true });
    vi.mocked(deps.log);
    mockSend.mockReset();
    mockSend.mockRejectedValueOnce(new Error('CDP Page domain unavailable'));
    // After Page.enable fails, the helper returns early — send is never called
    // for addScriptToEvaluateOnNewDocument.
    await tryEngineInjection(MOCK_SESSION, 'traework', MOCK_BUNDLE, MOCK_TARGET, null, null, deps);

    expect(vi.mocked(deps.log)).toHaveBeenCalledWith(
      '[persist] traework: Page.enable failed: CDP Page domain unavailable',
    );
    // No registrations attempted after the Page.enable failure
    expect(mockSend).not.toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument');
  });
});
