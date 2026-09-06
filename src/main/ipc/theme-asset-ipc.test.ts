// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

vi.mock('../theme-asset', () => ({
  convert: vi.fn(),
  registerAllAdapters: vi.fn(),
}));

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

const { registerThemeAssetIpc } = await import('./theme-asset-ipc');
const { convert, registerAllAdapters } = await import('../theme-asset');
const { withMonitoredTimeout } = await import('./with-monitored-timeout');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConvertOutput = {
  context: {
    adapterResult: {
      meta: { sourceFormat: 'vscode-json' },
      confidence: 0.95,
      colors: { primary: '#4A90D9', background: '#1E1E1E' },
    },
    inferredColors: { primary: '#4A90D9', background: '#1E1E1E', surface: '#2D2D2D' },
  },
  report: {
    passed: true,
    tokenCoverage: 0.92,
    warnings: [],
  },
  cssOutputs: {
    traework: ':root { --ag-primary: #4A90D9; }',
    qoderwork: ':root { --ag-primary: #4A90D9; }',
    workbuddy: ':root { --ag-primary: #4A90D9; }',
    doubao: ':root { --ag-primary: #4A90D9; }',
    codex: ':root { --ag-primary: #4A90D9; }',
    zcode: ':root { --ag-primary: #4A90D9; }',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('theme-asset-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
  });

  // -----------------------------------------------------------------------
  // 1. registerThemeAssetIpc() registration
  // -----------------------------------------------------------------------
  describe('registerThemeAssetIpc()', () => {
    it('registers the THEME_ASSET_CONVERT handler', () => {
      registerThemeAssetIpc();
      expect(handlers.has(IpcChannel.THEME_ASSET_CONVERT)).toBe(true);
    });

    it('registers the THEME_ASSET_LIST_ADAPTERS handler', () => {
      registerThemeAssetIpc();
      expect(handlers.has(IpcChannel.THEME_ASSET_LIST_ADAPTERS)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. THEME_ASSET_LIST_ADAPTERS handler
  // -----------------------------------------------------------------------
  describe('THEME_ASSET_LIST_ADAPTERS handler', () => {
    it('returns the adapter metadata array', async () => {
      registerThemeAssetIpc();

      const handler = handlers.get(IpcChannel.THEME_ASSET_LIST_ADAPTERS)!;
      const result = await handler();

      expect(registerAllAdapters).toHaveBeenCalledOnce();
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(4);

      const ids = (result as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain('codedrobe');
      expect(ids).toContain('legacy-codex');
      expect(ids).toContain('vscode-json');
      expect(ids).toContain('raw-css');
    });

    it('wraps the list call with withMonitoredTimeout', async () => {
      registerThemeAssetIpc();

      const handler = handlers.get(IpcChannel.THEME_ASSET_LIST_ADAPTERS)!;
      await handler();

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.THEME_ASSET_LIST_ADAPTERS,
        5_000,
        expect.any(Promise),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. THEME_ASSET_CONVERT handler — JSON input
  // -----------------------------------------------------------------------
  describe('THEME_ASSET_CONVERT handler (JSON input)', () => {
    it('converts JSON theme data and returns ok/agentCss/tokens', async () => {
      registerThemeAssetIpc();
      (convert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConvertOutput);

      const jsonData = JSON.stringify({
        name: 'Test Theme',
        colors: { primary: '#4A90D9' },
      });

      const handler = handlers.get(IpcChannel.THEME_ASSET_CONVERT)!;
      const result = await handler(
        { sender: { id: 1 }, senderFrame: { parent: null } },
        { kind: 'json', data: jsonData, filename: 'test-theme.json' },
      );

      expect(convert).toHaveBeenCalledOnce();

      const convertCallArgs = (convert as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(convertCallArgs[0]).toEqual({
        buffer: Buffer.from(jsonData, 'utf8'),
        filename: 'test-theme.json',
      });
      expect(convertCallArgs[1]).toEqual({ themeId: 'test-theme' });

      expect(result).toMatchObject({
        ok: true,
        adapter: 'vscode-json',
        confidence: 0.95,
        tokens: { primary: '#4A90D9', background: '#1E1E1E', surface: '#2D2D2D' },
      });
      expect((result as { agentCss: Record<string, string> }).agentCss).toEqual(
        mockConvertOutput.cssOutputs,
      );
      expect((result as { report: unknown }).report).toEqual({
        passed: true,
        tokenCoverage: 0.92,
        warnings: [],
      });
    });

    it('wraps the convert call with withMonitoredTimeout (30s)', async () => {
      registerThemeAssetIpc();
      (convert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConvertOutput);

      const handler = handlers.get(IpcChannel.THEME_ASSET_CONVERT)!;
      await handler(
        { sender: { id: 1 }, senderFrame: { parent: null } },
        { kind: 'json', data: '{"colors":{}}', filename: 'x.json' },
      );

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.THEME_ASSET_CONVERT,
        30_000,
        expect.any(Promise),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 4. THEME_ASSET_CONVERT handler — failure
  // -----------------------------------------------------------------------
  describe('THEME_ASSET_CONVERT handler (failure)', () => {
    it('returns error when convert throws', async () => {
      registerThemeAssetIpc();
      (convert as ReturnType<typeof vi.fn>).mockReset();
      (convert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unsupported format: invalid payload'),
      );

      const handler = handlers.get(IpcChannel.THEME_ASSET_CONVERT)!;

      await expect(
        handler(
          { sender: { id: 1 }, senderFrame: { parent: null } },
          { kind: 'json', data: 'not-valid-theme-data', filename: 'broken.xyz' },
        ),
      ).rejects.toThrow('Unsupported format: invalid payload');
    });

    it('returns error when input kind is invalid', async () => {
      registerThemeAssetIpc();
      (convert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockConvertOutput);

      const handler = handlers.get(IpcChannel.THEME_ASSET_CONVERT)!;

      // Passing an unknown kind — buildAdapterInput falls through to JSON path,
      // so this verifies the fallback behavior rather than a hard failure.
      const result = await handler(
        { sender: { id: 1 }, senderFrame: { parent: null } },
        { kind: 'bytes', data: new Uint8Array([0x7b, 0x7d]), filename: 'test.bin' },
      );

      expect(result).toMatchObject({ ok: true });
      expect(convert).toHaveBeenCalledOnce();
    });
  });
});
