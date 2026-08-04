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

const { registerSettingsIpc } = await import('./settings-ipc');

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
      setAppPath: vi.fn().mockResolvedValue(undefined),
      setAppPort: vi.fn().mockResolvedValue(undefined),
    },
    core: {
      status: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
    },
  } as unknown as MainContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let mockDeps: MainContext;

describe('settings-ipc parameter validation', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mockDeps = makeMockDeps();
    registerSettingsIpc(mockDeps);
  });

  describe('SETTINGS_PICK_APP_PATH', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_PICK_APP_PATH)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('SETTINGS_CLEAR_APP_PATH', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_CLEAR_APP_PATH)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('SETTINGS_SET_APP_PORT', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'unknown', 8080)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123, 8080)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null, 8080)).rejects.toThrow(getMainMessages().invalidAgentId);
    });

    it('rejects port below 1024', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'workbuddy', 0)).rejects.toThrow(getMainMessages().invalidPort);
      await expect(handler({}, 'workbuddy', 80)).rejects.toThrow(getMainMessages().invalidPort);
      await expect(handler({}, 'workbuddy', 1023)).rejects.toThrow(getMainMessages().invalidPort);
    });

    it('rejects port above 65535', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'workbuddy', 65536)).rejects.toThrow(getMainMessages().invalidPort);
      await expect(handler({}, 'workbuddy', 100000)).rejects.toThrow(getMainMessages().invalidPort);
    });

    it('rejects non-integer port', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'workbuddy', 8080.5)).rejects.toThrow(getMainMessages().invalidPort);
      await expect(handler({}, 'workbuddy', NaN)).rejects.toThrow(getMainMessages().invalidPort);
    });

    it('rejects non-number port (string, object)', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'workbuddy', '8080')).rejects.toThrow(getMainMessages().invalidPort);
      await expect(handler({}, 'workbuddy', {})).rejects.toThrow(getMainMessages().invalidPort);
    });

    it('accepts null as port (clears override)', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_APP_PORT)!;
      await expect(handler({}, 'workbuddy', null)).resolves.toBeDefined();
      expect(vi.mocked(mockDeps.settings.setAppPort)).toHaveBeenCalledWith('workbuddy', null);
    });
  });
});
