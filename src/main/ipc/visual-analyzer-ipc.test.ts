// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/app-root'),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('node:fs', () => ({
  default: { existsSync: (...args: unknown[]) => mockExistsSync(...args) },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: (...args: unknown[]) => mockReaddir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

const { registerVisualAnalyzerIpc } = await import('./visual-analyzer-ipc');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('visual-analyzer-ipc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    registerVisualAnalyzerIpc();
  });

  describe('VISUAL_ANALYSIS_LIST', () => {
    it('returns known agent ids from profile file names, sorted and deduped', async () => {
      mockReaddir.mockResolvedValue([
        'zcode-profile.json',
        'codex-profile.json',
        'traework-profile.json',
        '_profiles-summary.json', // non-profile file — ignored
        'not-an-agent-profile.json', // unknown agent id — ignored
        'codex-profile.json', // duplicate — deduped
      ]);
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_LIST);
      expect(result).toEqual(['codex', 'traework', 'zcode']);
    });

    it('returns an empty list when the profiles directory is unreadable', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_LIST);
      expect(result).toEqual([]);
    });
  });

  describe('VISUAL_ANALYSIS_GET', () => {
    it('returns the parsed profile for a valid agent id', async () => {
      const profile = { meta: { agent: 'zcode' }, tokens: { light: { varCount: 42 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(profile));
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_GET, 'zcode');
      expect(result).toEqual(profile);
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('zcode-profile.json'),
        'utf8',
      );
    });

    it('rejects path-traversal-style ids by returning null without reading', async () => {
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_GET, '../etc/passwd');
      expect(result).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns null for unknown agent ids', async () => {
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_GET, 'not-a-real-agent');
      expect(result).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns null when the profile file is missing or corrupt', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      expect(await invoke(IpcChannel.VISUAL_ANALYSIS_GET, 'zcode')).toBeNull();
      expect(mockReadFile).toHaveBeenCalled();
      mockReadFile.mockClear();
      mockReadFile.mockResolvedValue('{not-json');
      expect(await invoke(IpcChannel.VISUAL_ANALYSIS_GET, 'zcode')).toBeNull();
      expect(mockReadFile).toHaveBeenCalled();
    });

    it('returns null for non-string agent names', async () => {
      expect(await invoke(IpcChannel.VISUAL_ANALYSIS_GET, null)).toBeNull();
      expect(await invoke(IpcChannel.VISUAL_ANALYSIS_GET, 42)).toBeNull();
    });
  });

  describe('visual analysis — detect / extract / export', () => {
    it('DETECT reports not-running', async () => {
      const result = (await invoke(IpcChannel.VISUAL_ANALYSIS_DETECT, 'zcode')) as {
        running: boolean;
        port?: number;
        title?: string;
      };
      expect(result).toEqual({ running: false, port: undefined, title: undefined });
    });

    it('CDP_EXTRACT reports not implemented', async () => {
      const result = (await invoke(IpcChannel.VISUAL_ANALYSIS_CDP_EXTRACT, 'zcode')) as {
        ok: boolean;
        message: string;
      };
      expect(result.ok).toBe(false);
      expect(typeof result.message).toBe('string');
    });

    it('EXPORT_THEME refuses an empty palette', async () => {
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME, 'zcode', {});
      expect(result).toEqual({ ok: false, path: undefined });
    });

    it('EXPORT_THEME refuses a non-empty payload without --agentskin-* tokens', async () => {
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME, 'zcode', {
        root: { background: '#000000' },
      });
      expect(result).toEqual({ ok: false, path: undefined });
    });

    it('EXPORT_THEME fails gracefully when the package builder is unavailable', async () => {
      // A valid palette is supplied, but the dynamic import of
      // scripts/build-theme-package.mjs cannot resolve in the test env
      // (app.getAppPath() resolves to /app-root), so the handler must return
      // { ok: false } instead of throwing.
      const result = await invoke(IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME, 'zcode', {
        root: { '--agentskin-bg': '#201a40' },
      });
      expect(result).toEqual({ ok: false, path: undefined });
    });
  });
});
