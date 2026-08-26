// SPDX-License-Identifier: MPL-2.0

/**
 * # useAppController — smoke tests
 *
 * This hook is a pure composition layer over 10+ Zustand stores. It has no
 * domain state of its own — every value comes from a store selector.
 *
 * Testing strategy:
 *   - The `ui` vitest project uses `environment: 'node'` (no jsdom), so we
 *     use `react-dom/server`'s `renderToString` to synchronously render a
 *     capture component that invokes the hook and exposes its return value.
 *     `useEffect` does NOT fire in SSR, which is fine — we only assert on
 *     the return object shape, not on side effects.
 *   - Every store is mocked with a `(selector) => selector(mockState)` shim
 *     so the hook's `useStore((s) => s.field)` calls resolve to predictable
 *     values.
 *   - `useBoot`, `useBootProgress` are mocked as no-ops (their effects don't
 *     fire in SSR anyway).
 */
import { createElement } from 'react';

import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all store modules are replaced with selector-based shims.
// Each `useStore` implementation applies the selector to a mock state that
// contains both the subscribed state fields AND the action functions, exactly
// as a real zustand store would expose them.
// ---------------------------------------------------------------------------

const {
  // Mock state snapshots — keep them flat so spreads work.
  shellMock,
  notificationMock,
  statusMock,
  dialogMock,
  agentMock,
  themeMock,
  installFlowMock,
  settingsMock,
  wallpaperMock,
} = vi.hoisted(() => {
  const noop = vi.fn();

  // shellStore — 5 state fields + 7 actions
  const shellMock = {
    locale: 'en',
    appVersion: '0.0.0-test',
    route: 'workspace' as const,
    activeAgentId: null as string | null,
    logs: [] as string[],
    injectDockOpen: false,
    setAppVersion: noop,
    setLocale: noop,
    setLogs: noop,
    setInjectDockOpen: noop,
    toggleSidebar: noop,
    toggleInjectDock: noop,
    setRoute: noop,
  };

  // notificationStore
  const notificationMock = {
    toasts: [],
    showToast: noop,
    fail: noop,
  };

  // statusStore
  const statusMock = {
    status: null as unknown,
    lastStatusAt: null as number | null,
    isRefreshing: false,
    refreshStatus: noop,
  };

  // dialogStore
  const dialogMock = {
    restartPrompt: null as unknown,
    wallpaperRestartPrompt: null as unknown,
    deletePrompt: null as unknown,
    fileImportPrompt: null as unknown,
    setDeletePrompt: noop,
    setFileImportPrompt: noop,
    setRestartPrompt: noop,
    setWallpaperRestartPrompt: noop,
  };

  // agentStore
  const agentMock = {
    agents: [],
  };

  // themeStore
  const themeMock = {
    installed: [],
    loading: false,
    selection: { busyId: null, kind: 'all' as const },
    busy: { all: false, current: false },
    globalBusy: null,
    installedById: {},
    setSelection: noop,
    applyToApp: noop,
    restoreApp: noop,
    restoreAll: noop,
    exportTheme: noop,
    createBundle: noop,
    confirmDelete: noop,
    confirmFileImport: noop,
    dropThemeFiles: noop,
    refreshThemes: noop,
  };

  // installFlowStore
  const installFlowMock = {
    steps: [],
    currentTheme: null as unknown,
    lastError: null as string | null,
    retryInstall: noop,
    cancelInstall: noop,
    setSteps: noop,
    setFlowState: noop,
    runImport: noop,
    isInstalling: false,
    isComplete: false,
    isFailed: false,
    isCancelled: false,
    progress: 0,
  };

  // settingsStore
  const settingsMock = {
    settingsSection: 'general' as const,
    settings: {},
    setSettingsSection: noop,
    openSettings: noop,
  };

  // wallpaperStore
  const wallpaperMock = {
    wallpapers: [],
    loading: false,
    enabled: false,
    selectedId: null as string | null,
    agentWallpapers: {},
    active: null as unknown,
    render: 'cover' as const,
    error: null as string | null,
    setWallpaper: noop,
    importWallpaper: noop,
    deleteWallpaper: noop,
    setAgentWallpaper: noop,
    applyAgentWallpaper: noop,
    setAndApplyAgentWallpaper: noop,
    activateThemeWallpaper: noop,
    initialize: noop,
  };

  return {
    shellMock,
    notificationMock,
    statusMock,
    dialogMock,
    agentMock,
    themeMock,
    installFlowMock,
    settingsMock,
    wallpaperMock,
  };
});

// ---------------------------------------------------------------------------
// Store module mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/shellStore', () => ({
  useShellStore: (selector: (s: Record<string, unknown>) => unknown) => selector(shellMock),
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(notificationMock),
}));

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: (selector: (s: Record<string, unknown>) => unknown) => selector(statusMock),
}));

vi.mock('@/stores/dialogStore', () => ({
  useDialogStore: (selector: (s: Record<string, unknown>) => unknown) => selector(dialogMock),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) => selector(agentMock),
  appStatusFor: vi.fn().mockReturnValue('not-installed'),
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (selector: (s: Record<string, unknown>) => unknown) => selector(themeMock),
  aggregateBusyKey: () => null,
}));

vi.mock('@/stores/installFlowStore', () => ({
  useInstallFlowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(installFlowMock),
  selectInstallFlags: (s: Record<string, unknown>) => ({
    isInstalling: s.isInstalling,
    isComplete: s.isComplete,
    isFailed: s.isFailed,
    isCancelled: s.isCancelled,
    progress: s.progress,
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) => selector(settingsMock),
}));

vi.mock('@/stores/wallpaperStore', () => ({
  useWallpaperStore: (selector: (s: Record<string, unknown>) => unknown) => selector(wallpaperMock),
  selectActiveWallpaper: (s: Record<string, unknown>) => s.active,
}));

// ---------------------------------------------------------------------------
// useBoot / useBootProgress — mocked as no-effects (SSR doesn't fire useEffect)
// ---------------------------------------------------------------------------

vi.mock('./useBoot', () => ({
  useBoot: () => {},
}));

vi.mock('./useBootProgress', () => ({
  useBootProgress: () => ({}),
}));

// ---------------------------------------------------------------------------
// api client + i18n + AGENT_META — minimal mocks
// ---------------------------------------------------------------------------

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    setLocale: vi.fn().mockResolvedValue(undefined),
    onBootWarnings: vi.fn().mockReturnValue(vi.fn()),
    onRuntimeLog: vi.fn().mockReturnValue(vi.fn()),
    onStatusChanged: vi.fn().mockReturnValue(vi.fn()),
    refreshStatus: vi.fn().mockResolvedValue({ platform: 'win32', apps: [] }),
    scanElectronApps: vi.fn().mockResolvedValue({ adapted: [], other: [] }),
    launchElectronApp: vi.fn().mockResolvedValue({
      ok: true,
      pid: 1,
      port: null,
      state: 'launched',
      message: '',
    }),
    getSettings: vi
      .fn()
      .mockResolvedValue({ apps: {}, defaultPorts: {}, wallpaper: { agents: {} } }),
    getBootstrap: vi.fn().mockResolvedValue({ locale: 'zh-CN', appVersion: 'test' }),
    onFileImported: vi.fn().mockReturnValue(vi.fn()),
    onFileImportConfirm: vi.fn().mockReturnValue(vi.fn()),
    onFileImportFailed: vi.fn().mockReturnValue(vi.fn()),
    onTrayApply: vi.fn().mockReturnValue(vi.fn()),
    onCoordinatorStatus: vi.fn().mockReturnValue(vi.fn()),
    getCoordinatorSnapshot: vi.fn().mockResolvedValue(new Map()),
    queryCoordinatorState: vi.fn().mockResolvedValue(null),
    catalog: { themes: { list: vi.fn().mockResolvedValue({ items: [] }) } },
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    en: {
      bootWarningToast: (n: number) => `${n} warning(s)`,
      bootRestoringToast: (n: number) => `Restoring ${n} agent(s)`,
      bootAgentRestoredToast: (name: string) => `${name} restored`,
      bootAgentFailedToast: (name: string) => `${name} failed`,
    },
    zh: {
      bootWarningToast: (n: number) => `${n} 个警告`,
      bootRestoringToast: (n: number) => `正在恢复 ${n} 个代理`,
      bootAgentRestoredToast: (name: string) => `${name} 已恢复`,
      bootAgentFailedToast: (name: string) => `${name} 失败`,
    },
  },
}));

vi.mock('@shared/types', () => ({
  AGENT_META: {},
}));

// ---------------------------------------------------------------------------
// Import the hook AFTER all mocks are in place
// ---------------------------------------------------------------------------

import { type AppController, useAppController } from './useAppController';

// ---------------------------------------------------------------------------
// Capture component — renders the hook and stores the result in a module-level
// variable so assertions can read it after renderToString completes.
// ---------------------------------------------------------------------------

let captured: AppController | null = null;

function Capture() {
  captured = useAppController();
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAppController — smoke tests', () => {
  beforeEach(() => {
    captured = null;
  });

  // ── Group A: return object has all key fields ──────────────────────────

  describe('return shape', () => {
    it('renders without throwing and returns an object', () => {
      // renderToString fires the hook body synchronously but skips useEffect.
      // If any store mock is missing a field, this throws.
      expect(() => renderToString(createElement(Capture))).not.toThrow();
      expect(captured).not.toBeNull();
      expect(typeof captured).toBe('object');
    });

    it('exposes shell-level fields (locale, route, appVersion, activeAgentId)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('locale');
      expect(c).toHaveProperty('route');
      expect(c).toHaveProperty('appVersion');
      expect(c).toHaveProperty('activeAgentId');
    });

    it('exposes navigation + layout fields (setRoute, toggleSidebar, statusStale)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('setRoute');
      expect(c).toHaveProperty('toggleSidebar');
      expect(c).toHaveProperty('statusStale');
    });

    it('exposes status fields (status, lastStatusAt, isRefreshing, refreshStatus)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('lastStatusAt');
      expect(c).toHaveProperty('isRefreshing');
      expect(c).toHaveProperty('refreshStatus');
    });

    it('exposes notification fields (toasts, showToast, busy)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('toasts');
      expect(c).toHaveProperty('showToast');
      expect(c).toHaveProperty('busy');
    });

    it('exposes log fields (logs, injectDockOpen, setInjectDockOpen)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('logs');
      expect(c).toHaveProperty('injectDockOpen');
      expect(c).toHaveProperty('setInjectDockOpen');
    });

    it('exposes boot progress + i18n (bootProgress, t)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('bootProgress');
      expect(c).toHaveProperty('t');
    });

    it('exposes agent fields (agents, appStatusFor)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('agents');
      expect(c).toHaveProperty('appStatusFor');
    });

    it('exposes theme fields (installed, selection, setSelection, applyToApp, exportTheme, refreshThemes)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('installed');
      expect(c).toHaveProperty('selection');
      expect(c).toHaveProperty('setSelection');
      expect(c).toHaveProperty('applyToApp');
      expect(c).toHaveProperty('exportTheme');
      expect(c).toHaveProperty('refreshThemes');
    });

    it('exposes import/install flow fields (importTheme, retryInstall, cancelInstall)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('importTheme');
      expect(c).toHaveProperty('retryInstall');
      expect(c).toHaveProperty('cancelInstall');
    });

    it('exposes dialog fields (restartPrompt, setRestartPrompt, deletePrompt, setDeletePrompt)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('restartPrompt');
      expect(c).toHaveProperty('setRestartPrompt');
      expect(c).toHaveProperty('deletePrompt');
      expect(c).toHaveProperty('setDeletePrompt');
    });

    it('exposes settings fields (settings, openSettings)', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('settings');
      expect(c).toHaveProperty('openSettings');
    });

    it('exposes the wallpaper sub-object with expected keys', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('wallpaper');
      expect(c.wallpaper).toBeTypeOf('object');
      expect(c.wallpaper).toHaveProperty('wallpapers');
      expect(c.wallpaper).toHaveProperty('loading');
      expect(c.wallpaper).toHaveProperty('enabled');
      expect(c.wallpaper).toHaveProperty('selectedId');
      expect(c.wallpaper).toHaveProperty('active');
      expect(c.wallpaper).toHaveProperty('setWallpaper');
      expect(c.wallpaper).toHaveProperty('importWallpaper');
      expect(c.wallpaper).toHaveProperty('deleteWallpaper');
    });

    it('exposes setLocale as a field', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(c).toHaveProperty('setLocale');
    });
  });

  // ── Group B: action references are functions ───────────────────────────

  describe('action references are functions', () => {
    it('shell actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.setRoute).toBe('function');
      expect(typeof c.toggleSidebar).toBe('function');
      expect(typeof c.setInjectDockOpen).toBe('function');
    });

    it('notification + status actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.showToast).toBe('function');
      expect(typeof c.refreshStatus).toBe('function');
    });

    it('theme actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.setSelection).toBe('function');
      expect(typeof c.applyToApp).toBe('function');
      expect(typeof c.restoreApp).toBe('function');
      expect(typeof c.restoreAll).toBe('function');
      expect(typeof c.exportTheme).toBe('function');
      expect(typeof c.createBundle).toBe('function');
      expect(typeof c.refreshThemes).toBe('function');
    });

    it('install flow actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.importTheme).toBe('function');
      expect(typeof c.retryInstall).toBe('function');
      expect(typeof c.cancelInstall).toBe('function');
    });

    it('dialog actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.setRestartPrompt).toBe('function');
      expect(typeof c.setDeletePrompt).toBe('function');
    });

    it('settings actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.openSettings).toBe('function');
    });

    it('wallpaper actions are functions', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.wallpaper.setWallpaper).toBe('function');
      expect(typeof c.wallpaper.importWallpaper).toBe('function');
      expect(typeof c.wallpaper.deleteWallpaper).toBe('function');
      expect(typeof c.wallpaper.initialize).toBe('function');
    });

    it('setLocale is a function', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.setLocale).toBe('function');
    });

    it('appStatusFor is a function', () => {
      renderToString(createElement(Capture));
      const c = captured!;
      expect(typeof c.appStatusFor).toBe('function');
    });
  });

  // ── Group C: values flow through from stores ───────────────────────────

  describe('values propagate from stores', () => {
    it('reads locale from shellStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.locale).toBe('en');
    });

    it('reads route from shellStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.route).toBe('workspace');
    });

    it('reads status from statusStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.status).toBeNull();
    });

    it('computes statusStale from status (null → true)', () => {
      renderToString(createElement(Capture));
      expect(captured!.statusStale).toBe(true);
    });

    it('reads agents from agentStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.agents).toEqual([]);
    });

    it('reads installed from themeStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.installed).toEqual([]);
    });

    it('reads settings from settingsStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.settings).toEqual({});
    });

    it('reads wallpaper sub-fields from wallpaperStore', () => {
      renderToString(createElement(Capture));
      expect(captured!.wallpaper.wallpapers).toEqual([]);
      expect(captured!.wallpaper.enabled).toBe(false);
    });
  });
});
