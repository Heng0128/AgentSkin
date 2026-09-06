// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import type { QuickApplyTokens } from '../../shared/types/ipc';
import type { MainContext } from '../main-context';
import type { PixelData } from '../profile/image-analyzer';
import type { QuickApplyDeps } from '../quick-apply/quick-apply-engine';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => createElectronMock(handlers));

// Mock the production deps wiring so the IPC test doesn't depend on
// filesystem or nativeImage (which is minimally mocked by the electron fixture).
vi.mock('../quick-apply/quick-apply-deps', () => ({
  createQuickApplyDeps: vi.fn(
    (ctx: MainContext, onProgress?: QuickApplyDeps['onProgress']): QuickApplyDeps => ({
      decodeImage: vi.fn(async (): Promise<PixelData> => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 15;
          data[i + 1] = 20;
          data[i + 2] = 30;
          data[i + 3] = 255;
        }
        return { data, width: 4, height: 4 };
      }),
      extractTokens: vi.fn(
        (): QuickApplyTokens => ({
          accent: '#7AA2F7',
          accentMuted: '#5A7FD4',
          secondary: '#9ECE6A',
          background: '#0F1419',
          foreground: '#E6EDF3',
          muted: '#8B949E',
          surface: '#161B22',
          surfaceElevated: '#21262D',
          border: '#7AA2F72E',
          codeBackground: '#0D1117',
          codeForeground: '#E6EDF3',
          inputBackground: '#21262D',
          buttonBackground: '#7AA2F733',
          buttonForeground: '#E6EDF3',
          focusRing: '#7AA2F799',
        }),
      ),
      analyzePixels: vi.fn(() => ({
        dominantColors: ['#7AA2F7', '#0F1419'],
        safeArea: 'left' as const,
        mode: 'dark' as const,
        averageLuminance: 0.1,
      })),
      installTheme: vi.fn(async (): Promise<string> => 'qa-test'),
      applyTheme: vi.fn(async () => ({ status: 'applied' as const, message: 'ok' })),
      restoreAgent: vi.fn(async () => {}),
      onProgress,
    }),
  ),
  decodeImageProduction: vi.fn(),
  extractTokensProduction: vi.fn(),
  analyzePixelsProduction: vi.fn(),
}));

// Import after mocks are declared.
const { registerQuickApplyIpc } = await import('./quick-apply-ipc');
const { IpcChannel } = await import('../../shared/ipc-channels');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockDeps(): MainContext {
  // We still need a ctx object, but createQuickApplyDeps is mocked so
  // library/core won't be called during submit — only via the mock.
  return {
    mainWindow: null,
    tray: null,
    isQuitting: false,
    locale: 'zh-CN',
    userDataRoot: '/tmp/test',
    library: {} as MainContext['library'],
    themeCatalog: {} as MainContext['themeCatalog'],
    core: {
      apply: vi.fn().mockResolvedValue({
        status: 'applied',
        message: 'ok',
        system: { apps: [], platform: 'win32' },
      }),
      restore: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
      status: vi.fn().mockResolvedValue({ apps: [], platform: 'win32' }),
    },
    settings: {} as MainContext['settings'],
    wallpapers: null,
    agentCatalog: {} as MainContext['agentCatalog'],
    fileOpens: { handlePath: vi.fn() } as unknown as MainContext['fileOpens'],
  } as unknown as MainContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quick-apply-ipc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  describe('QUICK_APPLY_SUBMIT', () => {
    it('registers the handler', () => {
      registerQuickApplyIpc(makeMockDeps());
      expect(handlers.has(IpcChannel.QUICK_APPLY_SUBMIT)).toBe(true);
    });

    it('returns success for valid request', async () => {
      registerQuickApplyIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.QUICK_APPLY_SUBMIT)!;

      const result = (await handler(
        {},
        { imagePath: '/test/wallpaper.png', targetAppId: 'codex' },
      )) as { success: boolean; themeId?: string };

      expect(result.success).toBe(true);
      expect(result.themeId).toBe('qa-test');
    });

    it('rejects request with missing targetAppId', async () => {
      registerQuickApplyIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.QUICK_APPLY_SUBMIT)!;

      const result = (await handler({}, { imagePath: '/test/img.png' })) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing targetAppId');
    });

    it('returns failure when apply returns non-applied status', async () => {
      // Re-register with deps whose applyTheme returns requires-restart.
      const { createQuickApplyDeps } = await import('../quick-apply/quick-apply-deps');
      vi.mocked(createQuickApplyDeps).mockReturnValueOnce({
        decodeImage: vi.fn(
          async (): Promise<PixelData> => ({
            data: new Uint8ClampedArray(64),
            width: 4,
            height: 4,
          }),
        ),
        extractTokens: vi.fn((): QuickApplyTokens => ({ accent: '#7AA2F7' })),
        analyzePixels: vi.fn(() => ({
          dominantColors: [],
          safeArea: 'left' as const,
          mode: 'dark' as const,
          averageLuminance: 0.1,
        })),
        installTheme: vi.fn(async () => 'qa-test'),
        applyTheme: vi.fn(async () => ({
          status: 'requires-restart' as const,
          message: 'App not running',
        })),
        restoreAgent: vi.fn(async () => {}),
      });

      registerQuickApplyIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.QUICK_APPLY_SUBMIT)!;

      const result = (await handler({}, { imagePath: '/test/img.png', targetAppId: 'codex' })) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain('App not running');
    });
  });

  describe('QUICK_APPLY_UNDO', () => {
    it('registers the handler', () => {
      registerQuickApplyIpc(makeMockDeps());
      expect(handlers.has(IpcChannel.QUICK_APPLY_UNDO)).toBe(true);
    });

    it('returns success for valid appId', async () => {
      registerQuickApplyIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.QUICK_APPLY_UNDO)!;

      const result = (await handler({}, 'codex')) as { success: boolean };

      expect(result.success).toBe(true);
    });

    it('rejects invalid appId', async () => {
      registerQuickApplyIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.QUICK_APPLY_UNDO)!;

      await expect(handler({}, 'invalid-app-id')).rejects.toThrow();
    });
  });
});
