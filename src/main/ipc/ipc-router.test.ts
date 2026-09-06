// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import type { MainContext } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks
// The router captures handlers via the shared electron mock's handlers map.
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

vi.mock('../main-context', () => ({
  wrapCatalog: vi.fn((items: unknown[]) => ({
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    items,
  })),
}));

vi.mock('../services/performance', () => ({
  performanceLogger: {
    logTimeout: vi.fn(),
    log: vi.fn(),
  },
}));

const { registerUnifiedIpcRouter, UnifiedChannel } = await import('./ipc-router');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockDeps(): MainContext {
  return {
    mainWindow: null,
    agentCatalog: {
      listAgents: vi.fn().mockReturnValue([{ id: 'codex', supported: true }]),
    },
    core: {
      status: vi.fn().mockResolvedValue({
        apps: [{ appId: 'codex', installed: true, running: false }],
        platform: 'win32',
      }),
    },
    themeCatalog: {
      listThemes: vi.fn().mockResolvedValue([{ id: 'theme-1' }]),
      getTheme: vi.fn().mockResolvedValue({ id: 'theme-1', name: 'Test' }),
      searchThemes: vi.fn().mockResolvedValue([{ id: 'theme-1' }]),
      filterByAgent: vi.fn().mockResolvedValue([{ id: 'theme-1' }]),
    },
    wallpapers: {
      list: vi.fn().mockReturnValue([{ id: 'wp-1', title: 'Sunset' }]),
    },
  } as unknown as MainContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ipc-router: status:query', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerUnifiedIpcRouter({ ctx: makeMockDeps() });
  });

  it('registers the status:query channel', () => {
    expect(handlers.has(UnifiedChannel.STATUS_QUERY)).toBe(true);
  });

  describe('action: system', () => {
    it('returns core.status() payload', async () => {
      // Re-register with controlled mock
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = await handler({}, 'system');
      expect(result).toEqual({
        apps: [{ appId: 'codex', installed: true, running: false }],
        platform: 'win32',
      });
    });
  });

  describe('action: agent-list', () => {
    it('merges catalog items with live status', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = (await handler({}, 'agent-list')) as Record<string, unknown>;
      // wrapCatalog wraps the merged array
      expect(result).toHaveProperty('items');
      const items = result.items as unknown[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: 'codex', status: { installed: true, running: false } });
    });
  });

  describe('action: theme-list', () => {
    it('returns wrapped catalog themes', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = (await handler({}, 'theme-list')) as Record<string, unknown>;
      expect(result).toHaveProperty('items');
      expect(result.items).toEqual([{ id: 'theme-1' }]);
    });
  });

  describe('action: theme-get', () => {
    it('returns the theme for a valid id', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = await handler({}, 'theme-get', 'theme-1');
      expect(result).toEqual({ id: 'theme-1', name: 'Test' });
    });

    it('throws for an unsafe theme id (path-traversal)', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      await expect(handler({}, 'theme-get', '../etc/passwd')).rejects.toThrow();
    });
  });

  describe('action: theme-search', () => {
    it('delegates to themeCatalog.searchThemes', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = (await handler({}, 'theme-search', 'test')) as Record<string, unknown>;
      expect(result).toHaveProperty('items');
      expect(result.items).toEqual([{ id: 'theme-1' }]);
    });

    it('throws for empty query', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      await expect(handler({}, 'theme-search', '')).rejects.toThrow();
    });
  });

  describe('action: theme-filter', () => {
    it('delegates to themeCatalog.filterByAgent for valid agent', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = (await handler({}, 'theme-filter', 'codex')) as Record<string, unknown>;
      expect(result).toHaveProperty('items');
      expect(result.items).toEqual([{ id: 'theme-1' }]);
    });

    it('throws for invalid agent id', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      await expect(handler({}, 'theme-filter', 'not-an-agent')).rejects.toThrow();
    });
  });

  describe('action: wallpaper-list', () => {
    it('returns wallpaper list when service is available', async () => {
      const deps = makeMockDeps();
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = await handler({}, 'wallpaper-list');
      expect(result).toEqual([{ id: 'wp-1', title: 'Sunset' }]);
    });

    it('returns empty array when wallpaper service is null', async () => {
      const deps = makeMockDeps();
      deps.wallpapers = null;
      handlers.clear();
      registerUnifiedIpcRouter({ ctx: deps });

      const handler = handlers.get(UnifiedChannel.STATUS_QUERY)!;
      const result = await handler({}, 'wallpaper-list');
      expect(result).toEqual([]);
    });
  });
});
