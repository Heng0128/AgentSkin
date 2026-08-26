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

import type { ResolvedThemeTarget, ThemeBundle } from '../legacy/agentskin-core-runtime';
import type { CdpSession } from './cdp/cdp-client';
import { injectThemeViaEngine } from './cdp/cdp-inject';
import type { InjectEngineResult } from './cdp/injection/engine-strategy';
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

function makeBundle(id = 'test-theme'): ThemeBundle {
  return { theme: { id, displayName: id, version: '1.0.0' } } as unknown as ThemeBundle;
}

function makeTarget(css = VALID_THEME_CSS): ResolvedThemeTarget {
  return {
    css,
    options: {},
    verification: null,
    imageDataUrls: {},
    artDataUrl: null,
  } as unknown as ResolvedThemeTarget;
}

describe('resolveEngineDirDefault', () => {
  const originalResourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;

  afterEach(() => {
    // Restore resourcesPath between tests.
    if (originalResourcesPath === undefined) {
      delete (process as unknown as { resourcesPath?: string }).resourcesPath;
    } else {
      (process as unknown as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
    }
  });

  it('returns the packaged engine dir when adapter.mjs exists there', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-engine-'));
    try {
      const enginesRoot = path.join(tmp, 'resources', 'engines');
      const agentDir = path.join(enginesRoot, 'workbuddy');
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, 'adapter.mjs'), '// adapter');
      (process as unknown as { resourcesPath?: string }).resourcesPath = path.join(
        tmp,
        'resources',
      );

      const result = await resolveEngineDirDefault('workbuddy');
      expect(result).toBe(agentDir);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to the dev engine dir when the packaged adapter is missing', async () => {
    (process as unknown as { resourcesPath?: string }).resourcesPath = os.tmpdir(); // exists but has no engines/<agent>/adapter.mjs
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
    vi.restoreAllMocks();
  });

  it('loads engine files, builds the palette, and delegates to injectThemeViaEngine', async () => {
    const injected = { ok: true, layersApplied: 4 } as unknown as InjectEngineResult;
    vi.mocked(injectThemeViaEngine).mockResolvedValueOnce(injected);

    const result = await tryEngineInjection(
      {} as unknown as CdpSession,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      { hero: 'data:hero' },
      null,
      deps,
    );

    expect(result).toBe(injected);
    expect(injectThemeViaEngine).toHaveBeenCalledTimes(1);
    const [session, payload] = vi.mocked(injectThemeViaEngine).mock.calls[0];
    expect(session).toEqual({});
    expect(payload.agent).toBe('workbuddy');
    expect(payload.themeId).toBe('test-theme');
    expect(payload.imageDataUrls).toEqual({ hero: 'data:hero' });
    expect(payload.paletteCss).toContain('--agentskin-accent-raw: 255, 0, 0;');
    expect(payload.tokensCss).toBe(':root{}');
    expect(payload.adapterJs).toBe('export{}');
    expect(payload.cosmeticCss).toBe('/*c*/');
    expect(payload.themeCss).toBe(VALID_THEME_CSS);
  });

  it('uses "unknown" when the bundle has no theme id', async () => {
    vi.mocked(injectThemeViaEngine).mockResolvedValueOnce({
      ok: true,
    } as unknown as InjectEngineResult);
    await tryEngineInjection(
      {} as unknown as CdpSession,
      'doubao',
      {} as unknown as ThemeBundle,
      makeTarget(),
      null,
      null,
      deps,
    );
    const payload = vi.mocked(injectThemeViaEngine).mock.calls[0][1];
    expect(payload.themeId).toBe('unknown');
    expect(payload.imageDataUrls).toBeUndefined();
  });

  it('returns null when any engine file is missing (legacy fallback)', async () => {
    await fs.unlink(path.join(engineDir, 'cosmetic.css'));
    const result = await tryEngineInjection(
      {} as unknown as CdpSession,
      'workbuddy',
      makeBundle(),
      makeTarget(),
      null,
      null,
      deps,
    );
    expect(result).toBeNull();
    expect(injectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('throws when the per-agent CSS cannot yield a palette (< 6 tokens)', async () => {
    await expect(
      tryEngineInjection(
        {} as unknown as CdpSession,
        'workbuddy',
        makeBundle(),
        makeTarget('--agentskin-accent: #ff0000;'), // too few tokens
        null,
        null,
        deps,
      ),
    ).rejects.toThrow('Failed to build palette CSS for agent=workbuddy');
    expect(injectThemeViaEngine).not.toHaveBeenCalled();
  });

  it('logs and throws when injectThemeViaEngine throws', async () => {
    vi.mocked(injectThemeViaEngine).mockRejectedValueOnce(new Error('CDP down'));
    await expect(
      tryEngineInjection(
        {} as unknown as CdpSession,
        'workbuddy',
        makeBundle(),
        makeTarget(),
        null,
        null,
        deps,
      ),
    ).rejects.toThrow('Engine injection failed for agent=workbuddy: CDP down');
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('engine injection failed: CDP down'),
    );
  });

  it('logs and throws when resolveEngineDir rejects', async () => {
    vi.mocked(deps.resolveEngineDir).mockRejectedValueOnce(new Error('no resources'));
    await expect(
      tryEngineInjection(
        {} as unknown as CdpSession,
        'workbuddy',
        makeBundle(),
        makeTarget(),
        null,
        null,
        deps,
      ),
    ).rejects.toThrow('Engine injection failed for agent=workbuddy: no resources');
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('engine injection failed: no resources'),
    );
  });
});
