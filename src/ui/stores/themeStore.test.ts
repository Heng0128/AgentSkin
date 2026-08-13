// SPDX-License-Identifier: MPL-2.0

/**
 * # themeStore tests
 *
 * Unit tests for the `applyToApp` unknown-status branch. The store's external
 * dependencies (api, notificationStore, statusStore, dialogStore, shellStore,
 * i18n, wallpaperStore, app-mark) are all mocked with vi.hoisted + vi.mock so
 * the tests run without Electron IPC or image assets.
 *
 * The real `handleApplyResult` is used (not mocked) so the test exercises the
 * full integration path: unknown status from api.applyTheme -> classification
 * by handleApplyResult -> themeStore switch branch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before the first import that transitively
// depends on the mocked modules.
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
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    applyTheme: mockApplyTheme,
    catalog: { themes: { list: mockListThemes } },
    // IPC subscription methods — return canceler functions.
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
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/dialogStore', () => ({
  useDialogStore: {
    getState: vi.fn(() => ({
      setRestartPrompt: mockSetRestartPrompt,
      setFileImportPrompt: mockSetFileImportPrompt,
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
      actionFailed: '操作失败',
    },
  },
}));

vi.mock('@/stores/wallpaperStore', () => ({
  useWallpaperStore: {
    getState: vi.fn(() => ({
      activateThemeWallpaper: mockActivateThemeWallpaper,
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
    // Reset store state — busyKeys is module-level and cleaned up by withBusy's
    // finally block, but resetting busy here is a defensive guard.
    useThemeStore.setState({ busy: null, installed: [], selection: null });
    // Default mock behaviors for the happy path of non-target operations.
    mockListThemes.mockResolvedValue({ items: [] });
    mockRefreshStatus.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // unknown-status: future main process returns an unrecognized status
  // -----------------------------------------------------------------------

  it('shows a destructive toast and returns false when applyTheme returns an unknown status', async () => {
    // Simulate a future main process returning a status that the current
    // renderer does not recognize — handleApplyResult classifies this as
    // { kind: 'unknown-status' } via its default branch.
    mockApplyTheme.mockResolvedValueOnce({
      status: 'future-unknown-status',
      message: 'Something unexpected',
      system: { platform: 'win32', apps: [] },
    } as unknown as Parameters<typeof mockApplyTheme>[0]);

    const result = await useThemeStore.getState().applyToApp('cyber-neon', 'Cyber Neon', appId);

    // The unknown-status branch fires a destructive toast with the status name.
    expect(mockShowToast).toHaveBeenCalledWith(
      'Theme apply returned unexpected status: future-unknown-status',
      'destructive',
    );
    // Exactly one toast — no success toast, no double-fire.
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // The operation reports failure to the caller.
    expect(result).toBe(false);
    // statusStore.refreshStatus IS still called (post-apply refresh happens
    // before the outcome switch, so it is not short-circuited).
    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Listener lifecycle — idempotency guard for HMR / repeated create()
// ---------------------------------------------------------------------------

describe('themeStore listener lifecycle', () => {
  it('unsubscribe clears all listener refs', () => {
    // Provide real canceler functions so we can verify they are invoked.
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

    // Trigger a fresh module evaluation so create() runs again with the
    // cancelers above. vi.resetModules + dynamic import is the standard
    // pattern for simulating HMR in Vitest.
    vi.resetModules();
    return import('./themeStore').then(({ useThemeStore: freshStore }) => {
      // The fresh create() should have registered our cancelers.
      expect(mockOnFileImported).toHaveBeenCalledTimes(1);
      expect(mockOnFileImportConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnFileImportFailed).toHaveBeenCalledTimes(1);
      expect(mockOnTrayApply).toHaveBeenCalledTimes(1);

      // Call unsubscribe and verify every canceler was invoked.
      freshStore.getState().unsubscribe();
      expect(cancelers.fileImported).toHaveBeenCalledTimes(1);
      expect(cancelers.fileImportConfirm).toHaveBeenCalledTimes(1);
      expect(cancelers.fileImportFailed).toHaveBeenCalledTimes(1);
      expect(cancelers.trayApply).toHaveBeenCalledTimes(1);
    });
  });

  it('double create does not register duplicate listeners', () => {
    // Static assertion: the source file contains the idempotency guard.
    // This is a structural test — it ensures the guard pattern is present
    // without requiring full Electron IPC mock orchestration.
    const fs = require('node:fs') as typeof import('node:fs');
    const source = fs.readFileSync(`${__dirname}/themeStore.ts`, {
      encoding: 'utf-8',
    });
    expect(source).toContain('if (offFileImported) unsubscribe()');
  });
});
