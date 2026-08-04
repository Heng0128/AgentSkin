// SPDX-License-Identifier: MPL-2.0

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the filesystem-backed halves of palette-builder.ts:
 *   - resolveEngineDirDefault (packaged vs dev fallback)
 *   - tryEngineInjection (engine-file discovery, palette build, delegation)
 *
 * injectThemeViaEngine (cdp-inject) is mocked so we assert the orchestration
 * logic without standing up a real CDP session.
 */
vi.mock('./cdp/cdp-inject', () => ({
  injectThemeViaEngine: vi.fn(),
}));

import { injectThemeViaEngine } from './cdp/cdp-inject';
import {
  type EngineInjectionDeps,
  resolveEngineDirDefault,
  tryEngineInjection,
} from './palette-builder';

const VALID_THEME_CSS = [
  '--agentskin-accent: #ff0000;',
  '--agentskin-secondary: #00ff00;',
  '--agentskin-text: #ffffff;',
  '--agentskin-muted: #888888;',
  '--agentskin-surface: #1a1a1a;',
  '--agentskin-bg: #000000;',
].join('\n');

function makeBundle(id = 'test-theme') {
  return { theme: { id, displayName: id, version: '1.0.0' } } as any;
}

function makeTarget(css = VALID_THEME_CSS) {
  return { css, options: {}, verification: null, imageDataUrls: {}, artDataUrl: null } as any;
}

describe('resolveEngineDirDefault', () => {
  const originalResourcesPath = (process as any).resourcesPath;

  afterEach(() => {
    // Restore resourcesPath between tests.
    if (originalResourcesPath === undefined) delete (process as any).resourcesPath;
    else (process as any).resourcesPath = originalResourcesPath;
  });

  it('returns the packaged engine dir when adapter.mjs exists there', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-engine-'));
    try {
      const enginesRoot = path.join(tmp, 'resources', 'engines');
      const agentDir = path.join(enginesRoot, 'workbuddy');
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, 'adapter.mjs'), '// adapter');
      (process as any).resourcesPath = path.join(tmp, 'resources');

      const result = await resolveEngineDirDefault('workbuddy');
      expect(result).toBe(agentDir);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to the dev engine dir when the packaged adapter is missing', async () => {
    (process as any).resourcesPath = os.tmpdir(); // exists but has no engines/<agent>/adapter.mjs
    const result = await resolveEngineDirDefault('workbuddy');
    expect(result).toBe(path.join(__dirname, '..', '..', 'engines', 'workbuddy'));
  });
});

describe('tryEngineInjection', () => {
  let tmpDir: string;
  let engineDir: string;
  const deps: EngineInjectionDeps = {
    resolveEngineDir: vi.fn(),
    log: vi.fn(),
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-inj-'));
    engineDir = path.join(tmpDir, 'engine');
    await fs.mkdir(engineDir, { recursive: true });
    await fs.writeFile(path.join(engineDir, 'tokens.css'), ':root{}');
    await fs.writeFile(path.join(engineDir, 'adapter.mjs'), 'export{}');
    await fs.writeFile(path.join(engineDir, 'cosmetic.css'), '/*c*/');
    vi.mocked(deps.resolveEngineDir).mockResolvedValue(engineDir);
    vi.mocked(deps.log).mockClear();
    vi.mocked(injectThemeViaEngine).mockClear();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads engine files, builds the palette, and delegates to injectThemeViaEngine', async () => {
    const injected = { ok: true, layersApplied: 4 } as any;
    vi.mocked(injectThemeViaEngine).mockResolvedValueOnce(injected);

    const result = await tryEngineInjection(
      {} as any,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      'data:hero',
      deps,
    );

    expect(result).toBe(injected);
    expect(injectThemeViaEngine).toHaveBeenCalledTimes(1);
    const [session, payload] = vi.mocked(injectThemeViaEngine).mock.calls[0];
    expect(session).toEqual({});
    expect(payload.agent).toBe('workbuddy');
    expect(payload.themeId).toBe('test-theme');
    expect(payload.heroDataUrl).toBe('data:hero');
    expect(payload.paletteCss).toContain('--agentskin-accent-raw: 255, 0, 0;');
    expect(payload.tokensCss).toBe(':root{}');
    expect(payload.adapterJs).toBe('export{}');
    expect(payload.cosmeticCss).toBe('/*c*/');
    expect(payload.themeCss).toBe(VALID_THEME_CSS);
  });

  it('uses "unknown" when the bundle has no theme id', async () => {
    vi.mocked(injectThemeViaEngine).mockResolvedValueOnce({ ok: true } as any);
    await tryEngineInjection({} as any, 'doubao', {} as any, makeTarget(), null, deps);
    const payload = vi.mocked(injectThemeViaEngine).mock.calls[0][1];
    expect(payload.themeId).toBe('unknown');
    expect(payload.heroDataUrl).toBeNull();
  });

  it('returns null when any engine file is missing (legacy fallback)', async () => {
    await fs.unlink(path.join(engineDir, 'cosmetic.css'));
    const result = await tryEngineInjection(
      {} as any,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      null,
      deps,
    );
    expect(result).toBeNull();
    expect(injectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('returns null when the per-agent CSS cannot yield a palette (< 6 tokens)', async () => {
    const result = await tryEngineInjection(
      {} as any,
      'workbuddy',
      makeBundle(),
      makeTarget('--agentskin-accent: #ff0000;'), // too few tokens
      null,
      deps,
    );
    expect(result).toBeNull();
    expect(injectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('logs and returns null when injectThemeViaEngine throws', async () => {
    vi.mocked(injectThemeViaEngine).mockRejectedValueOnce(new Error('CDP down'));
    const result = await tryEngineInjection(
      {} as any,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      null,
      deps,
    );
    expect(result).toBeNull();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('engine injection failed: CDP down'),
    );
  });

  it('logs and returns null when resolveEngineDir rejects', async () => {
    vi.mocked(deps.resolveEngineDir).mockRejectedValueOnce(new Error('no resources'));
    const result = await tryEngineInjection(
      {} as any,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      null,
      deps,
    );
    expect(result).toBeNull();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('engine injection failed: no resources'),
    );
  });
});
