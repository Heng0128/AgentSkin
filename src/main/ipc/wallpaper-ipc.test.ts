// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { isIpcTimeoutError } from '../../shared/withTimeout';
import type { MainContext } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => createElectronMock(handlers));

vi.mock('../main-context', () => ({
  settingsDto: vi.fn(() => ({
    apps: {},
    defaultPorts: {},
    wallpaper: { enabled: false, id: null, agents: {} },
  })),
  notifyStatusChanged: vi.fn(),
}));

const { registerWallpaperIpc } = await import('./wallpaper-ipc');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockDeps(): MainContext {
  return {
    mainWindow: null,
    tray: null,
    isQuitting: false,
    locale: 'zh-CN',
    userDataRoot: '/tmp/test',
    settings: {
      setAgentWallpaper: vi.fn().mockResolvedValue(undefined),
    },
    core: {
      applyAgentWallpaperNow: vi.fn().mockResolvedValue({ ok: true }),
      applyWallpaperToAgent: vi.fn().mockResolvedValue({ ok: true }),
      removeWallpaperFromAgent: vi.fn().mockResolvedValue({ ok: true }),
    },
    wallpapers: {
      list: vi.fn().mockResolvedValue([]),
      deleteWallpaper: vi.fn().mockResolvedValue(true),
      importMedia: vi.fn().mockResolvedValue('id-1'),
      isInstalled: vi.fn().mockResolvedValue(false),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as MainContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wallpaper-ipc parameter validation', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerWallpaperIpc(makeMockDeps());
  });

  describe('WALLPAPER_DELETE', () => {
    it('rejects non-string wallpaper id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_DELETE)!;
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidPath);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidPath);
      await expect(handler({}, undefined)).rejects.toThrow(getMainMessages().invalidPath);
    });

    it('rejects empty wallpaper id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_DELETE)!;
      await expect(handler({}, '')).rejects.toThrow(getMainMessages().invalidPath);
    });
  });

  describe('WALLPAPER_SET_AGENT', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_SET_AGENT)!;
      await expect(handler({}, 'unknown', { enabled: true, id: 'wp-1' })).rejects.toThrow(
        getMainMessages().invalidAgentId,
      );
      await expect(handler({}, 123, { enabled: true, id: 'wp-1' })).rejects.toThrow(
        getMainMessages().invalidAgentId,
      );
      await expect(handler({}, null, { enabled: true, id: 'wp-1' })).rejects.toThrow(
        getMainMessages().invalidAgentId,
      );
    });
  });

  describe('WALLPAPER_APPLY_AGENT', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_APPLY_AGENT)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('WALLPAPER_APPLY_TO_AGENT', () => {
    it('rejects non-string wallpaper id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_APPLY_TO_AGENT)!;
      await expect(handler({}, 123, 'workbuddy')).rejects.toThrow(getMainMessages().invalidPath);
      await expect(handler({}, null, 'workbuddy')).rejects.toThrow(getMainMessages().invalidPath);
      await expect(handler({}, '', 'workbuddy')).rejects.toThrow(getMainMessages().invalidPath);
    });

    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_APPLY_TO_AGENT)!;
      await expect(handler({}, 'wp-1', 'unknown')).rejects.toThrow(
        getMainMessages().invalidAgentId,
      );
      await expect(handler({}, 'wp-1', 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 'wp-1', null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('WALLPAPER_REMOVE_FROM_AGENT', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: WALLPAPER_APPLY_TO_AGENT — dependency passthrough + timeout
// ---------------------------------------------------------------------------

describe('WALLPAPER_APPLY_TO_AGENT regression', () => {
  it('dependency failure passes through original error (not wrapped as IpcTimeoutError)', async () => {
    const deps = makeMockDeps();
    (deps.core.applyWallpaperToAgent as Mock).mockRejectedValue(new Error('wallpaper engine gone'));
    registerWallpaperIpc(deps);

    const handler = handlers.get(IpcChannel.WALLPAPER_APPLY_TO_AGENT)!;
    await expect(handler({}, 'wp-1', 'workbuddy')).rejects.toThrow('wallpaper engine gone');
    try {
      await handler({}, 'wp-1', 'workbuddy');
    } catch (err) {
      expect(isIpcTimeoutError(err)).toBe(false);
    }
  });

  it('rejects with IpcTimeoutError when the handler exceeds 30s', async () => {
    vi.useFakeTimers();
    const deps = makeMockDeps();
    (deps.core.applyWallpaperToAgent as Mock).mockReturnValue(new Promise<never>(() => {}));
    registerWallpaperIpc(deps);

    const handler = handlers.get(IpcChannel.WALLPAPER_APPLY_TO_AGENT)!;
    const promise = handler({}, 'wp-1', 'workbuddy');
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});

// WALLPAPER_REMOVE_FROM_AGENT 无 success-path 可附加断言，需独立测试
