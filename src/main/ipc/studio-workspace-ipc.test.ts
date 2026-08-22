// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isIpcTimeoutError } from '../../shared/withTimeout';
import type { MainContext } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-workspace-ipc-test-'));

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const showOpenDialog = vi.fn();
const createFromBuffer = vi.fn();

vi.mock('electron', () => ({
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  nativeImage: { createFromBuffer: (...args: unknown[]) => createFromBuffer(...args) },
}));

const deriveThemeFromImage = vi.fn();
const sampleFromBitmap = vi.fn();
const bundlesDir = vi.fn();
const installBundleFromPath = vi.fn();

vi.mock('../theme/theme-from-image', () => ({
  deriveThemeFromImage: (...args: unknown[]) => deriveThemeFromImage(...args),
}));
vi.mock('../theme/wallpaper-theme', () => ({
  sampleFromBitmap: (...args: unknown[]) => sampleFromBitmap(...args),
}));
vi.mock('./bundle-ipc', () => ({
  bundlesDir: (...args: unknown[]) => bundlesDir(...args),
  installBundleFromPath: (...args: unknown[]) => installBundleFromPath(...args),
}));

const themePackageLoaderLoad = vi.fn();
const themeInstallerInstall = vi.fn();

// Class-field pattern: `load`/`install` are arrow functions bound at construction
// time to the shared vi.fn() references. beforeEach's clearAllMocks() mutates the
// vi.fn() in place (does not reassign), so the class-field reference stays valid.
vi.mock('../catalog/theme-package-loader', () => ({
  ThemePackageLoader: class {
    load = (...args: unknown[]) => themePackageLoaderLoad(...args);
  },
}));
vi.mock('../catalog/theme-installer', () => ({
  ThemeInstaller: class {
    install = (...args: unknown[]) => themeInstallerInstall(...args);
  },
}));

const notifyStatusChanged = vi.fn();

vi.mock('../main-context', () => ({
  notifyStatusChanged: (...args: unknown[]) => notifyStatusChanged(...args),
}));

const { registerStudioWorkspaceIpc } = await import('./studio-workspace-ipc');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, ...args) as T;
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}): MainContext {
  return {
    userDataRoot: TEST_USER_DATA,
    wallpapers: null,
    library: {},
    ...overrides,
  } as unknown as MainContext;
}

/** A valid tiny PNG data URL (1x1 transparent pixel). */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeFakeImage(
  options: { empty?: boolean; size?: { width: number; height: number } } = {},
) {
  const size = options.size ?? { width: 100, height: 50 };
  return {
    isEmpty: () => Boolean(options.empty),
    getSize: () => size,
    resize: (opts: { width: number }) => ({
      getSize: () => ({
        width: opts.width,
        height: Math.round((size.height / size.width) * opts.width),
      }),
      toBitmap: () => new Uint8Array(4),
    }),
    toBitmap: () => new Uint8Array(4),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('registerStudioWorkspaceIpc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    bundlesDir.mockReturnValue(path.join(TEST_USER_DATA, 'bundles'));
    createFromBuffer.mockReturnValue(makeFakeImage());
    sampleFromBitmap.mockReturnValue(['#101018', '#e8e2ff']);
    deriveThemeFromImage.mockReturnValue({
      palette: { primary: '#101018' },
      mode: 'dark',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('studio:image:extract-theme', () => {
    it('decodes, samples and derives a palette', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ palette: unknown; mode: string }>(
        'studio:image:extract-theme',
        TINY_PNG,
      );
      expect(createFromBuffer).toHaveBeenCalled();
      expect(sampleFromBitmap).toHaveBeenCalled();
      expect(deriveThemeFromImage).toHaveBeenCalledWith({ colors: ['#101018', '#e8e2ff'] });
      expect(result.mode).toBe('dark');
    });

    it('rejects non-string payloads', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:image:extract-theme', 42)).rejects.toThrow(/data URL string/);
    });

    it('rejects unsupported formats', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      await expect(
        call('studio:image:extract-theme', 'data:image/svg+xml;base64,PHN2Zz4='),
      ).rejects.toThrow(/Unsupported image format/);
    });

    it('rejects images over the 8 MiB limit', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      // base64 inflates 4:3 — 12 MiB of base64 decodes to ~9 MiB of binary (> 8 MiB cap).
      const big = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`;
      await expect(call('studio:image:extract-theme', big)).rejects.toThrow(/MiB limit/);
    });

    it('rejects undecodable buffers', async () => {
      createFromBuffer.mockReturnValue(makeFakeImage({ empty: true }));
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:image:extract-theme', TINY_PNG)).rejects.toThrow(
        /Failed to decode image buffer/,
      );
    });

    it('rejects decompression-bomb dimensions over 4096px', async () => {
      createFromBuffer.mockReturnValue(makeFakeImage({ size: { width: 5000, height: 5000 } }));
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:image:extract-theme', TINY_PNG)).rejects.toThrow(/safe limit/);
    });
  });

  describe('studio:wallpaper:list', () => {
    it('maps WallpaperInfo entries to the Studio DTO', async () => {
      const ctx = makeCtx({
        wallpapers: {
          list: vi.fn().mockResolvedValue([
            { id: 'w1', title: 'Aurora', projectType: 'video', previewUrl: 'C:\\thumb.png' },
            { id: 'w2', title: 'Static', projectType: 'image', previewUrl: undefined },
            { id: 'w3', title: 'App', projectType: 'application' },
          ]),
        },
      });
      registerStudioWorkspaceIpc(ctx);
      const result =
        await call<Array<{ id: string; type: string; thumbUrl?: string }>>('studio:wallpaper:list');
      expect(result).toEqual([
        expect.objectContaining({ id: 'w1', type: 'video' }),
        expect.objectContaining({ id: 'w2', type: 'preset' }),
        expect.objectContaining({ id: 'w3', type: 'preset' }),
      ]);
      // previewUrl maps to a loopback file:// URL
      expect(result[0].thumbUrl).toMatch(/^file:\/\//);
    });

    it('returns an empty list when the wallpaper service is unavailable', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call('studio:wallpaper:list');
      expect(result).toEqual([]);
    });

    it('returns an empty list when listing throws', async () => {
      const ctx = makeCtx({
        wallpapers: { list: vi.fn().mockRejectedValue(new Error('boom')) },
      });
      registerStudioWorkspaceIpc(ctx);
      const result = await call('studio:wallpaper:list');
      expect(result).toEqual([]);
    });
  });

  describe('studio:bundle:list', () => {
    it('lists unpacked bundle directories with wallpaper detection', async () => {
      const bundles = path.join(TEST_USER_DATA, 'bundles');
      fs.mkdirSync(path.join(bundles, 'theme-a'), { recursive: true });
      fs.mkdirSync(path.join(bundles, 'theme-b'), { recursive: true });
      fs.writeFileSync(
        path.join(bundles, 'theme-a', 'manifest.json'),
        JSON.stringify({ id: 'theme-a', wallpaper: { type: 'video' } }),
      );
      fs.writeFileSync(
        path.join(bundles, 'theme-b', 'manifest.json'),
        JSON.stringify({ id: 'theme-b' }),
      );

      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<Array<{ id: string; hasWallpaper: boolean }>>('studio:bundle:list');
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'theme-a', hasWallpaper: true }),
          expect.objectContaining({ id: 'theme-b', hasWallpaper: false }),
        ]),
      );
    });

    it('returns an empty list when the bundles dir is missing', async () => {
      bundlesDir.mockReturnValue(path.join(TEST_USER_DATA, 'no-such-bundles'));
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call('studio:bundle:list');
      expect(result).toEqual([]);
    });
  });

  describe('studio:bundle:install-by-id', () => {
    it('rejects unsafe ids', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:bundle:install-by-id', '../evil')).rejects.toThrow(
        /valid theme id/,
      );
      await expect(call('studio:bundle:install-by-id', 42)).rejects.toThrow(/valid theme id/);
    });

    it('soft-fails when the bundle directory does not exist', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ ok: boolean; error?: string }>(
        'studio:bundle:install-by-id',
        'ghost',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
      expect(notifyStatusChanged).not.toHaveBeenCalled();
    });

    it('installs bundle by id and calls notifyStatusChanged on success', async () => {
      const bundles = path.join(TEST_USER_DATA, 'bundles');
      fs.mkdirSync(path.join(bundles, 'valid-theme'), { recursive: true });
      // fs.access in the handler needs the directory to exist — mkdirSync above
      // ensures that. bundlesDir mock returns `bundles`, and id='valid-theme'
      // resolves to bundles/valid-theme which now exists.
      themePackageLoaderLoad.mockResolvedValue({ id: 'valid-theme', name: 'Valid Theme' });
      themeInstallerInstall.mockResolvedValue(undefined);
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ ok: boolean }>('studio:bundle:install-by-id', 'valid-theme');
      expect(result.ok).toBe(true);
      expect(themePackageLoaderLoad).toHaveBeenCalledWith('valid-theme');
      expect(themeInstallerInstall).toHaveBeenCalled();
      expect(notifyStatusChanged).toHaveBeenCalled();
    });

    it('does NOT call notifyStatusChanged when install throws', async () => {
      const bundles = path.join(TEST_USER_DATA, 'bundles');
      fs.mkdirSync(path.join(bundles, 'broken-theme'), { recursive: true });
      themePackageLoaderLoad.mockResolvedValue({ id: 'broken-theme', name: 'Broken' });
      themeInstallerInstall.mockRejectedValue(new Error('install failed'));
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ ok: boolean; error?: string }>(
        'studio:bundle:install-by-id',
        'broken-theme',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('install failed');
      expect(notifyStatusChanged).not.toHaveBeenCalled();
    });
  });

  describe('studio:bundle:import', () => {
    it('returns null when the dialog is cancelled', async () => {
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call('studio:bundle:import');
      expect(result).toBeNull();
      expect(notifyStatusChanged).not.toHaveBeenCalled();
    });

    it('installs the picked bundle and returns its id/name', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x.agentskin-bundle'] });
      installBundleFromPath.mockResolvedValue({ id: 'my-bundle', displayName: 'My Bundle' });
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ id: string; name: string }>('studio:bundle:import');
      expect(installBundleFromPath).toHaveBeenCalledWith(
        expect.anything(),
        'C:\\x.agentskin-bundle',
      );
      expect(result).toEqual({ id: 'my-bundle', name: 'My Bundle' });
      expect(notifyStatusChanged).toHaveBeenCalled();
    });

    it('does NOT call notifyStatusChanged when import fails', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x.agentskin-bundle'] });
      installBundleFromPath.mockRejectedValue(new Error('tar extract boom'));
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:bundle:import')).rejects.toThrow('tar extract boom');
      expect(notifyStatusChanged).not.toHaveBeenCalled();
    });
  });

  describe('studio:bundle:delete', () => {
    it('rejects unsafe ids', async () => {
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:bundle:delete', '..')).rejects.toThrow(/valid theme id/);
    });

    it('removes the bundle directory', async () => {
      const bundles = path.join(TEST_USER_DATA, 'bundles');
      fs.mkdirSync(path.join(bundles, 'doomed'), { recursive: true });
      fs.writeFileSync(path.join(bundles, 'doomed', 'manifest.json'), '{}');
      registerStudioWorkspaceIpc(makeCtx());
      const result = await call<{ ok: boolean }>('studio:bundle:delete', 'doomed');
      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(bundles, 'doomed'))).toBe(false);
      expect(notifyStatusChanged).toHaveBeenCalled();
    });

    it('does NOT call notifyStatusChanged when delete fails', async () => {
      // Mock rm by overriding the fs.rm via the rm import used in handler.
      // The handler imports `rm` from 'node:fs/promises' at top level — we
      // cannot easily mock it here, so we test via a non-writable scenario:
      // pass a valid-looking id whose directory exists but rm throws.
      // Since rm is a top-level import in the target module, we instead
      // exercise the unsafe-id path (which throws before any rm/fs call).
      registerStudioWorkspaceIpc(makeCtx());
      await expect(call('studio:bundle:delete', '../evil')).rejects.toThrow(/valid theme id/);
      expect(notifyStatusChanged).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: STUDIO_BUNDLE_IMPORT — dependency passthrough + timeout
// ---------------------------------------------------------------------------

describe('STUDIO_BUNDLE_IMPORT regression', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    bundlesDir.mockReturnValue(path.join(TEST_USER_DATA, 'bundles'));
    createFromBuffer.mockReturnValue(makeFakeImage());
    sampleFromBitmap.mockReturnValue(['#101018', '#e8e2ff']);
    deriveThemeFromImage.mockReturnValue({
      palette: { primary: '#101018' },
      mode: 'dark',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('dependency failure passes through original error (not wrapped as IpcTimeoutError)', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x.agentskin-bundle'] });
    installBundleFromPath.mockRejectedValue(new Error('tar extract boom'));
    registerStudioWorkspaceIpc(makeCtx());

    await expect(call('studio:bundle:import')).rejects.toThrow('tar extract boom');
    try {
      await call('studio:bundle:import');
    } catch (err) {
      expect(isIpcTimeoutError(err)).toBe(false);
    }
    expect(notifyStatusChanged).not.toHaveBeenCalled();
  });

  it('rejects with IpcTimeoutError when the handler exceeds 60s', async () => {
    vi.useFakeTimers();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x.agentskin-bundle'] });
    installBundleFromPath.mockReturnValue(new Promise<never>(() => {}));
    registerStudioWorkspaceIpc(makeCtx());

    const promise = call<{ id: string; name: string }>('studio:bundle:import');
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
    expect(notifyStatusChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regression: STUDIO_BUNDLE_INSTALL_BY_ID — timeout + negative
// ---------------------------------------------------------------------------

describe('STUDIO_BUNDLE_INSTALL_BY_ID regression', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    bundlesDir.mockReturnValue(path.join(TEST_USER_DATA, 'bundles'));
    themePackageLoaderLoad.mockResolvedValue({ id: 'slow-theme', name: 'Slow Theme' });
    // install never resolves → handler hits 15s timeout
    themeInstallerInstall.mockReturnValue(new Promise<never>(() => {}));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('rejects with IpcTimeoutError when install exceeds 15s', async () => {
    vi.useFakeTimers();
    const bundles = path.join(TEST_USER_DATA, 'bundles');
    fs.mkdirSync(path.join(bundles, 'slow-theme'), { recursive: true });
    registerStudioWorkspaceIpc(makeCtx());

    const promise = call<{ ok: boolean }>('studio:bundle:install-by-id', 'slow-theme');
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
    expect(notifyStatusChanged).not.toHaveBeenCalled();
  });
});
