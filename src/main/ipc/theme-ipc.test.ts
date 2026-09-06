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
  wrapCatalog: vi.fn((items: unknown[]) => ({
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    items,
  })),
  notifyStatusChanged: vi.fn(),
  handleThemeFileOpen: vi.fn(),
}));

vi.mock('../file-open', () => ({
  isThemePackagePath: vi.fn((p: string) => p.endsWith('.agenttheme')),
}));

vi.mock('../../legacy/agentskin-core-runtime', () => ({
  agentThemeExtension: '.agenttheme',
}));

// Mock regenerateTheme so tests can capture its arguments and control the
// thunk return without invoking the heavy partialRerun pipeline (adaptAll,
// completeSurfaceLayering, contractCheck). The mock thunk mimics the real
// behaviour: when colors is null/undefined, the thunk returns the
// 'no colors available for regen' failure.
const capturedRegenArgs: Array<{ agentId: string; themeId: string; colors: unknown }> = [];
vi.mock('../theme-asset/fingerprint', () => ({
  regenerateTheme: vi.fn((agentId: string, themeId: string, colors?: unknown) => {
    capturedRegenArgs.push({ agentId, themeId, colors });
    return async () => {
      if (!colors) {
        return { status: 'failed' as const, reason: 'no colors available for regen' };
      }
      return { status: 'success' as const, reason: 'mock regen ok' };
    };
  }),
}));

// Import after mocks are declared.
const { registerThemeIpc } = await import('./theme-ipc');
const { setTrustedSenderId } = await import('./trusted-sender');

// Trusted-sender guard (G5): every high-sensitivity handler rejects calls
// unless the event originates from the recorded main-window webContents id.
beforeEach(() => {
  setTrustedSenderId(1);
  capturedRegenArgs.length = 0;
});

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
    library: {
      importPackage: vi.fn().mockResolvedValue({ id: 'test', name: 'Test' }),
      installBytes: vi.fn().mockResolvedValue({ id: 'test', name: 'Test' }),
      find: vi.fn().mockResolvedValue({
        bundle: { theme: { id: 'test', name: 'Test', version: '1.0.0' } },
        filePath: '/tmp/test.agenttheme',
      }),
      exportPackage: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      summaries: vi.fn().mockResolvedValue([]),
    },
    themeCatalog: {
      listThemes: vi.fn().mockResolvedValue([]),
      getTheme: vi.fn().mockResolvedValue(null),
      searchThemes: vi.fn().mockResolvedValue([]),
      filterByAgent: vi.fn().mockResolvedValue([]),
    },
    core: {
      apply: vi.fn().mockResolvedValue({ ok: true }),
      restore: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
      status: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
    },
    settings: {},
    wallpapers: {},
    agentCatalog: {},
    fileOpens: { handlePath: vi.fn() },
  } as unknown as MainContext;
}

const updateTrayMenu = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('theme-ipc parameter validation', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerThemeIpc(makeMockDeps(), updateTrayMenu);
  });

  describe('THEME_GET', () => {
    // THEME_GET handler is synchronous (returns a Promise but the assertion
    // throws before the return), so validation throws synchronously.
    it('rejects non-string theme id', () => {
      const handler = handlers.get(IpcChannel.THEME_GET)!;
      expect(() => handler({}, 123)).toThrow(getMainMessages().invalidThemeId);
      expect(() => handler({}, null)).toThrow(getMainMessages().invalidThemeId);
      expect(() => handler({}, undefined)).toThrow(getMainMessages().invalidThemeId);
    });

    it('rejects empty theme id', () => {
      const handler = handlers.get(IpcChannel.THEME_GET)!;
      expect(() => handler({}, '')).toThrow(getMainMessages().invalidThemeId);
    });

    it('rejects path-traversal theme id', () => {
      const handler = handlers.get(IpcChannel.THEME_GET)!;
      expect(() => handler({}, '../etc/passwd')).toThrow(getMainMessages().invalidThemeId);
      expect(() => handler({}, 'a/b')).toThrow(getMainMessages().invalidThemeId);
      expect(() => handler({}, 'a\\b')).toThrow(getMainMessages().invalidThemeId);
    });
  });

  describe('THEME_SEARCH', () => {
    it('rejects non-string query', async () => {
      const handler = handlers.get(IpcChannel.THEME_SEARCH)!;
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidSearchQuery);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidSearchQuery);
      await expect(handler({}, undefined)).rejects.toThrow(getMainMessages().invalidSearchQuery);
    });

    it('rejects empty query', async () => {
      const handler = handlers.get(IpcChannel.THEME_SEARCH)!;
      await expect(handler({}, '')).rejects.toThrow(getMainMessages().invalidSearchQuery);
    });
  });

  describe('THEME_FILTER', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.THEME_FILTER)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('THEME_APPLY', () => {
    it('rejects null request', async () => {
      const handler = handlers.get(IpcChannel.THEME_APPLY)!;
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidApplyRequest);
    });

    it('rejects request with invalid appId', async () => {
      const handler = handlers.get(IpcChannel.THEME_APPLY)!;
      await expect(handler({}, { appId: 'unknown', themeId: 'dark' })).rejects.toThrow(
        getMainMessages().invalidApplyRequest,
      );
      await expect(handler({}, { appId: 123, themeId: 'dark' })).rejects.toThrow(
        getMainMessages().invalidApplyRequest,
      );
    });

    it('rejects request with non-string themeId', async () => {
      const handler = handlers.get(IpcChannel.THEME_APPLY)!;
      await expect(handler({}, { appId: 'workbuddy', themeId: 123 })).rejects.toThrow(
        getMainMessages().invalidApplyRequest,
      );
      await expect(handler({}, { appId: 'workbuddy', themeId: null })).rejects.toThrow(
        getMainMessages().invalidApplyRequest,
      );
    });
  });

  describe('THEME_RESTORE', () => {
    it('rejects invalid agent id', async () => {
      const handler = handlers.get(IpcChannel.THEME_RESTORE)!;
      await expect(handler({}, 'unknown')).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidAgentId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidAgentId);
    });
  });

  describe('THEME_EXPORT', () => {
    it('rejects non-string theme id', async () => {
      const handler = handlers.get(IpcChannel.THEME_EXPORT)!;
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidThemeId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidThemeId);
    });

    it('rejects path-traversal theme id', async () => {
      const handler = handlers.get(IpcChannel.THEME_EXPORT)!;
      await expect(handler({}, '../secret')).rejects.toThrow(getMainMessages().invalidThemeId);
      await expect(handler({}, 'a/b')).rejects.toThrow(getMainMessages().invalidThemeId);
    });
  });

  describe('THEME_DELETE', () => {
    it('rejects non-string theme id', async () => {
      const handler = handlers.get(IpcChannel.THEME_DELETE)!;
      await expect(handler({}, 123)).rejects.toThrow(getMainMessages().invalidThemeId);
      await expect(handler({}, null)).rejects.toThrow(getMainMessages().invalidThemeId);
    });

    it('rejects path-traversal theme id', async () => {
      const handler = handlers.get(IpcChannel.THEME_DELETE)!;
      await expect(handler({}, '../../etc/passwd')).rejects.toThrow(
        getMainMessages().invalidThemeId,
      );
    });
  });

  describe('THEME_IMPORT_BYTES', () => {
    it('rejects non-Buffer/non-Uint8Array bytes', async () => {
      const handler = handlers.get(IpcChannel.THEME_IMPORT_BYTES)!;
      await expect(handler({}, 'string', 'id')).rejects.toThrow(getMainMessages().invalidPackage);
      await expect(handler({}, 123, 'id')).rejects.toThrow(getMainMessages().invalidPackage);
      await expect(handler({}, null, 'id')).rejects.toThrow(getMainMessages().invalidPackage);
      await expect(handler({}, {}, 'id')).rejects.toThrow(getMainMessages().invalidPackage);
    });

    it('rejects non-string suggestedId', async () => {
      const handler = handlers.get(IpcChannel.THEME_IMPORT_BYTES)!;
      const bytes = Buffer.from('test');
      await expect(handler({}, bytes, 123)).rejects.toThrow(getMainMessages().invalidPackage);
      await expect(handler({}, bytes, null)).rejects.toThrow(getMainMessages().invalidPackage);
    });
  });

  describe('THEME_IMPORT_PATH', () => {
    const trustedEvent = { sender: { id: 1 }, senderFrame: { isMainFrame: () => true } };

    it('rejects non-string filePath', async () => {
      const handler = handlers.get(IpcChannel.THEME_IMPORT_PATH)!;
      await expect(handler(trustedEvent, 123)).rejects.toThrow(getMainMessages().invalidPackage);
      await expect(handler(trustedEvent, null)).rejects.toThrow(getMainMessages().invalidPackage);
    });

    it('rejects filePath that is not a theme package', async () => {
      const handler = handlers.get(IpcChannel.THEME_IMPORT_PATH)!;
      await expect(handler(trustedEvent, '/tmp/not-a-theme.txt')).rejects.toThrow(
        getMainMessages().invalidPackage,
      );
      await expect(handler(trustedEvent, '/tmp/random.zip')).rejects.toThrow(
        getMainMessages().invalidPackage,
      );
    });

    it('rejects calls from an untrusted sender (G5)', async () => {
      const handler = handlers.get(IpcChannel.THEME_IMPORT_PATH)!;
      await expect(handler({ sender: { id: 999 } }, '/tmp/a.agenttheme')).rejects.toThrow(
        'Untrusted IPC sender',
      );
    });
  });

  describe('THEME_OPEN_FILE', () => {
    const trustedEvent = { sender: { id: 1 }, senderFrame: { isMainFrame: () => true } };

    // THEME_OPEN_FILE handler is synchronous, so validation throws
    // synchronously rather than as a rejected promise.
    it('rejects non-string filePath', () => {
      const handler = handlers.get(IpcChannel.THEME_OPEN_FILE)!;
      expect(() => handler(trustedEvent, 123)).toThrow(getMainMessages().invalidPackage);
      expect(() => handler(trustedEvent, null)).toThrow(getMainMessages().invalidPackage);
    });

    it('rejects filePath that is not a theme package', () => {
      const handler = handlers.get(IpcChannel.THEME_OPEN_FILE)!;
      expect(() => handler(trustedEvent, '/tmp/not-a-theme.txt')).toThrow(
        getMainMessages().invalidPackage,
      );
    });

    it('rejects calls from an untrusted sender (G5)', () => {
      const handler = handlers.get(IpcChannel.THEME_OPEN_FILE)!;
      expect(() => handler({ sender: { id: 999 } }, '/tmp/a.agenttheme')).toThrow(
        'Untrusted IPC sender',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: THEME_APPLY / THEME_RESTORE — dependency passthrough + timeout
// ---------------------------------------------------------------------------

describe('THEME_APPLY regression', () => {
  it('dependency failure passes through original error (not wrapped as IpcTimeoutError)', async () => {
    const deps = makeMockDeps();
    (deps.core.apply as Mock).mockRejectedValue(new Error('core apply boom'));
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_APPLY)!;
    await expect(handler({}, { appId: 'workbuddy', themeId: 'dark' })).rejects.toThrow(
      'core apply boom',
    );
    try {
      await handler({}, { appId: 'workbuddy', themeId: 'dark' });
    } catch (err) {
      expect(isIpcTimeoutError(err)).toBe(false);
    }
  });

  it('rejects with IpcTimeoutError when the handler exceeds 30s', async () => {
    vi.useFakeTimers();
    const deps = makeMockDeps();
    (deps.core.apply as Mock).mockReturnValue(new Promise<never>(() => {}));
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_APPLY)!;
    const promise = handler({}, { appId: 'workbuddy', themeId: 'dark' });
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});

describe('THEME_RESTORE regression', () => {
  it('dependency failure passes through original error (not wrapped as IpcTimeoutError)', async () => {
    const deps = makeMockDeps();
    (deps.core.restore as Mock).mockRejectedValue(new Error('core restore boom'));
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_RESTORE)!;
    await expect(handler({}, 'workbuddy')).rejects.toThrow('core restore boom');
    try {
      await handler({}, 'workbuddy');
    } catch (err) {
      expect(isIpcTimeoutError(err)).toBe(false);
    }
  });

  it('rejects with IpcTimeoutError when the handler exceeds 30s', async () => {
    vi.useFakeTimers();
    const deps = makeMockDeps();
    (deps.core.restore as Mock).mockReturnValue(new Promise<never>(() => {}));
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_RESTORE)!;
    const promise = handler({}, 'workbuddy');
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});

// THEME_APPLY / THEME_IMPORT 无 success-path 可附加断言，需独立测试

// ---------------------------------------------------------------------------
// RC-7: THEME_MANUAL_REGEN — catalog colors passthrough + IPC contract
// ---------------------------------------------------------------------------

describe('THEME_MANUAL_REGEN — colors passthrough (RC-7)', () => {
  it('passes catalog colors to regenerateTheme when available', async () => {
    const deps = makeMockDeps();
    const testColors = {
      accent: '#4a90d9',
      background: '#1e1e1e',
      foreground: '#e0e0e0',
      secondary: '#2d2d2d',
      muted: '#888888',
      surface: '#252525',
      border: '#404040',
      surfaceElevated: '#303030',
      codeBackground: '#1a1a1a',
      codeForeground: '#d4d4d4',
      inputBackground: '#2a2a2a',
      buttonBackground: '#3a3a3a',
      buttonForeground: '#ffffff',
      focusRing: '#5a9fd4',
    };
    (deps.themeCatalog.getTheme as Mock).mockResolvedValue({
      id: 'dark-theme',
      name: 'Dark',
      colors: testColors,
    });
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    const result = await handler({}, 'workbuddy', 'dark-theme');

    // Verify regenerateTheme was called with the catalog colors
    expect(capturedRegenArgs).toHaveLength(1);
    expect(capturedRegenArgs[0]!.agentId).toBe('workbuddy');
    expect(capturedRegenArgs[0]!.themeId).toBe('dark-theme');
    expect(capturedRegenArgs[0]!.colors).toEqual(testColors);
    // The handler awaits the thunk result
    expect(result).toEqual({ status: 'success', reason: 'mock regen ok' });
  });

  it('returns failure when catalog has no colors for the theme', async () => {
    const deps = makeMockDeps();
    // getTheme returns a theme entry without colors (legacy package)
    (deps.themeCatalog.getTheme as Mock).mockResolvedValue({
      id: 'legacy-theme',
      name: 'Legacy',
      // no `colors` field
    });
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    const result = await handler({}, 'qoderwork', 'legacy-theme');

    // Handler should have called regenerateTheme with undefined colors
    expect(capturedRegenArgs).toHaveLength(1);
    expect(capturedRegenArgs[0]!.colors).toBeUndefined();
    // The thunk returns the failure result
    expect(result).toEqual({ status: 'failed', reason: 'no colors available for regen' });
  });

  it('returns failure when catalog theme lookup returns null', async () => {
    const deps = makeMockDeps();
    (deps.themeCatalog.getTheme as Mock).mockResolvedValue(null);
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    const result = await handler({}, 'workbuddy', 'nonexistent-theme');

    expect(capturedRegenArgs[0]!.colors).toBeUndefined();
    expect(result).toEqual({ status: 'failed', reason: 'no colors available for regen' });
  });

  it('maintains the 2-argument IPC contract (agentId, themeId)', () => {
    const deps = makeMockDeps();
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    // Electron IPC handler signature: (_event, ...positionalArgs). The positional
    // args are (agentId, themeId) = 2 arguments. Plus the event parameter,
    // handler.length === 3 confirms the 2-arg IPC contract is preserved.
    expect(handler.length).toBe(3);
  });

  it('rejects invalid agentId before any catalog lookup', async () => {
    const deps = makeMockDeps();
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    await expect(handler({}, 123, 'dark-theme')).rejects.toThrow(getMainMessages().invalidAgentId);
    // regenerateTheme should NOT have been called (validation failed first)
    expect(capturedRegenArgs).toHaveLength(0);
  });

  it('rejects path-traversal themeId before any catalog lookup', async () => {
    const deps = makeMockDeps();
    registerThemeIpc(deps, updateTrayMenu);

    const handler = handlers.get(IpcChannel.THEME_MANUAL_REGEN)!;
    await expect(handler({}, 'workbuddy', '../etc/passwd')).rejects.toThrow(
      getMainMessages().invalidThemeId,
    );
    // regenerateTheme should NOT have been called (validation failed first)
    expect(capturedRegenArgs).toHaveLength(0);
  });
});
