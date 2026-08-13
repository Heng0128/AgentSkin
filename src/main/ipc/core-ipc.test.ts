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
  app: {
    getVersion: vi.fn().mockReturnValue('5.0.0'),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('../main-context', () => ({
  wrapCatalog: vi.fn((items: unknown[]) => ({
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    items,
  })),
  handleThemeFileOpen: vi.fn(),
}));

vi.mock('../locale-preferences', () => ({
  saveLocalePreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/performance', () => ({
  performanceLogger: {
    logTimeout: vi.fn(),
    log: vi.fn(),
  },
}));

const { registerCoreIpc } = await import('./core-ipc');

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
    fileOpens: { setSink: vi.fn() },
    agentCatalog: {
      listAgents: vi.fn().mockReturnValue([]),
    },
    core: {
      status: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
    },
  } as unknown as MainContext;
}

const updateTrayMenu = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('core-ipc parameter validation', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerCoreIpc(makeMockDeps(), updateTrayMenu);
  });

  describe('LOCALE_SET', () => {
    it('rejects unsupported locale string', async () => {
      const handler = handlers.get(IpcChannel.LOCALE_SET)!;
      await expect(handler({}, 'ja-JP')).rejects.toThrow(getMainMessages().invalidLocale);
      await expect(handler({}, 'fr-FR')).rejects.toThrow(getMainMessages().invalidLocale);
      await expect(handler({}, 'invalid')).rejects.toThrow(getMainMessages().invalidLocale);
    });

    it('rejects non-string locale', async () => {
      const handler = handlers.get(IpcChannel.LOCALE_SET)!;
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidLocale);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidLocale);
      await expect(handler({}, undefined)).rejects.toThrow(getMainMessages().invalidLocale);
    });

    it('rejects empty string', async () => {
      const handler = handlers.get(IpcChannel.LOCALE_SET)!;
      await expect(handler({}, '')).rejects.toThrow(getMainMessages().invalidLocale);
    });
  });

  describe('SYSTEM_STATUS', () => {
    // SYSTEM_STATUS handler closes over `deps` at registration time. To control
    // the core.status() mock, we re-register with a fresh deps whose core.status
    // is a vi.fn() we control.
    function registerWith(statusMock: ReturnType<typeof vi.fn>): void {
      const localDeps = makeMockDeps();
      (localDeps.core as unknown as { status: ReturnType<typeof vi.fn> }).status = statusMock;
      registerCoreIpc(localDeps, updateTrayMenu);
    }

    it('resolves with core.status() payload on happy path', async () => {
      const statusMock = vi.fn();
      const payload = {
        apps: [{ appId: 'vscode', installed: true, running: false, debugReady: true }],
        platform: 'win32',
      };
      statusMock.mockResolvedValue(payload);
      registerWith(statusMock);
      const handler = handlers.get(IpcChannel.SYSTEM_STATUS)!;
      const result = await handler({}, {});
      expect(result).toEqual(payload);
    });

    it('rejects with IpcTimeoutError when core.status() hangs', async () => {
      const statusMock = vi.fn();
      statusMock.mockReturnValue(new Promise(() => {})); // never settles
      registerWith(statusMock);
      const handler = handlers.get(IpcChannel.SYSTEM_STATUS)!;
      const result = await (handler({}, {}) as Promise<unknown>).catch((e: unknown) => e);
      expect(result).toHaveProperty('name', 'IpcTimeoutError');
      expect(result).toHaveProperty('channel', IpcChannel.SYSTEM_STATUS);
      expect(result).toHaveProperty('ms', 15000);
    }, 25000); // IPC timeout is 15s; 25s lets it fire before vitest's own timeout
  });

  describe('SHELL_SHOW_ITEM', () => {
    // SHELL_SHOW_ITEM handler is synchronous (not async), so validation
    // throws synchronously rather than as a rejected promise.
    it('rejects non-string path', () => {
      const handler = handlers.get(IpcChannel.SHELL_SHOW_ITEM)!;
      expect(() => handler({}, 123)).toThrow(getMainMessages().invalidPath);
      expect(() => handler({}, null)).toThrow(getMainMessages().invalidPath);
      expect(() => handler({}, undefined)).toThrow(getMainMessages().invalidPath);
      expect(() => handler({}, {})).toThrow(getMainMessages().invalidPath);
    });

    it('rejects empty path', () => {
      const handler = handlers.get(IpcChannel.SHELL_SHOW_ITEM)!;
      expect(() => handler({}, '')).toThrow(getMainMessages().invalidPath);
    });
  });
});
