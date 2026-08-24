// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks (module-level, persistent across vi.resetModules)
// ---------------------------------------------------------------------------

const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('electron', () => createElectronMock(new Map()));
vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));
vi.mock('node:fs/promises', () => ({
  default: { readdir: vi.fn(), readFile: vi.fn() },
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-register the IPC handler in a fresh module context.
 * `vi.resetModules()` clears the summariesCache so each test starts clean.
 */
async function registerFresh(): Promise<Map<string, (...args: unknown[]) => unknown>> {
  vi.resetModules();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  // Re-mock electron with a fresh handlers map for this test.
  vi.doMock('electron', () => createElectronMock(handlers));
  const mod = await import('./visual-analyzer-ipc');
  mod.registerVisualAnalyzerIpc();
  return handlers;
}

function invoke(
  handlers: Map<string, (...args: unknown[]) => unknown>,
  channel: string,
  ...args: unknown[]
) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildVisualAnalysisSummaries (via VISUAL_ANALYSIS_LIST_SUMMARY)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns an empty array when _profiles-summary.json is missing', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toEqual([]);
  });

  it('returns an empty array when _profiles-summary.json has no profiles', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockReturnValue(JSON.stringify({ profiles: {} }));
    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toEqual([]);
  });

  it('filters out unknown agent ids from the summary', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        profiles: {
          'not-a-real-agent': { tokensLight: 100, tokensDark: 100 },
        },
      }),
    );
    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toEqual([]);
  });

  it('maps known agent id to a summary with correct field extraction', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_profiles-summary.json')) {
        return JSON.stringify({
          profiles: {
            zcode: {
              tokensLight: 1246,
              tokensDark: 1255,
              categories: ['buttons', 'inputs'],
              stats: {
                rootVars: { default: 42, dark: 20, light: 22 },
                domNodes: { default: 350, dark: 180, light: 170 },
                styleVars: { dark: 88, light: 90, neutral: 12 },
                computedSamples: { default: 200, dark: 100, light: 100 },
              },
            },
          },
        });
      }
      if (filePath.includes('zcode-profile.json')) {
        return JSON.stringify({
          tokens: { core: { dark: { accent: '#4f46e5' }, light: { accent: '#6366f1' } } },
        });
      }
      throw new Error(`unexpected readFileSync: ${filePath}`);
    });

    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'zcode',
      tokensLight: 1246,
      tokensDark: 1255,
      categories: ['buttons', 'inputs'],
      stats: {
        rootVars: { default: 42, dark: 20, light: 22 },
        domNodes: { default: 350, dark: 180, light: 170 },
        styleVars: { dark: 88, light: 90, neutral: 12 },
        computedSamples: { default: 200, dark: 100, light: 100 },
      },
      brandDark: '#4f46e5',
      brandLight: '#6366f1',
    });
  });

  it('falls back to stats-only when per-agent profile is missing', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_profiles-summary.json')) {
        return JSON.stringify({
          profiles: {
            codex: { tokensLight: 500, tokensDark: 510, categories: ['editor'] },
          },
        });
      }
      if (filePath.includes('codex-profile.json')) {
        throw new Error('ENOENT');
      }
      throw new Error(`unexpected readFileSync: ${filePath}`);
    });

    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('codex');
    expect(result[0].brandDark).toBeUndefined();
    expect(result[0].brandLight).toBeUndefined();
    expect(result[0].stats.rootVars).toEqual({ default: 0, dark: 0, light: 0 });
  });

  it('returns summaries sorted by agent id', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_profiles-summary.json')) {
        return JSON.stringify({
          profiles: {
            zcode: { tokensLight: 100, tokensDark: 100 },
            codex: { tokensLight: 200, tokensDark: 200 },
            traework: { tokensLight: 300, tokensDark: 300 },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result.map((s) => s.id)).toEqual(['codex', 'traework', 'zcode']);
  });

  it('defaults missing numeric fields to 0', async () => {
    const handlers = await registerFresh();
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_profiles-summary.json')) {
        return JSON.stringify({
          profiles: {
            zcode: { tokensLight: 100 },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = await invoke(handlers, IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY);
    expect(result).toHaveLength(1);
    expect(result[0].tokensDark).toBe(0);
    expect(result[0].categories).toEqual([]);
    expect(result[0].stats.styleVars).toEqual({ dark: 0, light: 0, neutral: 0 });
  });
});
