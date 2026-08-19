// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../logger', () => ({
  mainWarn: vi.fn(),
}));

vi.mock('../services/tweak-injector', () => ({
  resolveSessionForPort: vi.fn().mockResolvedValue(null),
  pushTweak: vi.fn(),
  resetTweak: vi.fn(),
  saveTweakAsCustomCss: vi.fn(),
}));

vi.mock('../cdp/css-service', () => ({
  listStyleSheets: vi.fn().mockResolvedValue([]),
  getStyleSheetText: vi.fn().mockResolvedValue(''),
}));

vi.mock('../cdp/injection/shared', () => ({
  injectCssLayer: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../shared/safe-css', () => ({
  sanitizeCSS: vi.fn().mockReturnValue({
    clean: '',
    blocked: false,
    reasons: [],
  }),
}));

vi.mock('../cdp/selector-validator', () => ({
  probeSelector: vi.fn(),
  validateSelectors: vi.fn(),
}));

const { registerCoreIpc } = await import('./core-ipc');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockSession() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue('{}'),
    close: vi.fn(),
  };
}

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

describe('css-ipc handlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerCoreIpc(makeMockDeps(), updateTrayMenu);
  });

  describe('CSS_LIST', () => {
    it('rejects when port is not a valid number', async () => {
      const handler = handlers.get(IpcChannel.CSS_LIST)!;
      await expect(handler({}, 'abc')).rejects.toThrow('invalid port');
      await expect(handler({}, -1)).rejects.toThrow('invalid port');
      await expect(handler({}, 0)).rejects.toThrow('invalid port');
      await expect(handler({}, 70000)).rejects.toThrow('invalid port');
    });

    it('returns empty array when no CDP session on port', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      vi.mocked(resolveSessionForPort).mockResolvedValue(null);

      const handler = handlers.get(IpcChannel.CSS_LIST)!;
      const result = await handler({}, 9222);
      expect(result).toEqual([]);
    });

    it('returns stylesheet list when session is valid', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { listStyleSheets } = await import('../cdp/css-service');
      const mockSession = makeMockSession();
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      const sheets = [
        {
          styleSheetId: 'sheet-index-0',
          url: 'http://example.com/a.css',
          disabled: false,
          isInline: false,
          sourceURL: 'http://example.com/a.css',
          length: '100',
          label: 'a.css',
        },
      ];
      vi.mocked(listStyleSheets).mockResolvedValue(sheets);

      const handler = handlers.get(IpcChannel.CSS_LIST)!;
      const result = await handler({}, 9222);
      expect(result).toEqual(sheets);
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });

  describe('CSS_GET_TEXT', () => {
    it('rejects when styleSheetId does not start with sheet-index-', async () => {
      const handler = handlers.get(IpcChannel.CSS_GET_TEXT)!;
      await expect(handler({}, 9222, 'invalid-id')).rejects.toThrow('invalid styleSheetId');
      await expect(handler({}, 9222, 123)).rejects.toThrow('invalid styleSheetId');
    });

    it('returns empty string when no CDP session on port', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      vi.mocked(resolveSessionForPort).mockResolvedValue(null);

      const handler = handlers.get(IpcChannel.CSS_GET_TEXT)!;
      const result = await handler({}, 9222, 'sheet-index-0');
      expect(result).toBe('');
    });

    it('returns CSS text when session and styleSheetId are valid', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { getStyleSheetText } = await import('../cdp/css-service');
      const mockSession = makeMockSession();
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(getStyleSheetText).mockResolvedValue('body { color: red; }');

      const handler = handlers.get(IpcChannel.CSS_GET_TEXT)!;
      const result = await handler({}, 9222, 'sheet-index-0');
      expect(result).toBe('body { color: red; }');
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });

  describe('CSS_APPLY_EDIT', () => {
    it('rejects when port is invalid', async () => {
      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      await expect(handler({}, 'abc', 'agent1', 'body{}')).rejects.toThrow('invalid port');
    });

    it('rejects when agentId is not a string', async () => {
      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      await expect(handler({}, 9222, 123, 'body{}')).rejects.toThrow('invalid agentId');
    });

    it('rejects when css is not a string', async () => {
      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      await expect(handler({}, 9222, 'agent1', 123)).rejects.toThrow('css must be a string');
    });

    it('returns ok:false when sanitizeCSS blocks all content', async () => {
      const { sanitizeCSS } = await import('../../shared/safe-css');
      vi.mocked(sanitizeCSS).mockReturnValue({
        clean: '',
        blocked: true,
        reasons: ['@import blocked'],
      });

      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      const result = await handler({}, 9222, 'agent1', '@import url("evil.css");');
      expect(result).toEqual({ ok: false, error: 'CSS blocked: @import blocked' });
    });

    it('returns ok:false when no CDP session on port', async () => {
      const { sanitizeCSS } = await import('../../shared/safe-css');
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      vi.mocked(sanitizeCSS).mockReturnValue({
        clean: 'body{color:red}',
        blocked: false,
        reasons: [],
      });
      vi.mocked(resolveSessionForPort).mockResolvedValue(null);

      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      const result = await handler({}, 9222, 'agent1', 'body{color:red}');
      expect(result).toEqual({ ok: false, error: 'no_cdp_session' });
    });

    it('returns ok:true when injection succeeds', async () => {
      const { sanitizeCSS } = await import('../../shared/safe-css');
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { injectCssLayer } = await import('../cdp/injection/shared');
      const mockSession = makeMockSession();
      vi.mocked(sanitizeCSS).mockReturnValue({
        clean: 'body{color:red}',
        blocked: false,
        reasons: [],
      });
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(injectCssLayer).mockResolvedValue(true);

      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      const result = await handler({}, 9222, 'agent1', 'body{color:red}');
      expect(result).toEqual({ ok: true });
      expect(mockSession.close).toHaveBeenCalledOnce();
    });

    it('returns ok:false when injection fails', async () => {
      const { sanitizeCSS } = await import('../../shared/safe-css');
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { injectCssLayer } = await import('../cdp/injection/shared');
      const mockSession = makeMockSession();
      vi.mocked(sanitizeCSS).mockReturnValue({
        clean: 'body{color:red}',
        blocked: false,
        reasons: [],
      });
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(injectCssLayer).mockResolvedValue(false);

      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      const result = await handler({}, 9222, 'agent1', 'body{color:red}');
      expect(result).toEqual({ ok: false, error: 'inject_failed' });
      expect(mockSession.close).toHaveBeenCalledOnce();
    });

    it('returns ok:false with error message when injection throws', async () => {
      const { sanitizeCSS } = await import('../../shared/safe-css');
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { injectCssLayer } = await import('../cdp/injection/shared');
      const mockSession = makeMockSession();
      vi.mocked(sanitizeCSS).mockReturnValue({
        clean: 'body{color:red}',
        blocked: false,
        reasons: [],
      });
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(injectCssLayer).mockRejectedValue(new Error('CDP timeout'));

      const handler = handlers.get(IpcChannel.CSS_APPLY_EDIT)!;
      const result = await handler({}, 9222, 'agent1', 'body{color:red}');
      expect(result).toEqual({ ok: false, error: 'CDP timeout' });
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });

  describe('SELECTOR_PROBE', () => {
    it('returns probeSelector result with valid port and selector', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { probeSelector } = await import('../cdp/selector-validator');
      const mockSession = makeMockSession();
      const probeResult = { selector: '.panel', kind: 'hit' as const, count: 3 };
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(probeSelector).mockResolvedValue(probeResult);

      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      const result = await handler({}, 9222, '.panel');
      expect(result).toEqual(probeResult);
      expect(mockSession.close).toHaveBeenCalledOnce();
    });

    it('rejects when port is not a valid number', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      await expect(handler({}, 'abc')).rejects.toThrow('invalid port');
      await expect(handler({}, -1)).rejects.toThrow('invalid port');
      await expect(handler({}, 70000)).rejects.toThrow('invalid port');
    });

    it('rejects NaN / Infinity / float port', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      await expect(handler({}, NaN)).rejects.toThrow('invalid port');
      await expect(handler({}, Infinity)).rejects.toThrow('invalid port');
      await expect(handler({}, -Infinity)).rejects.toThrow('invalid port');
      await expect(handler({}, 8080.5)).rejects.toThrow('invalid port');
    });

    it('rejects when selector is empty or not a string', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      await expect(handler({}, 9222, '')).rejects.toThrow('selector must be a non-empty string');
      await expect(handler({}, 9222, 123)).rejects.toThrow('selector must be a non-empty string');
    });

    it('returns timeout result when no CDP session on port', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      vi.mocked(resolveSessionForPort).mockResolvedValue(null);

      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      const result = await handler({}, 9222, '.panel');
      expect(result).toEqual({ selector: '.panel', kind: 'timeout', count: 0 });
    });

    it('rejects and closes session when probeSelector throws', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { probeSelector } = await import('../cdp/selector-validator');
      const mockSession = makeMockSession();
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(probeSelector).mockRejectedValue(new Error('CDP evaluate failed'));

      const handler = handlers.get(IpcChannel.SELECTOR_PROBE)!;
      await expect(handler({}, 9222, '.panel')).rejects.toThrow('CDP evaluate failed');
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });

  describe('SELECTOR_VALIDATE', () => {
    it('returns full report when session and inputs are valid', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { validateSelectors } = await import('../cdp/selector-validator');
      const mockSession = makeMockSession();
      const report = {
        agentId: 'traework',
        results: [
          { selector: '.a', kind: 'hit' as const, count: 1 },
          { selector: '.b', kind: 'miss' as const, count: 0 },
        ],
        summary: { total: 2, hit: 1, miss: 1, invalid: 0, timeout: 0 },
        timestamp: 1234567890,
      };
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(validateSelectors).mockResolvedValue(report);

      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      const result = await handler({}, 9222, 'traework', ['.a', '.b']);
      expect(result).toEqual(report);
      expect(mockSession.close).toHaveBeenCalledOnce();
    });

    it('rejects when port is not a valid number', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      await expect(handler({}, -1, 'agent1', ['.a'])).rejects.toThrow('invalid port');
      await expect(handler({}, 70000, 'agent1', ['.a'])).rejects.toThrow('invalid port');
    });

    it('rejects NaN / Infinity / float port', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      await expect(handler({}, NaN, 'agent1', ['.a'])).rejects.toThrow('invalid port');
      await expect(handler({}, Infinity, 'agent1', ['.a'])).rejects.toThrow('invalid port');
      await expect(handler({}, -Infinity, 'agent1', ['.a'])).rejects.toThrow('invalid port');
      await expect(handler({}, 8080.5, 'agent1', ['.a'])).rejects.toThrow('invalid port');
    });

    it('rejects when agentId is not a string', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      await expect(handler({}, 9222, 123, ['.a'])).rejects.toThrow('invalid agentId');
    });

    it('rejects when selectors is not an array of strings', async () => {
      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      await expect(handler({}, 9222, 'agent1', 'not-array')).rejects.toThrow(
        'selectors must be an array of strings',
      );
      await expect(handler({}, 9222, 'agent1', [123])).rejects.toThrow(
        'selectors must be an array of strings',
      );
    });

    it('returns all-timeout report when no CDP session', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      vi.mocked(resolveSessionForPort).mockResolvedValue(null);

      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      const result = await handler({}, 9222, 'agent1', ['.a', '.b']);
      expect(result.summary.total).toBe(2);
      expect(result.summary.timeout).toBe(2);
      expect(result.agentId).toBe('agent1');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].kind).toBe('timeout');
    });

    it('returns empty report when selectors is empty array', async () => {
      const { resolveSessionForPort } = await import('../services/tweak-injector');
      const { validateSelectors } = await import('../cdp/selector-validator');
      const mockSession = makeMockSession();
      vi.mocked(resolveSessionForPort).mockResolvedValue(
        mockSession as unknown as ReturnType<typeof makeMockSession>,
      );
      vi.mocked(validateSelectors).mockResolvedValue({
        agentId: 'agent1',
        results: [],
        summary: { total: 0, hit: 0, miss: 0, invalid: 0, timeout: 0 },
        timestamp: 1234567890,
      });

      const handler = handlers.get(IpcChannel.SELECTOR_VALIDATE)!;
      const result = await handler({}, 9222, 'agent1', []);
      expect(result.summary.total).toBe(0);
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });
});
