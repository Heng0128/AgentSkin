// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
}));

vi.mock('../main-context', () => ({
  settingsDto: vi.fn(() => ({
    apps: {},
    defaultPorts: {},
    wallpaper: { enabled: false, id: null, agents: {} },
  })),
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
