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

// Type-only import placed before mocks so mock factories can reference it
// (vitest hoists vi.mock to file top, but TSC needs the type in scope).
import type { EnvironmentPreset } from '@shared/types/environment';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before the first import that transitively
// depends on the mocked modules.
// ---------------------------------------------------------------------------

const {
  mockApplyToApp,
  mockRestoreApp,
  mockSetAndApplyAgentWallpaper,
  mockShowToast,
  mockFail,
  mockSetRestartPrompt,
  mockSetWallpaperRestartPrompt,
  mockSavePresets,
} = vi.hoisted(() => ({
  mockApplyToApp: vi.fn(),
  mockRestoreApp: vi.fn(),
  mockSetAndApplyAgentWallpaper: vi.fn(),
  mockShowToast: vi.fn(),
  mockFail: vi.fn(),
  mockSetRestartPrompt: vi.fn(),
  mockSetWallpaperRestartPrompt: vi.fn(),
  mockSavePresets: vi.fn(),
}));

// REQ-I-008: api mock removed — wallpaper ops now delegated to wallpaperStore

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
  // Real upsert: append new preset if no match, else update existing
  upsertPreset: vi.fn(
    (
      presets: EnvironmentPreset[],
      agentId: string,
      themeId: string | null,
      wallpaperId: string | null | undefined,
      name?: string,
    ) => {
      const existing = presets.find((p) => p.agentId === agentId && p.themeId === themeId);
      if (existing) {
        return presets.map((p) =>
          p.id === existing.id ? { ...p, name, themeId, wallpaperId } : p,
        );
      }
      return [
        ...presets,
        {
          id: `preset-${themeId ?? 'none'}-${Date.now()}`,
          agentId,
          themeId,
          wallpaperId: wallpaperId ?? null,
          name: name ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    },
  ),
  removePreset: vi.fn((presets: EnvironmentPreset[], presetId: string) =>
    presets.filter((p) => p.id !== presetId),
  ),
  updatePreset: vi.fn(
    (presets: EnvironmentPreset[], presetId: string, updates: Partial<EnvironmentPreset>) =>
      presets.map((p) => (p.id === presetId ? { ...p, ...updates } : p)),
  ),
}));

// Mutable state for themeStore mock — tests can update `installed` via
// useThemeStore.setState() and have it reflected in getState().
const themeStoreState = {
  applyToApp: mockApplyToApp,
  restoreApp: mockRestoreApp,
  installed: [] as Array<{ id: string; name: string; preview: null; icon: null }>,
};

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: vi.fn(() => themeStoreState),
    setState: vi.fn((partial: Partial<typeof themeStoreState>) => {
      Object.assign(themeStoreState, partial);
    }),
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

// REQ-I-008: Mock wallpaperStore — environmentStore now delegates wallpaper ops to it.
vi.mock('@/stores/wallpaperStore', () => ({
  useWallpaperStore: {
    getState: vi.fn(() => ({
      setAndApplyAgentWallpaper: mockSetAndApplyAgentWallpaper,
      initialize: vi.fn().mockResolvedValue(undefined),
    })),
    setState: vi.fn(),
  },
}));

import type { ThemeState } from '@/stores/themeStore';
// Import AFTER all mocks are in place
import { useThemeStore } from '@/stores/themeStore';

import type { EnvironmentModel } from '@shared/types/environment';
import { resetSwitchEpochGuard, useEnvironmentStore } from './environmentStore';

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
    resetSwitchEpochGuard();
    // Reset mutable themeStore mock state
    themeStoreState.installed = [];
    themeStoreState.applyToApp = mockApplyToApp;
    themeStoreState.restoreApp = mockRestoreApp;

    // Default: happy-path mocks
    mockApplyToApp.mockResolvedValue(true);
    mockRestoreApp.mockResolvedValue(undefined);
    // REQ-I-008: wallpaper ops now go through wallpaperStore.setAndApplyAgentWallpaper
    mockSetAndApplyAgentWallpaper.mockResolvedValue({ ok: true });
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 1: epoch guard — rapid consecutive switches
  // -----------------------------------------------------------------------

  it('older switch bails out when a newer switch supersedes it (epoch guard)', async () => {
    // We test the epoch guard by having the mock trigger a concurrent
    // switchEnvironment call during the first applyToApp await. This
    // increments the epoch counter, causing the first call to bail at
    // its next epoch checkpoint.
    // First call: trigger a concurrent switch that increments the epoch
    mockApplyToApp.mockImplementationOnce(async () => {
      void useEnvironmentStore.getState().switchEnvironment(makeEnv({ name: 'Concurrent' }));
      return true;
    });
    // Second call (from the nested switch): just return true
    mockApplyToApp.mockResolvedValue(true);

    const env1 = makeEnv({ name: 'First' });
    const r1 = await useEnvironmentStore.getState().switchEnvironment(env1);

    // The first call should have bailed because the epoch changed mid-flight.
    expect(r1).toBe(false);

    // Flush all pending macrotasks so the nested call's finally block runs
    // before we check the switching flag. The nested call is `void` (not
    // awaited) so its finally may still be pending.
    await new Promise<void>((resolve) => setImmediate(resolve));

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
  // MUST-HAVE 7 (REQ-I-008): wallpaper path delegates to wallpaperStore
  // -----------------------------------------------------------------------

  it('delegates wallpaper apply to wallpaperStore when wallpaperId is set', async () => {
    const env = makeEnv({
      theme: undefined,
      wallpaperId: 'wp-1',
    });

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);
    // REQ-I-008: wallpaper ops now delegated to wallpaperStore.setAndApplyAgentWallpaper
    expect(mockSetAndApplyAgentWallpaper).toHaveBeenCalledTimes(1);
    expect(mockSetAndApplyAgentWallpaper).toHaveBeenCalledWith('traework', true, 'wp-1');
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 8 + remove path: wallpaper op via wallpaperStore
  // -----------------------------------------------------------------------

  it('delegates wallpaper removal to wallpaperStore when no wallpaper bound', async () => {
    const env = makeEnv({ theme: undefined, wallpaperId: null });

    const result = await useEnvironmentStore.getState().switchEnvironment(env);

    expect(result).toBe(true);
    // setAndApplyAgentWallpaper(appId, false, null) removes the wallpaper
    expect(mockSetAndApplyAgentWallpaper).toHaveBeenCalledWith('traework', false, null);
  });

  it('wallpaper apply failure does not fail the overall switch', async () => {
    mockSetAndApplyAgentWallpaper.mockResolvedValueOnce({
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

  // -----------------------------------------------------------------------
  // REQ-I-010: purgeTheme removes presets referencing a deleted theme
  // -----------------------------------------------------------------------

  it('purgeTheme removes presets referencing the deleted theme', () => {
    useEnvironmentStore.setState({
      presets: [
        {
          id: 'p1',
          agentId: 'traework',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'A',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'p2',
          agentId: 'traework',
          themeId: 'theme-2',
          wallpaperId: null,
          name: 'B',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'p3',
          agentId: 'qoderwork',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'C',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    useEnvironmentStore.getState().purgeTheme('theme-1');

    const remaining = useEnvironmentStore.getState().presets;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('p2');
    expect(remaining[0].themeId).toBe('theme-2');
  });

  it('purgeTheme is a no-op when no presets reference the theme', () => {
    useEnvironmentStore.setState({
      presets: [
        {
          id: 'p1',
          agentId: 'traework',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'A',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    useEnvironmentStore.getState().purgeTheme('nonexistent');

    expect(useEnvironmentStore.getState().presets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mutation function tests — covering create/delete/duplicate/rename
// ---------------------------------------------------------------------------

describe('environmentStore — createEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({ presets: [], switching: false, error: null });
    resetSwitchEpochGuard();
    mockSavePresets.mockResolvedValue(true);
  });

  it('creates a preset and updates in-memory state on success', async () => {
    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('traework', 'theme-1', null, 'My Env', false);

    expect(result.success).toBe(true);
    expect(result.preset).not.toBeNull();
    expect(result.preset?.name).toBe('My Env');
    expect(result.preset?.agentId).toBe('traework');
    expect(result.preset?.themeId).toBe('theme-1');
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);
    expect(mockSavePresets).toHaveBeenCalledOnce();
    expect(mockShowToast).toHaveBeenCalledOnce();
  });

  it('does NOT update in-memory state when savePresets fails', async () => {
    mockSavePresets.mockResolvedValue(false);

    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('traework', 'theme-1', null, 'Fail Env', false);

    expect(result.success).toBe(false);
    expect(result.preset).toBeNull();
    expect(useEnvironmentStore.getState().presets).toHaveLength(0);
    expect(useEnvironmentStore.getState().error).toBe('环境创建失败');
  });

  it('notifies user via .fail() on exception', async () => {
    mockSavePresets.mockRejectedValue(new Error('disk full'));

    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('traework', 'theme-1', null, 'Error Env', false);

    expect(result.success).toBe(false);
    expect(mockFail).toHaveBeenCalledOnce();
  });

  it('with applyNow=true: rolls back preset if applyToApp fails', async () => {
    // The applyNow path requires the theme to be in store.installed
    const theme = { id: 'theme-1', name: 'Cyber Neon', preview: null, icon: null };
    useThemeStore.setState({
      installed: [theme],
    } as Partial<ThemeState>);
    mockApplyToApp.mockResolvedValue(false);

    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('traework', 'theme-1', null, 'Apply Fail', true);

    expect(result.success).toBe(false);
    // Preset was rolled back from store
    expect(useEnvironmentStore.getState().presets).toHaveLength(0);
  });

  it('with applyNow=true: keeps preset if applyToApp succeeds', async () => {
    mockApplyToApp.mockResolvedValue(true);

    const result = await useEnvironmentStore
      .getState()
      .createEnvironment('traework', 'theme-1', null, 'Apply OK', true);

    expect(result.success).toBe(true);
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);
  });
});

describe('environmentStore — deleteEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({
      presets: [
        {
          id: 'p1',
          agentId: 'traework',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'ToDelete',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      switching: false,
      error: null,
    });
    resetSwitchEpochGuard();
    mockSavePresets.mockResolvedValue(true);
  });

  it('removes preset and notifies on success', async () => {
    const result = await useEnvironmentStore.getState().deleteEnvironment('p1');

    expect(result).toBe(true);
    expect(useEnvironmentStore.getState().presets).toHaveLength(0);
    expect(mockShowToast).toHaveBeenCalledOnce();
  });

  it('returns false when savePresets fails', async () => {
    mockSavePresets.mockResolvedValue(false);

    const result = await useEnvironmentStore.getState().deleteEnvironment('p1');

    expect(result).toBe(false);
    // Preset stays in store when persist fails
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);
  });

  it('notifies via .fail() on exception', async () => {
    mockSavePresets.mockRejectedValue(new Error('io error'));

    const result = await useEnvironmentStore.getState().deleteEnvironment('p1');

    expect(result).toBe(false);
    expect(mockFail).toHaveBeenCalledOnce();
  });
});

describe('environmentStore — duplicateEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({
      presets: [
        {
          id: 'p1',
          agentId: 'traework',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'Original',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      switching: false,
      error: null,
    });
    resetSwitchEpochGuard();
    mockSavePresets.mockResolvedValue(true);
  });

  it('creates a copy with new name and preserves source fields', async () => {
    const result = await useEnvironmentStore.getState().duplicateEnvironment('p1', 'Copy');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Copy');
    expect(result?.agentId).toBe('traework');
    expect(result?.themeId).toBe('theme-1');
    expect(useEnvironmentStore.getState().presets).toHaveLength(2);
    expect(mockShowToast).toHaveBeenCalledOnce();
  });

  it('returns null when source preset not found', async () => {
    const result = await useEnvironmentStore.getState().duplicateEnvironment('nonexistent', 'Copy');

    expect(result).toBeNull();
    expect(useEnvironmentStore.getState().presets).toHaveLength(1);
  });

  it('returns null and notifies when savePresets rejects', async () => {
    // Rejecting (not just returning false) triggers the onFailure callback
    mockSavePresets.mockRejectedValue(new Error('io error'));

    const result = await useEnvironmentStore.getState().duplicateEnvironment('p1', 'Copy');

    expect(result).toBeNull();
    expect(mockFail).toHaveBeenCalledOnce();
  });

  it('notifies via .fail() on exception', async () => {
    mockSavePresets.mockRejectedValue(new Error('write error'));

    const result = await useEnvironmentStore.getState().duplicateEnvironment('p1', 'Copy');

    expect(result).toBeNull();
    expect(mockFail).toHaveBeenCalledOnce();
  });
});

describe('environmentStore — renameEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEnvironmentStore.setState({
      presets: [
        {
          id: 'p1',
          agentId: 'traework',
          themeId: 'theme-1',
          wallpaperId: null,
          name: 'Original',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ],
      switching: false,
      error: null,
    });
    resetSwitchEpochGuard();
    mockSavePresets.mockResolvedValue(true);
  });

  it('renames preset and notifies on success', async () => {
    const result = await useEnvironmentStore.getState().renameEnvironment('p1', 'Renamed');

    expect(result).toBe(true);
    expect(useEnvironmentStore.getState().presets[0].name).toBe('Renamed');
    expect(mockShowToast).toHaveBeenCalledOnce();
  });

  it('rejects names exceeding 512 chars without calling savePresets', async () => {
    const longName = 'x'.repeat(513);
    const result = await useEnvironmentStore.getState().renameEnvironment('p1', longName);

    expect(result).toBe(false);
    expect(mockSavePresets).not.toHaveBeenCalled();
    expect(useEnvironmentStore.getState().presets[0].name).toBe('Original');
  });

  it('returns false when savePresets fails but keeps original name', async () => {
    mockSavePresets.mockResolvedValue(false);

    const result = await useEnvironmentStore.getState().renameEnvironment('p1', 'NewName');

    expect(result).toBe(false);
    expect(useEnvironmentStore.getState().presets[0].name).toBe('Original');
  });

  it('notifies via .fail() on exception', async () => {
    mockSavePresets.mockRejectedValue(new Error('disk error'));

    const result = await useEnvironmentStore.getState().renameEnvironment('p1', 'NewName');

    expect(result).toBe(false);
    expect(mockFail).toHaveBeenCalledOnce();
  });
});
