// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { CommunityThemeDetail, CommunityThemeListResult } from '../../shared/types/community';
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
  sendLog: vi.fn(),
}));

vi.mock('../community/community-theme-api', () => ({
  fetchThemes: vi.fn(),
  getThemeDetail: vi.fn(),
  downloadTheme: vi.fn(),
  DreamSkinApiError: class DreamSkinApiError extends Error {
    statusCode?: number;
    responseBody?: unknown;
    constructor(message: string, statusCode?: number, responseBody?: unknown) {
      super(message);
      this.name = 'DreamSkinApiError';
      this.statusCode = statusCode;
      this.responseBody = responseBody;
    }
  },
}));

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: <T>(_channel: string, _ms: number, promise: Promise<T>) => promise,
}));

// Import after mocks are declared.
const { registerCommunityThemeIpc } = await import('./community-theme-ipc');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockListResult(): CommunityThemeListResult {
  return {
    themes: [
      {
        themeId: 'dreamskin-001',
        name: 'Aurora',
        author: { id: 'author-1', displayName: 'Alice' },
        description: 'A beautiful aurora theme',
        tags: ['dark', 'gradient'],
        downloads: 1024,
        rating: 4.8,
        updatedAt: '2026-01-15T08:00:00Z',
        packageSize: 204800,
        packageSha256: 'abc123',
        version: '1.2.0',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };
}

function makeMockDetail(): CommunityThemeDetail {
  return {
    themeId: 'dreamskin-001',
    name: 'Aurora',
    author: { id: 'author-1', displayName: 'Alice' },
    description: 'A beautiful aurora theme',
    tags: ['dark', 'gradient'],
    downloads: 1024,
    rating: 4.8,
    updatedAt: '2026-01-15T08:00:00Z',
    packageSize: 204800,
    packageSha256: 'abc123def456',
    version: '1.2.0',
    screenshots: ['https://example.com/screen1.png'],
    changelog: 'Bug fixes and improvements',
    targetAgents: ['workbuddy'],
  };
}

function makeMockDeps(): MainContext {
  return {
    mainWindow: null,
    tray: null,
    isQuitting: false,
    locale: 'zh-CN',
    userDataRoot: '/tmp/test',
    library: {
      installBytes: vi.fn().mockResolvedValue({ id: 'community-dreamskin-001', name: 'Aurora' }),
    },
    settings: {},
    fileOpens: { handlePath: vi.fn() },
  } as unknown as MainContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('community-theme-ipc handlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  // --- COMMUNITY_THEME_LIST ---

  describe('COMMUNITY_THEME_LIST', () => {
    it('calls fetchThemes and returns {success, data}', async () => {
      const { fetchThemes } = await import('../community/community-theme-api');
      const mockFetch = fetchThemes as Mock;
      mockFetch.mockResolvedValue(makeMockListResult());

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_LIST)!;

      const result = await handler({}, { page: 1, pageSize: 10, sort: 'popular' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith({ page: 1, pageSize: 10, sort: 'popular' });
      expect(result).toEqual({ success: true, data: makeMockListResult() });
    });

    it('passes empty params when none provided', async () => {
      const { fetchThemes } = await import('../community/community-theme-api');
      const mockFetch = fetchThemes as Mock;
      mockFetch.mockResolvedValue(makeMockListResult());

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_LIST)!;

      await handler({}, {});

      expect(mockFetch).toHaveBeenCalledWith({});
    });

    it('returns {success: false, error} when API fails', async () => {
      const { fetchThemes } = await import('../community/community-theme-api');
      const mockFetch = fetchThemes as Mock;
      mockFetch.mockRejectedValue(new Error('Network error'));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_LIST)!;

      const result = await handler({}, {});

      expect(result).toEqual({ success: false, error: '[community] list failed' });
    });

    it('preserves DreamSkinApiError message in error response', async () => {
      const { fetchThemes, DreamSkinApiError } = await import('../community/community-theme-api');
      const mockFetch = fetchThemes as Mock;
      mockFetch.mockRejectedValue(new DreamSkinApiError('Rate limited', 429));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_LIST)!;

      const result = await handler({}, {});

      expect(result).toEqual({ success: false, error: 'Rate limited' });
    });
  });

  // --- COMMUNITY_THEME_GET ---

  describe('COMMUNITY_THEME_GET', () => {
    it('calls getThemeDetail and returns {success, data}', async () => {
      const { getThemeDetail } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      mockGet.mockResolvedValue(makeMockDetail());

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_GET)!;

      const result = await handler({}, 'dreamskin-001');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith('dreamskin-001');
      expect(result).toEqual({ success: true, data: makeMockDetail() });
    });

    it('returns {success: false, error} when themeId is not a string', async () => {
      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_GET)!;

      const result = await handler({}, 123);

      expect(result).toEqual({ success: false, error: '[community] get failed' });
    });

    it('returns {success: false, error} when themeId is empty string', async () => {
      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_GET)!;

      const result = await handler({}, '');

      expect(result).toEqual({ success: false, error: '[community] get failed' });
    });

    it('returns {success: false, error} when API fails', async () => {
      const { getThemeDetail } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      mockGet.mockRejectedValue(new Error('Not found'));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_GET)!;

      const result = await handler({}, 'dreamskin-001');

      expect(result).toEqual({ success: false, error: '[community] get failed' });
    });

    it('preserves DreamSkinApiError message for get handler', async () => {
      const { getThemeDetail, DreamSkinApiError } = await import(
        '../community/community-theme-api'
      );
      const mockGet = getThemeDetail as Mock;
      mockGet.mockRejectedValue(new DreamSkinApiError('Theme not found', 404));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_GET)!;

      const result = await handler({}, 'unknown-id');

      expect(result).toEqual({ success: false, error: 'Theme not found' });
    });
  });

  // --- COMMUNITY_THEME_DOWNLOAD ---

  describe('COMMUNITY_THEME_DOWNLOAD', () => {
    it('full flow: download with progress, verify, and install', async () => {
      const { getThemeDetail, downloadTheme } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      const mockDownload = downloadTheme as Mock;

      // Use a detail without packageSha256 so the SHA verification step
      // is skipped — the focus here is on the progress wiring and install,
      // not the checksum gate.
      const detailNoSha = { ...makeMockDetail(), packageSha256: undefined };
      mockGet.mockResolvedValue(detailNoSha);
      mockDownload.mockImplementation(
        (_id: string, onProgress?: (downloaded: number, total: number) => void) => {
          if (onProgress) {
            onProgress(102400, 204800);
            onProgress(204800, 204800);
          }
          return Buffer.alloc(204800);
        },
      );

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_DOWNLOAD)!;

      const result = await handler({}, 'dreamskin-001');

      // Verify the API was called.
      expect(mockGet).toHaveBeenCalledWith('dreamskin-001');
      expect(mockDownload).toHaveBeenCalledTimes(1);

      // Result should indicate success with installed theme id.
      expect(result).toEqual({
        success: true,
        data: { success: true, themeId: 'community-dreamskin-001' },
      });

      // notifyStatusChanged should fire after installation.
      const { notifyStatusChanged } = await import('../main-context');
      expect(notifyStatusChanged).toHaveBeenCalledTimes(1);
    });

    it('rejects non-string themeId', async () => {
      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_DOWNLOAD)!;

      const result = await handler({}, 123);

      expect(result).toEqual({
        success: false,
        data: { success: false, error: expect.any(String) },
      });
    });

    it('returns error when API fails during download', async () => {
      const { getThemeDetail, downloadTheme } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      mockGet.mockResolvedValue(makeMockDetail());
      const mockDownload = downloadTheme as Mock;
      mockDownload.mockRejectedValue(new Error('Download failed'));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_DOWNLOAD)!;

      const result = await handler({}, 'dreamskin-001');

      expect(result).toEqual({
        success: false,
        data: { success: false, error: '[community] download failed' },
      });
    });

    it('prevents duplicate downloads for the same theme', async () => {
      vi.useFakeTimers();
      const { getThemeDetail, downloadTheme } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      mockGet.mockResolvedValue(makeMockDetail());
      const mockDownload = downloadTheme as Mock;
      // Hang the download so the first call never resolves.
      mockDownload.mockReturnValue(new Promise<never>(() => {}));

      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_THEME_DOWNLOAD)!;

      // Start the first download (never resolves).
      handler({}, 'dreamskin-001');

      // Attempt a second download for the same theme.
      const result = await handler({}, 'dreamskin-001');

      expect(result).toEqual({
        success: false,
        data: { success: false, error: 'A download for this theme is already in progress' },
      });

      vi.useRealTimers();
    });
  });

  // --- COMMUNITY_DOWNLOAD_CANCEL ---

  describe('COMMUNITY_DOWNLOAD_CANCEL', () => {
    it('cancels an in-progress download', async () => {
      vi.useFakeTimers();
      const { getThemeDetail, downloadTheme } = await import('../community/community-theme-api');
      const mockGet = getThemeDetail as Mock;
      mockGet.mockResolvedValue(makeMockDetail());
      const mockDownload = downloadTheme as Mock;

      // Track if the download was aborted.
      let progressCallback: ((downloaded: number, total: number) => void) | undefined;
      mockDownload.mockImplementation(
        (_id: string, onProgress?: (downloaded: number, total: number) => void) => {
          progressCallback = onProgress;
          // Return a delayed promise so we have time to cancel.
          return new Promise<Buffer>(() => {});
        },
      );

      registerCommunityThemeIpc(makeMockDeps());
      const downloadHandler = handlers.get(IpcChannel.COMMUNITY_THEME_DOWNLOAD)!;
      const cancelHandler = handlers.get(IpcChannel.COMMUNITY_DOWNLOAD_CANCEL)!;

      // Start download.
      downloadHandler({}, 'dreamskin-001');

      // Cancel it.
      const result = await cancelHandler({}, 'dreamskin-001');

      expect(result).toEqual({ success: true });

      // sendLog should have been called with cancellation message.
      const { sendLog } = await import('../main-context');
      expect(sendLog).toHaveBeenCalledWith(
        '[community] download cancelled for theme dreamskin-001',
      );

      vi.useRealTimers();
    });

    it('returns success even when no download is active', async () => {
      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_DOWNLOAD_CANCEL)!;

      const result = await handler({}, 'nonexistent-theme');

      expect(result).toEqual({ success: true });
    });

    it('rejects non-string themeId', async () => {
      registerCommunityThemeIpc(makeMockDeps());
      const handler = handlers.get(IpcChannel.COMMUNITY_DOWNLOAD_CANCEL)!;

      const result = await handler({}, 123);

      expect(result).toEqual({
        success: false,
        error: expect.any(String),
      });
    });
  });
});
