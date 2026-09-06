// SPDX-License-Identifier: MPL-2.0

/**
 * # tray-manager tests
 *
 * RC-D fix: tray-manager.ts previously had zero unit test coverage. These
 * tests verify the tray lifecycle using createElectronMock with a stateful Tray.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../fixtures/mocks/electron';

// ---------------------------------------------------------------------------
// Mock Tray that tracks instances + listeners.
// ---------------------------------------------------------------------------

interface MockTray {
  listeners: Map<string, Array<() => void>>;
  setToolTip: ReturnType<typeof vi.fn>;
  setImage: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
  on: (event: string, handler: () => void) => void;
}

const trackedTrays: MockTray[] = [];

function makeTray(): MockTray {
  const listeners = new Map<string, Array<() => void>>();
  const tray: MockTray = {
    listeners,
    setToolTip: vi.fn(),
    setImage: vi.fn(),
    setContextMenu: vi.fn(),
    destroy: vi.fn(),
    popUpContextMenu: vi.fn(),
    on(event: string, handler: () => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
    },
  };
  trackedTrays.push(tray);
  return tray;
}

const mockNativeImage = {
  createFromPath: vi.fn(() => ({
    isEmpty: () => false,
    setTemplateImage: vi.fn(),
    getSize: () => ({ width: 16, height: 16 }),
  })),
  createEmpty: vi.fn(() => ({
    isEmpty: () => true,
    setTemplateImage: vi.fn(),
    getSize: () => ({ width: 0, height: 0 }),
  })),
  createFromBuffer: vi.fn(() => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
  })),
};

vi.mock('electron', () => ({
  ...createElectronMock(new Map()),
  Tray: vi.fn().mockImplementation(makeTray),
  nativeImage: mockNativeImage,
}));

const electron = await import('electron');
const MockMenu = electron.Menu as unknown as { buildFromTemplate: ReturnType<typeof vi.fn> };

// Mock main-context before importing tray-manager.
vi.mock('./main-context', () => ({
  ctx: {
    tray: null as unknown,
    mainWindow: null as unknown,
    core: {
      status: vi.fn().mockResolvedValue({ apps: [] }),
      restore: vi.fn().mockResolvedValue(undefined),
      restoreAll: vi.fn().mockResolvedValue(undefined),
    },
    library: {
      summaries: vi.fn().mockResolvedValue([]),
    },
  },
  brandingRoot: vi.fn().mockReturnValue('/mock/branding'),
  sendLog: vi.fn(),
}));

const { createTrayManager } = await import('./tray-manager');
const mockCtx = (await import('./main-context')).ctx as unknown as {
  tray: unknown;
  mainWindow: { show: () => void; focus: () => void; isDestroyed: () => boolean } | null;
  core: {
    status: () => Promise<{ apps: unknown[] }>;
    restoreAll: () => Promise<void>;
  };
  library: { summaries: () => Promise<unknown[]> };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the top-level menu template (array of items) last passed to
 * Menu.buildFromTemplate, then flatten any `submenu` arrays so we can
 * search by label recursively.
 */
function getLastTemplate(): Record<string, unknown>[] {
  const calls = MockMenu.buildFromTemplate.mock.calls;
  const lastCall = calls[calls.length - 1];
  return (lastCall?.[0] ?? []) as Record<string, unknown>[];
}

/** Flatten a template (one level of submenu) into a label→item map. */
function flattenTemplate(template: Record<string, unknown>[]): {
  labels: string[];
  byLabel: Map<string, Record<string, unknown>>;
} {
  const labels: string[] = [];
  const byLabel = new Map<string, Record<string, unknown>>();
  for (const item of template) {
    const label = item.label as string | undefined;
    if (label) {
      labels.push(label);
      byLabel.set(label, item);
    }
    // Dive one level into submenu (enough for quick-switch section).
    if (item.submenu) {
      for (const sub of item.submenu as Record<string, unknown>[]) {
        const subLabel = sub.label as string | undefined;
        if (subLabel) {
          labels.push(subLabel);
          byLabel.set(subLabel, sub);
        }
      }
    }
  }
  return { labels, byLabel };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tray-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackedTrays.length = 0;
    mockCtx.tray = null;
    mockCtx.mainWindow = null;
  });

  afterEach(() => {
    mockCtx.tray = null;
    mockCtx.mainWindow = null;
  });

  describe('createTray', () => {
    it('creates a Tray instance and stores it on ctx', () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      manager.createTray();
      expect(trackedTrays.length).toBe(1);
      expect(mockCtx.tray).toBe(trackedTrays[0]);
    });

    it('double-click surfaces a non-destroyed main window', () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      manager.createTray();

      const showMock = vi.fn();
      mockCtx.mainWindow = {
        show: showMock,
        focus: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };

      const handlers = trackedTrays[0].listeners.get('double-click') ?? [];
      for (const handler of handlers) handler();

      expect(showMock).toHaveBeenCalled();
    });

    it('double-click does not surface a destroyed main window', () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      manager.createTray();

      const showMock = vi.fn();
      mockCtx.mainWindow = {
        show: showMock,
        focus: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(true),
      };

      const handlers = trackedTrays[0].listeners.get('double-click') ?? [];
      for (const handler of handlers) handler();

      expect(showMock).not.toHaveBeenCalled();
    });
  });

  describe('updateTrayMenu', () => {
    it('builds a context menu from live state', async () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      manager.createTray();

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      expect(MockMenu.buildFromTemplate).toHaveBeenCalled();
      expect(trackedTrays[0].setContextMenu).toHaveBeenCalled();
    });

    it('handles errors from core services gracefully', async () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      manager.createTray();

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('service unavailable'),
      );

      await expect(manager.updateTrayMenu()).resolves.not.toThrow();
    });

    it('does not build menu if tray is null', async () => {
      const manager = createTrayManager(mockCtx as never, {
        onQuit: vi.fn(),
        onApplyRequest: vi.fn(),
      });
      // createTray was not called, tray remains null.
      mockCtx.tray = null;

      await manager.updateTrayMenu();

      expect(MockMenu.buildFromTemplate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // New feature: quick-action items (pause / reapply / quick-switch)
  // -------------------------------------------------------------------------

  describe('quick-action items', () => {
    const baseDeps = {
      onQuit: vi.fn<() => void>(),
      onApplyRequest: vi.fn<(themeId: string, themeName: string, appId: string) => void>(),
      onPauseAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onResumeAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onReapplyAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onQuickSwitchTheme: vi
        .fn<(themeId: string, appId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      isPaused: () => false,
      getRecentThemes: () =>
        [] as Array<{ id: string; displayName: string; supportedAgents: string[] }>,
    };

    function setupManager(deps: typeof baseDeps) {
      const manager = createTrayManager(mockCtx as never, deps as never);
      manager.createTray();
      return manager;
    }

    it('menu contains "暂停全部皮肤" button when not paused', async () => {
      const manager = setupManager(baseDeps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      expect(labels).toContain('暂停全部皮肤');
    });

    it('menu contains "继续全部皮肤" button when paused', async () => {
      const deps = { ...baseDeps, isPaused: () => true };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      expect(labels).toContain('继续全部皮肤');
    });

    it('menu contains "重新应用全部" button', async () => {
      const manager = setupManager(baseDeps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      expect(labels).toContain('重新应用全部');
    });

    it('clicking "暂停全部皮肤" calls onPauseAll and refreshes menu', async () => {
      const onPauseAll = vi.fn().mockResolvedValue(undefined);
      const manager = setupManager({ ...baseDeps, onPauseAll });

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const pauseItem = byLabel.get('暂停全部皮肤');
      expect(pauseItem).toBeDefined();
      expect(pauseItem?.enabled).toBe(true);

      // Simulate click.
      (pauseItem as { click: () => void }).click();

      expect(onPauseAll).toHaveBeenCalledTimes(1);
    });

    it('clicking "继续全部皮肤" calls onResumeAll', async () => {
      const onResumeAll = vi.fn().mockResolvedValue(undefined);
      const deps = { ...baseDeps, isPaused: () => true, onResumeAll };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const resumeItem = byLabel.get('继续全部皮肤');
      expect(resumeItem).toBeDefined();
      expect(resumeItem?.enabled).toBe(true);

      (resumeItem as { click: () => void }).click();

      expect(onResumeAll).toHaveBeenCalledTimes(1);
    });

    it('pause button is disabled when onPauseAll is not provided', async () => {
      const deps = { ...baseDeps, onPauseAll: undefined } as never;
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const pauseItem = byLabel.get('暂停全部皮肤');
      expect(pauseItem).toBeDefined();
      expect(pauseItem?.enabled).toBe(false);
    });

    it('reapply button is disabled when onReapplyAll is not provided', async () => {
      const deps = { ...baseDeps, onReapplyAll: undefined } as never;
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const reapplyItem = byLabel.get('重新应用全部');
      expect(reapplyItem).toBeDefined();
      expect(reapplyItem?.enabled).toBe(false);
    });

    it('clicking "重新应用全部" calls onReapplyAll', async () => {
      const onReapplyAll = vi.fn().mockResolvedValue(undefined);
      const manager = setupManager({ ...baseDeps, onReapplyAll });

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [{ appId: 'traework', displayName: 'TRAE', installed: true, running: false }],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const reapplyItem = byLabel.get('重新应用全部');

      (reapplyItem as { click: () => void }).click();

      expect(onReapplyAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('quick-switch section', () => {
    const baseDeps = {
      onQuit: vi.fn<() => void>(),
      onApplyRequest: vi.fn<(themeId: string, themeName: string, appId: string) => void>(),
      onPauseAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onResumeAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onReapplyAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onQuickSwitchTheme: vi
        .fn<(themeId: string, appId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      isPaused: () => false,
      getRecentThemes: () =>
        [] as Array<{ id: string; displayName: string; supportedAgents: string[] }>,
    };

    function setupManager(deps: typeof baseDeps) {
      const manager = createTrayManager(mockCtx as never, deps as never);
      manager.createTray();
      return manager;
    }

    it('menu contains "快速切换" section when recent themes exist', async () => {
      const recentThemes = [
        { id: 'ocean', displayName: 'Ocean', supportedAgents: ['traework'] },
        { id: 'sunset', displayName: 'Sunset', supportedAgents: ['traework'] },
        { id: 'forest', displayName: 'Forest', supportedAgents: ['traework'] },
      ];
      const deps = { ...baseDeps, getRecentThemes: () => recentThemes };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: 'ocean',
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      // The section header should include the quick-switch label.
      const quickSwitchLabel = labels.find((l) => l.includes('快速切换'));
      expect(quickSwitchLabel).toBeDefined();
      // The recent themes should appear as submenu items.
      expect(labels).toContain('Ocean');
      expect(labels).toContain('Sunset');
      expect(labels).toContain('Forest');
    });

    it('active recent theme is checked in quick-switch submenu', async () => {
      const recentThemes = [
        { id: 'ocean', displayName: 'Ocean', supportedAgents: ['traework'] },
        { id: 'sunset', displayName: 'Sunset', supportedAgents: ['traework'] },
      ];
      const deps = { ...baseDeps, getRecentThemes: () => recentThemes };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: 'ocean',
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const oceanItem = byLabel.get('Ocean');
      const sunsetItem = byLabel.get('Sunset');

      expect(oceanItem?.checked).toBe(true);
      expect(oceanItem?.type).toBe('checkbox');
      expect(sunsetItem?.checked).toBe(false);
      expect(sunsetItem?.type).toBe('checkbox');
    });

    it('clicking a quick-switch theme calls onQuickSwitchTheme with correct args', async () => {
      const onQuickSwitchTheme = vi.fn().mockResolvedValue(undefined);
      const recentThemes = [
        { id: 'ocean', displayName: 'Ocean', supportedAgents: ['traework'] },
        { id: 'sunset', displayName: 'Sunset', supportedAgents: ['traework'] },
      ];
      const deps = { ...baseDeps, getRecentThemes: () => recentThemes, onQuickSwitchTheme };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: 'ocean',
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { byLabel } = flattenTemplate(template);
      const sunsetItem = byLabel.get('Sunset');

      // Simulate click on Sunset (not the active one).
      (sunsetItem as { click: () => void }).click();

      expect(onQuickSwitchTheme).toHaveBeenCalledTimes(1);
      expect(onQuickSwitchTheme).toHaveBeenCalledWith('sunset', 'traework');
    });

    it('quick-switch section is hidden when no recent themes exist', async () => {
      const manager = setupManager(baseDeps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: null,
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      const quickSwitchLabel = labels.find((l) => l.includes('快速切换'));
      expect(quickSwitchLabel).toBeUndefined();
    });

    it('quick-switch section caps at 3 themes', async () => {
      const recentThemes = [
        { id: 't1', displayName: 'Theme 1', supportedAgents: ['traework'] },
        { id: 't2', displayName: 'Theme 2', supportedAgents: ['traework'] },
        { id: 't3', displayName: 'Theme 3', supportedAgents: ['traework'] },
        { id: 't4', displayName: 'Theme 4', supportedAgents: ['traework'] },
        { id: 't5', displayName: 'Theme 5', supportedAgents: ['traework'] },
      ];
      const deps = { ...baseDeps, getRecentThemes: () => recentThemes };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: null,
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      // Find the quick-switch item (first level only).
      const quickSwitchItem = template.find(
        (item) => typeof item.label === 'string' && item.label.includes('快速切换'),
      );
      expect(quickSwitchItem).toBeDefined();
      const submenu = quickSwitchItem?.submenu as Record<string, unknown>[] | undefined;
      expect(submenu).toBeDefined();
      expect(submenu?.length).toBe(3);
    });

    it('quick-switch section only shows themes supported by the target agent', async () => {
      const recentThemes = [
        { id: 'ocean', displayName: 'Ocean', supportedAgents: ['traework'] },
        { id: 'exclusive', displayName: 'Exclusive', supportedAgents: ['codex'] },
      ];
      const deps = { ...baseDeps, getRecentThemes: () => recentThemes };
      const manager = setupManager(deps);

      (mockCtx.core.status as ReturnType<typeof vi.fn>).mockResolvedValue({
        apps: [
          {
            appId: 'traework',
            displayName: 'TRAE',
            installed: true,
            running: false,
            activeThemeId: null,
          },
        ],
      });
      (mockCtx.library.summaries as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await manager.updateTrayMenu();

      const template = getLastTemplate();
      const { labels } = flattenTemplate(template);
      expect(labels).toContain('Ocean');
      expect(labels).not.toContain('Exclusive');
    });
  });
});
