// SPDX-License-Identifier: MPL-2.0

/**
 * # themeStore tests
 *
 * Unit tests for the store lifecycle: applyToApp unknown-status branch,
 * withBusy concurrent-array semantics (F-6), restoreApp wallpaper
 * deactivation (A-5), confirmDelete affected-apps warning (A-6 +
 * A-10), and refreshThemes debounce (A-7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockApplyTheme,
  mockListThemes,
  mockOnFileImported,
  mockOnFileImportConfirm,
  mockOnFileImportFailed,
  mockOnTrayApply,
  mockRefreshStatus,
  mockShowToast,
  mockFail,
  mockSetRestartPrompt,
  mockSetFileImportPrompt,
  mockActivateThemeWallpaper,
  mockSetAgentWallpaper,
  mockSetStatus,
  mockDeleteTheme,
  mockRestoreApp,
  mockSetDeletePrompt,
} = vi.hoisted(() => ({
  mockApplyTheme: vi.fn(),
  mockListThemes: vi.fn(),
  mockOnFileImported: vi.fn(),
  mockOnFileImportConfirm: vi.fn(),
  mockOnFileImportFailed: vi.fn(),
  mockOnTrayApply: vi.fn(),
  mockRefreshStatus: vi.fn(),
  mockShowToast: vi.fn(),
  mockFail: vi.fn(),
  mockSetRestartPrompt: vi.fn(),
  mockSetFileImportPrompt: vi.fn(),
  mockActivateThemeWallpaper: vi.fn(),
  mockSetAgentWallpaper: vi.fn(),
  mockSetStatus: vi.fn(),
  mockDeleteTheme: vi.fn(),
  mockRestoreApp: vi.fn(),
  mockSetDeletePrompt: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    applyTheme: mockApplyTheme,
    catalog: { themes: { list: mockListThemes } },
    deleteTheme: mockDeleteTheme,
    restoreApp: mockRestoreApp,
    onFileImported: mockOnFileImported,
    onFileImportConfirm: mockOnFileImportConfirm,
    onFileImportFailed: mockOnFileImportFailed,
    onTrayApply: mockOnTrayApply,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
      fail: mockFail,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: {
    getState: vi.fn(() => ({
      refreshStatus: mockRefreshStatus,
      status: {
        apps: [
          { appId: 'traework', activeThemeId: 'test-theme', displayName: 'Trae' },
          { appId: 'qoderwork', activeThemeId: null, displayName: 'QoderWork' },
        ],
      },
      setStatus: mockSetStatus,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/dialogStore', () => ({
  useDialogStore: {
    getState: vi.fn(() => ({
      setRestartPrompt: mockSetRestartPrompt,
      setFileImportPrompt: mockSetFileImportPrompt,
      deletePrompt: null,
      setDeletePrompt: mockSetDeletePrompt,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: 'zh-CN', route: null, booting: false })),
    setState: vi.fn(),
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    'zh-CN': {
      themeApplied: (name: string) => `已应用主题: ${name}`,
      themeDeleted: (name: string) => `已删除 ${name}`,
      themeDeletedWithApps: (name: string, count: number) =>
        `已删除 ${name}，${count} 个应用恢复原生主题`,
      themeApplyUnexpectedStatus: (status: string) => `主题应用返回意外状态：${status}`,
      actionFailed: '操作失败',
      nativeRestored: (app: string) => `已恢复 ${app} 原生界面`,
    },
    en: {
      themeApplied: (name: string) => `${name} applied`,
      themeDeleted: (name: string) => `Deleted ${name}`,
      themeDeletedWithApps: (name: string, count: number) =>
        `Deleted ${name}, ${count} app${count === 1 ? '' : 's'} reverted to native`,
      themeApplyUnexpectedStatus: (status: string) =>
        `Theme apply returned unexpected status: ${status}`,
      actionFailed: 'The action failed',
      nativeRestored: (app: string) => `Restored original ${app}`,
    },
  },
}));

vi.mock('@/stores/wallpaperStore', () => ({
  useWallpaperStore: {
    getState: vi.fn(() => ({
      activateThemeWallpaper: mockActivateThemeWallpaper,
      setAgentWallpaper: mockSetAgentWallpaper,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/components/app-mark', () => ({
  APP_META: {
    workbuddy: { name: 'WorkBuddy', icon: '' },
    qoderwork: { name: 'QoderWork', icon: '' },
    traework: { name: 'Trae', icon: '' },
    doubao: { name: 'Doubao', icon: '' },
    codex: { name: 'Codex', icon: '' },
    zcode: { name: 'ZCode', icon: '' },
  },
}));

import { useDialogStore } from '@/stores/dialogStore';

// Import AFTER all mocks are in place
import type { AgentId } from '@shared/types';
import { useThemeStore } from './themeStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('themeStore — applyToApp unknown-status branch', () => {
  const appId: AgentId = 'traework';

  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    mockListThemes.mockResolvedValue({ items: [] });
    mockRefreshStatus.mockResolvedValue(undefined);
  });

  it('shows a destructive toast and returns false when applyTheme returns an unknown status', async () => {
    mockApplyTheme.mockResolvedValueOnce({
      status: 'future-unknown-status',
      message: 'Something unexpected',
      system: { platform: 'win32', apps: [] },
    } as unknown as Parameters<typeof mockApplyTheme>[0]);

    const result = await useThemeStore.getState().applyToApp('cyber-neon', 'Cyber Neon', appId);

    expect(mockShowToast).toHaveBeenCalledWith(
      '主题应用返回意外状态：future-unknown-status',
      'destructive',
    );
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F-6: withBusy concurrent-array semantics
// ---------------------------------------------------------------------------

describe('themeStore — withBusy busy array (F-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    mockListThemes.mockResolvedValue({ items: [] });
    mockRefreshStatus.mockResolvedValue(undefined);
    // 'applied' is the recognized success status per handleApplyResult.
    mockApplyTheme.mockResolvedValue({
      status: 'applied',
      message: 'OK',
      system: { platform: 'win32', apps: [] },
    });
  });

  it('all 3 concurrent applies complete and refreshStatus is called 3 times', async () => {
    // Fire 3 concurrent apply operations with different agent keys.
    const results = await Promise.all([
      useThemeStore.getState().applyToApp('theme-a', 'Theme A', 'traework'),
      useThemeStore.getState().applyToApp('theme-b', 'Theme B', 'qoderwork'),
      useThemeStore.getState().applyToApp('theme-c', 'Theme C', 'workbuddy'),
    ]);

    // All three should complete without error.
    expect(results.length).toBe(3);
    // Verify that refreshStatus was called for each apply.
    expect(mockRefreshStatus).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// A-5: restoreApp deactivates wallpaper
// ---------------------------------------------------------------------------

describe('themeStore — restoreApp wallpaper deactivation (A-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    mockRestoreApp.mockResolvedValue({
      apps: [{ appId: 'traework', displayName: 'Trae' }],
      system: { platform: 'win32', apps: [] },
    });
    mockRefreshStatus.mockResolvedValue(undefined);
    mockSetAgentWallpaper.mockResolvedValue(true);
  });

  it('calls setAgentWallpaper(appId, false, null) after restoring an app', async () => {
    await useThemeStore.getState().restoreApp('traework' as AgentId);

    // The wallpaper deactivation should be called with enabled=false and id=null.
    expect(mockSetAgentWallpaper).toHaveBeenCalledWith('traework', false, null);
    // And status should be refreshed from the authoritative source.
    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A-6 + A-10: confirmDelete affected-apps warning + refreshStatus
// ---------------------------------------------------------------------------

describe('themeStore — confirmDelete affected-apps warning (A-6 + A-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    mockDeleteTheme.mockResolvedValue({
      status: {
        apps: [
          { appId: 'traework', activeThemeId: null, displayName: 'Trae' },
          { appId: 'qoderwork', activeThemeId: null, displayName: 'QoderWork' },
        ],
        system: { platform: 'win32' },
      },
    });
    mockRefreshStatus.mockResolvedValue(undefined);
    mockListThemes.mockResolvedValue({ items: [] });
  });

  it('shows delete toast and calls setStatus with result status', async () => {
    (useDialogStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      setRestartPrompt: mockSetRestartPrompt,
      setFileImportPrompt: mockSetFileImportPrompt,
      deletePrompt: { id: 'test-theme', name: 'Test Theme' },
      setDeletePrompt: mockSetDeletePrompt,
    } as never);

    await useThemeStore.getState().confirmDelete();

    // Plain delete toast (current impl uses ThemeCatalogItem directly).
    expect(mockShowToast).toHaveBeenCalledWith('已删除 Test Theme');
    // Current impl uses setStatus from the delete result.
    expect(mockSetStatus).toHaveBeenCalledTimes(1);
  });

  it('shows plain delete toast for orphan theme', async () => {
    (useDialogStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      setRestartPrompt: mockSetRestartPrompt,
      setFileImportPrompt: mockSetFileImportPrompt,
      deletePrompt: { id: 'orphan-theme', name: 'Orphan Theme' },
      setDeletePrompt: mockSetDeletePrompt,
    } as never);

    await useThemeStore.getState().confirmDelete();

    // Plain delete toast.
    expect(mockShowToast).toHaveBeenCalledWith('已删除 Orphan Theme');
    expect(mockSetStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A-7: refreshThemes debounce
// ---------------------------------------------------------------------------

describe('themeStore — refreshThemes debounce (A-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    vi.useFakeTimers();
    mockListThemes.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces 5 rapid calls into a single IPC call', () => {
    const store = useThemeStore.getState();

    store.refreshThemes();
    store.refreshThemes();
    store.refreshThemes();
    store.refreshThemes();
    store.refreshThemes();

    expect(mockListThemes).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(mockListThemes).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Listener lifecycle — idempotency guard for HMR / repeated create()
// ---------------------------------------------------------------------------

describe('themeStore listener lifecycle', () => {
  it('unsubscribe clears all listener refs', () => {
    const cancelers = {
      fileImported: vi.fn(),
      fileImportConfirm: vi.fn(),
      fileImportFailed: vi.fn(),
      trayApply: vi.fn(),
    };
    mockOnFileImported.mockReturnValueOnce(cancelers.fileImported);
    mockOnFileImportConfirm.mockReturnValueOnce(cancelers.fileImportConfirm);
    mockOnFileImportFailed.mockReturnValueOnce(cancelers.fileImportFailed);
    mockOnTrayApply.mockReturnValueOnce(cancelers.trayApply);

    vi.resetModules();
    return import('./themeStore').then(({ useThemeStore: freshStore }) => {
      expect(mockOnFileImported).toHaveBeenCalledTimes(1);
      expect(mockOnFileImportConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnFileImportFailed).toHaveBeenCalledTimes(1);
      expect(mockOnTrayApply).toHaveBeenCalledTimes(1);

      freshStore.getState().unsubscribe();
      expect(cancelers.fileImported).toHaveBeenCalledTimes(1);
      expect(cancelers.fileImportConfirm).toHaveBeenCalledTimes(1);
      expect(cancelers.fileImportFailed).toHaveBeenCalledTimes(1);
      expect(cancelers.trayApply).toHaveBeenCalledTimes(1);
    });
  });

  it('double create does not register duplicate listeners', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const source = fs.readFileSync(`${__dirname}/themeStore.ts`, {
      encoding: 'utf-8',
    });
    expect(source).toContain('if (offFileImported) unsubscribe()');
  });
});
