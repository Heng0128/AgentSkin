// SPDX-License-Identifier: MPL-2.0

import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../shared/ipc-channels';
import type { InstalledTheme } from '../shared/types';
import { BUNDLE_EXTENSION } from './file-open';
import type { MainContext } from './main-context';
import { handleThemeFileOpen } from './main-context';

// ---------------------------------------------------------------------------
// Mock the bundle-ipc module so tests don't touch the real bundle installer.
// ---------------------------------------------------------------------------
vi.mock('./ipc/bundle-ipc', () => ({
  installBundleFromPath: vi.fn(),
}));

import { installBundleFromPath } from './ipc/bundle-ipc';

const mockedInstallBundleFromPath = vi.mocked(installBundleFromPath);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
function createMockTheme(id: string, name = id): InstalledTheme {
  return {
    id,
    displayName: name,
    version: '1.0.0',
    mode: 'dark',
    colors: {
      background: '#000000',
      foreground: '#ffffff',
      accent: '#ff0000',
      surface: '#111111',
      border: '#222222',
      codeBackground: '#0a0a0a',
      codeForeground: '#cccccc',
      primary: '#ff0000',
      text: '#ffffff',
      secondary: '#888888',
      success: '#00ff00',
      warning: '#ffff00',
      error: '#ff0000',
      muted: '#666666',
    },
    coverDataUrl: null,
    iconDataUrl: null,
    tagline: null,
    supportedAgents: [],
    author: undefined,
    category: undefined,
    tags: [],
    license: undefined,
    scheme: undefined,
    schemes: undefined,
    contentHash: undefined,
    wallpaper: null,
    packageRoot: undefined,
    unofficial: undefined,
  };
}

function createMockWebContents(): WebContents {
  return {
    send: vi.fn(),
  } as unknown as WebContents;
}

function createMockContext(webContents: WebContents): MainContext {
  return {
    mainWindow: {
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: () => false,
      webContents,
    },
    library: {
      inspectPackage: vi.fn(),
      importPackage: vi.fn(),
      summaries: vi.fn().mockResolvedValue([]),
    },
  } as unknown as MainContext;
}

const updateTrayMenu = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('handleThemeFileOpen', () => {
  let webContents: WebContents;
  let context: MainContext;

  beforeEach(() => {
    vi.clearAllMocks();
    webContents = createMockWebContents();
    context = createMockContext(webContents);
  });

  it('shows and focuses the main window on entry', async () => {
    context.library.inspectPackage = vi.fn().mockResolvedValue({
      incoming: createMockTheme('neon'),
      existing: null,
    });
    context.library.importPackage = vi.fn().mockResolvedValue(createMockTheme('neon'));

    await handleThemeFileOpen(context, '/tmp/neon.agentskin-theme', updateTrayMenu);

    expect(context.mainWindow?.show).toHaveBeenCalledTimes(1);
    expect(context.mainWindow?.focus).toHaveBeenCalledTimes(1);
  });

  it('imports a new theme silently and sends FILE_IMPORTED', async () => {
    const theme = createMockTheme('neon');
    context.library.inspectPackage = vi.fn().mockResolvedValue({
      incoming: theme,
      existing: null,
    });
    context.library.importPackage = vi.fn().mockResolvedValue(theme);

    await handleThemeFileOpen(context, '/tmp/neon.agentskin-theme', updateTrayMenu);

    expect(context.library.importPackage).toHaveBeenCalledWith('/tmp/neon.agentskin-theme');
    expect(updateTrayMenu).toHaveBeenCalledTimes(1);
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORTED, {
      theme,
      themes: [],
    });
    // Must NOT send FILE_IMPORT_CONFIRM for a new theme.
    expect(webContents.send).not.toHaveBeenCalledWith(
      IpcChannel.FILE_IMPORT_CONFIRM,
      expect.anything(),
    );
  });

  it('sends FILE_IMPORT_CONFIRM (not FILE_IMPORTED) when the theme id already exists', async () => {
    const incoming = createMockTheme('neon', 'Neon v2');
    const existing = createMockTheme('neon', 'Neon v1');
    context.library.inspectPackage = vi.fn().mockResolvedValue({ incoming, existing });

    await handleThemeFileOpen(context, '/tmp/neon.agentskin-theme', updateTrayMenu);

    // Must NOT import when the id is taken — the renderer asks the user first.
    expect(context.library.importPackage).not.toHaveBeenCalled();
    expect(updateTrayMenu).not.toHaveBeenCalled();
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORT_CONFIRM, {
      path: '/tmp/neon.agentskin-theme',
      incoming,
      existing,
    });
    expect(webContents.send).not.toHaveBeenCalledWith(IpcChannel.FILE_IMPORTED, expect.anything());
  });

  it('routes .agentskin-bundle files through the bundle installer', async () => {
    const theme = createMockTheme('combo');
    mockedInstallBundleFromPath.mockResolvedValue(theme);

    await handleThemeFileOpen(context, `/tmp/combo${BUNDLE_EXTENSION}`, updateTrayMenu);

    expect(mockedInstallBundleFromPath).toHaveBeenCalledWith(
      context,
      `/tmp/combo${BUNDLE_EXTENSION}`,
    );
    // Single-file import path must NOT be touched for bundles.
    expect(context.library.importPackage).not.toHaveBeenCalled();
    expect(context.library.inspectPackage).not.toHaveBeenCalled();
    expect(updateTrayMenu).toHaveBeenCalledTimes(1);
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORTED, {
      theme,
      themes: [],
    });
  });

  it('sends FILE_IMPORT_FAILED when inspectPackage throws (invalid file)', async () => {
    context.library.inspectPackage = vi.fn().mockRejectedValue(new Error('Invalid package'));

    await handleThemeFileOpen(context, '/tmp/corrupt.agentskin-theme', updateTrayMenu);

    expect(context.library.importPackage).not.toHaveBeenCalled();
    expect(updateTrayMenu).not.toHaveBeenCalled();
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORT_FAILED, 'Invalid package');
  });

  it('sends FILE_IMPORT_FAILED when importPackage throws', async () => {
    context.library.inspectPackage = vi.fn().mockResolvedValue({
      incoming: createMockTheme('neon'),
      existing: null,
    });
    context.library.importPackage = vi.fn().mockRejectedValue(new Error('Disk full'));

    await handleThemeFileOpen(context, '/tmp/neon.agentskin-theme', updateTrayMenu);

    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORT_FAILED, 'Disk full');
  });

  it('sends FILE_IMPORT_FAILED when the bundle installer throws', async () => {
    mockedInstallBundleFromPath.mockRejectedValue(new Error('Bundle corrupt'));

    await handleThemeFileOpen(context, `/tmp/combo${BUNDLE_EXTENSION}`, updateTrayMenu);

    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.FILE_IMPORT_FAILED, 'Bundle corrupt');
  });

  it('does not throw even if mainWindow is null (degraded boot)', async () => {
    const degradedContext: MainContext = {
      mainWindow: null,
      library: {
        inspectPackage: vi.fn().mockResolvedValue({
          incoming: createMockTheme('neon'),
          existing: null,
        }),
        importPackage: vi.fn().mockResolvedValue(createMockTheme('neon')),
        summaries: vi.fn().mockResolvedValue([]),
      },
    } as unknown as MainContext;

    // Must not throw — the function early-returns from show()/focus() via
    // optional chaining and the webContents.send call is guarded by ?.
    await expect(
      handleThemeFileOpen(degradedContext, '/tmp/neon.agentskin-theme', updateTrayMenu),
    ).resolves.toBeUndefined();
  });
});
