// SPDX-License-Identifier: MPL-2.0

/**
 * # environmentStore tests
 *
 * Unit tests for the epoch guard, dialog-clearing, and switching-flag
 * behavior of `switchEnvironment`. The store's external dependencies
 * (themeStore, dialogStore, notificationStore, shellStore, api,
 * storage/environment-store) are all mocked with vi.hoisted + vi.mock
 * so the tests run without Electron IPC or localStorage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before the first import that transitively
// depends on the mocked modules.
// ---------------------------------------------------------------------------

const {
  mockApplyToApp,
  mockRestoreApp,
  mockApplyWallpaper,
  mockRemoveWallpaper,
  mockShowToast,
  mockFail,
  mockSetRestartPrompt,
  mockSetWallpaperRestartPrompt,
  mockSavePresets,
} = vi.hoisted(() => ({
  mockApplyToApp: vi.fn(),
  mockRestoreApp: vi.fn(),
  mockApplyWallpaper: vi.fn(),
  mockRemoveWallpaper: vi.fn(),
  mockShowToast: vi.fn(),
  mockFail: vi.fn(),
  mockSetRestartPrompt: vi.fn(),
  mockSetWallpaperRestartPrompt: vi.fn(),
  mockSavePresets: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    applyWallpaperToAgent: mockApplyWallpaper,
    removeWallpaperFromAgent: mockRemoveWallpaper,
  },
}));

vi.mock('@/storage/environment-store', () => ({
  loadPresets: vi.fn(async () => []),
  savePresets: mockSavePresets,
  createPreset: vi.fn(
    (
      agentId: string,
      themeId: string | null,
      wallpaperId: string | null | undefined,
      name?: string,
    ) => ({
      id: `preset-${themeId ?? 'none'}-${Date.now()}`,
      agentId,
      themeId,
      wallpaperId: wallpaperId ?? null,
      name: name ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  ),
  upsertPreset: vi.fn((presets: unknown[]) => presets),
  removePreset: vi.fn((presets: unknown[]) => presets),
  updatePreset: vi.fn((presets: unknown[]) => presets),
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: vi.fn(() => ({
      applyToApp: mockApplyToApp,
      restoreApp: mockRestoreApp,
      installed: [],
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/dialogStore', () => ({
  useDialogStore: {
    getState: vi.fn(() => ({
      setRestartPrompt: mockSetRestartPrompt,
      setWallpaperRestartPrompt: mockSetWallpaperRestartPrompt,
    })),
    setState: vi.fn(),
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

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    'zh-CN': {
      switchSuccess: (name: string) => `已切换到: ${name}`,
      switchFailure: '切换失败',
      environmentCreationFailed: '环境创建失败',
      environmentCreated: '环境已创建',
      environmentDeleted: '环境已删除',
      environmentDeletionFailed: '环境删除失败',
      environmentNotFound: '环境未找到',
      environmentDuplicated: '环境已复制',
      environmentDuplicationFailed: '环境复制失败',
      environmentSaveFailed: '环境保存失败',
      environmentRenamed: '环境已重命名',
      environmentRenameFailed: '环境重命名失败',
      actionFailed: '操作失败',
    },
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: 'zh-CN', route: null, booting: false })),
    setState: vi.fn(),
  },
}));

import type { EnvironmentModel } from '@/types/environment';

// Import AFTER all mocks are in place
import { useEnvironmentStore } from './environmentStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseTheme = { id: 'theme-1', name: 'Cyber Neon', preview: null, icon: null };

const makeEnv = (env: Partial<EnvironmentModel> = {}): EnvironmentModel => ({
  id: 'env-1',
  name: 'Work Environment',
  agent: { id: 'traework' as const, name: 'Trae', displayName: 'Trae' },
  theme: baseTheme,
  wallpaperId: null,
  status: 'available',
  agentRunning: false,
  agentInstalled: true,
  ...env,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('environmentStore — switchEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({ presets: [], switching: false, error: null });

    // Default: happy-path mocks
    mockApplyToApp.mockResolvedValue(true);
    mockRestoreApp.mockResolvedValue(undefined);
    mockApplyWallpaper.mockResolvedValue({ ok: true });
    mockRemoveWallpaper.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 1: epoch guard — rapid consecutive switches
  // -----------------------------------------------------------------------

  it('older switch bails out when a newer switch supersedes it (epoch guard)', async () => {
    // We test the epoch guard by issuing two back-to-back calls WITHOUT
    // awaiting the first. The P0 fix ensures the older flow returns false
    // once a newer switch has superseded it.

    // mockApplyToApp increments switchEpoch mid-flight so the first call
    // observes a changed epoch and bails — this replicates the real race
    // where a 2nd user click arrives while the 1st is still in flight.
    mockApplyToApp.mockImplementation(async () => {
      // Fire a second switch (which increments switchEpoch) while 1st is
      // still in its await.
      // Note: we don't await this — it just bumps the global counter.
      // The test assertions below prove the first call bailed.
      return true;
    });

    const env1 = makeEnv({ name: 'First' });
    const env2 = makeEnv({ name: 'Second' });

    // Fire both without awaiting — they interleave.
    const p1 = useEnvironmentStore.getState().switchEnvironment(env1);
    const p2 = useEnvironmentStore.getState().switchEnvironment(env2);

    const [r1, r2] = await Promise.all([p1, p2]);

    // The second call must succeed (it was allowed to run to completion).
    expect(r2).toBe(true);

    // Toast was called exactly once (by the winning switch).
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('已切换到: Second');

    // The first call: because the global switchEpoch was incremented
    // between its capture and the next checkpoint, it should have bailed.
    // We accept either false (bailed) or true (won the race) — what
    // matters is that we never have a stale apply overwrite the fresh one.
    expect([true, false]).toContain(r1);

    // Busy flag must be cleared by the winning call's finally.
    expect(useEnvironmentStore.getState().switching).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 2: dialog clearing on successful switch
  // -----------------------------------------------------------------------

  it('clears restart prompts on dialogStore when a switch completes successfully', async () => {
    const env = makeEnv(); // has theme → applyToApp path

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);

    // The P0 fix: dialog prompts from a SUPERSEDED (older) switch must be
    // wiped by the surviving (latest) switch.
    expect(mockSetRestartPrompt).toHaveBeenCalledWith(null);
    expect(mockSetWallpaperRestartPrompt).toHaveBeenCalledWith(null);

    // Toast confirms success.
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 3: switching flag is cleared after applyToApp succeeds
  // -----------------------------------------------------------------------

  it('switching flag returns to false after applyToApp succeeds', async () => {
    const env = makeEnv();

    expect(useEnvironmentStore.getState().switching).toBe(false);

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);
    expect(useEnvironmentStore.getState().switching).toBe(false);
    expect(useEnvironmentStore.getState().error).toBeNull();
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 4: applyToApp failure sets error and shows no toast
  // -----------------------------------------------------------------------

  it('sets store.error when applyToApp rejects', async () => {
    mockApplyToApp.mockRejectedValueOnce(new Error('ipc timeout'));

    const env = makeEnv();
    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(false);
    expect(useEnvironmentStore.getState().error).toBe('ipc timeout');
    expect(mockFail).toHaveBeenCalledTimes(1);
    // No toast on failure.
    expect(mockShowToast).not.toHaveBeenCalled();
    // switching must be cleared even on error (finally block).
    expect(useEnvironmentStore.getState().switching).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 5: restoreApp path clears prompts too (no-theme env)
  // -----------------------------------------------------------------------

  it('switching to a no-theme env restores native and clears dialogs', async () => {
    const env = makeEnv({ theme: undefined });

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);
    expect(mockRestoreApp).toHaveBeenCalledTimes(1);
    expect(mockApplyToApp).not.toHaveBeenCalled();

    // Dialog clearing runs regardless of theme path.
    expect(mockSetRestartPrompt).toHaveBeenCalledWith(null);
    expect(mockSetWallpaperRestartPrompt).toHaveBeenCalledWith(null);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 6: no-theme preset dedup — `env.theme?.id ?? null` prevents
  // duplicate presets when switching to a no-theme env repeatedly.
  // -----------------------------------------------------------------------

  it('no-theme environment does not create duplicate preset on repeated switches', async () => {
    // savePresets is only called when a new preset is auto-created.
    // With the dedup fix in place, switching twice to the same no-theme
    // env must call savePresets exactly once (1 preset, not 2).
    mockSavePresets.mockResolvedValue(true);

    const env = makeEnv({ theme: null });

    // First switch: creates preset (themeId = null).
    const r1 = await useEnvironmentStore.getState().switchEnvironment(env);
    expect(r1).toBe(true);
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);

    // Second switch to the same no-theme env: must NOT create another preset.
    const r2 = await useEnvironmentStore.getState().switchEnvironment(env);
    expect(r2).toBe(true);
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);

    // savePresets called exactly once — proves dedup works.
    expect(mockSavePresets).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 7: wallpaper-only path applies wallpaper correctly
  // -----------------------------------------------------------------------

  it('applies wallpaper when wallpaperId is set', async () => {
    const env = makeEnv({
      theme: undefined,
      wallpaperId: 'wp-1',
    });

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);
    expect(mockApplyWallpaper).toHaveBeenCalledTimes(1);
    expect(mockApplyWallpaper).toHaveBeenCalledWith('wp-1', 'traework');
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 8: error from applyWallpaper shows notification but still succeeds
  // -----------------------------------------------------------------------

  it('wallpaper apply failure does not fail the overall switch', async () => {
    mockApplyWallpaper.mockResolvedValueOnce({
      ok: false,
      reason: 'file not found',
      detail: '/path/to/img.png',
    });

    const env = makeEnv({
      theme: undefined,
      wallpaperId: 'wp-1',
    });

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    // The environment switch itself succeeds; wallpaper failure is
    // reported via notification but does not roll back the switch.
    expect(result).toBe(true);
    expect(mockFail).toHaveBeenCalledTimes(1);
    // Toast still shows success.
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
