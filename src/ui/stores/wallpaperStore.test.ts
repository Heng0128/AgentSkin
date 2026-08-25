// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaperStore tests — applyWallpaper Toast behavior
 *
 * Verifies that wallpaper-application operations delegate to the notification
 * system correctly:
 * - Error paths invoke `fail()` (destructive toast) with the underlying error.
 * - Success paths do NOT show a toast (the store updates state silently).
 * - The companion flow (wallpaper → theme → re-apply) reports theme-extract
 *   failures via `fail()` without rolling back the wallpaper apply.
 *
 * External modules (`api`, `notificationStore`, `themeStore`, `event-bus`)
 * are mocked via vi.hoisted + vi.mock so tests run without Electron IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockListWallpapers,
  mockGetSettings,
  mockSetWallpaper,
  mockImportWallpaper,
  mockDeleteWallpaper,
  mockSetAgentWallpaper,
  mockApplyAgentWallpaper,
  mockExtractThemeFromWallpaper,
  mockApplyToApp,
  mockFail,
  mockShowToast,
} = vi.hoisted(() => ({
  mockListWallpapers: vi.fn(),
  mockGetSettings: vi.fn(),
  mockSetWallpaper: vi.fn(),
  mockImportWallpaper: vi.fn(),
  mockDeleteWallpaper: vi.fn(),
  mockSetAgentWallpaper: vi.fn(),
  mockApplyAgentWallpaper: vi.fn(),
  mockExtractThemeFromWallpaper: vi.fn(),
  mockApplyToApp: vi.fn(),
  mockFail: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listWallpapers: mockListWallpapers,
    getSettings: mockGetSettings,
    setWallpaper: mockSetWallpaper,
    importWallpaper: mockImportWallpaper,
    deleteWallpaper: mockDeleteWallpaper,
    setAgentWallpaper: mockSetAgentWallpaper,
    applyAgentWallpaper: mockApplyAgentWallpaper,
    extractThemeFromWallpaper: mockExtractThemeFromWallpaper,
    catalog: { themes: { list: vi.fn(), get: vi.fn() } },
    listBundles: vi.fn(),
    importBundle: vi.fn(),
    installBundleById: vi.fn(),
    deleteBundle: vi.fn(),
    listStudioProjects: vi.fn(),
    createStudioProject: vi.fn(),
    deleteStudioProject: vi.fn(),
    saveStudioProject: vi.fn(),
    loadStudioSnapshot: vi.fn(),
    saveStudioSnapshot: vi.fn(),
    snapshotBaseline: vi.fn(),
    snapshotThemeDom: vi.fn(),
    restoreApp: vi.fn(),
    startInspect: vi.fn(),
    stopInspect: vi.fn(),
    exportStudioTheme: vi.fn(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      fail: mockFail,
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: vi.fn(() => ({
      applyToApp: mockApplyToApp,
    })),
  },
}));

vi.mock('./event-bus', () => ({
  onEnvEvent: vi.fn(() => () => undefined),
  emitEnvEvent: vi.fn(),
}));

// Import AFTER all mocks are in place
import type { WallpaperAgentSetting } from '@shared/types';
import { AGENT_IDS, type AgentId } from '@shared/types';
import { useWallpaperStore } from './wallpaperStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal settings shape accepted by the store after `getSettings`. */
function mockSettings(overrides?: {
  enabled?: boolean;
  id?: string | null;
  agents?: Record<AgentId, WallpaperAgentSetting>;
}) {
  return {
    wallpaper: {
      enabled: overrides?.enabled ?? false,
      id: overrides?.id ?? null,
      agents: overrides?.agents ?? defaultAgentWallpapers(),
    },
  };
}

function defaultAgentWallpapers(): Record<AgentId, WallpaperAgentSetting> {
  const result = {} as Record<AgentId, WallpaperAgentSetting>;
  for (const id of AGENT_IDS) result[id] = { enabled: false, id: null };
  return result;
}

const resetStore = () => {
  useWallpaperStore.setState({
    wallpapers: [],
    enabled: false,
    selectedId: null,
    agentWallpapers: defaultAgentWallpapers(),
    render: undefined,
    loading: true,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wallpaperStore — Toast notification behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetStore();

    // Default: getSettings returns empty, listWallpapers returns empty.
    mockGetSettings.mockResolvedValueOnce(mockSettings());
    mockListWallpapers.mockResolvedValueOnce([]);
    await useWallpaperStore.getState().initialize();
    // Clear mocks used by initialize so test assertions start clean.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. setWallpaper — error path triggers fail()
  // -----------------------------------------------------------------------

  it('setWallpaper calls fail() on API error', async () => {
    const error = new Error('ipc:setWallpaper failed');
    mockSetWallpaper.mockRejectedValueOnce(error);

    await useWallpaperStore.getState().setWallpaper(true, 'wp-001');

    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    // Must NOT show any success toast on the error path.
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('setWallpaper does NOT show a success toast when the API succeeds', async () => {
    mockSetWallpaper.mockResolvedValueOnce(mockSettings({ enabled: true, id: 'wp-001' }));

    await useWallpaperStore.getState().setWallpaper(true, 'wp-001');

    // Success = silent state update, no toast.
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
    // State reflects the persisted result.
    expect(useWallpaperStore.getState().enabled).toBe(true);
    expect(useWallpaperStore.getState().selectedId).toBe('wp-001');
  });

  // -----------------------------------------------------------------------
  // 2. importWallpaper — error path triggers fail()
  // -----------------------------------------------------------------------

  it('importWallpaper calls fail() on API error', async () => {
    const error = new Error('file dialog cancelled');
    mockImportWallpaper.mockRejectedValueOnce(error);

    await useWallpaperStore.getState().importWallpaper();

    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('importWallpaper extracts items from { ok: true, items } response', async () => {
    const imported = [{ id: 'wp-new', title: 'new', type: 'image' }] as ReturnType<
      typeof mockListWallpapers
    >;
    mockImportWallpaper.mockResolvedValueOnce({ ok: true, items: imported });

    await useWallpaperStore.getState().importWallpaper();

    // wallpapers 必须是数组，不能是 { ok, items } 对象
    expect(Array.isArray(useWallpaperStore.getState().wallpapers)).toBe(true);
    expect(useWallpaperStore.getState().wallpapers).toHaveLength(1);
    expect(useWallpaperStore.getState().wallpapers[0].id).toBe('wp-new');
    expect(mockFail).not.toHaveBeenCalled();
  });

  it('importWallpaper handles bare-array response (dialog cancelled)', async () => {
    const current = [{ id: 'wp-existing', title: 'existing', type: 'video' }] as ReturnType<
      typeof mockListWallpapers
    >;
    mockImportWallpaper.mockResolvedValueOnce(current);

    await useWallpaperStore.getState().importWallpaper();

    expect(Array.isArray(useWallpaperStore.getState().wallpapers)).toBe(true);
    expect(useWallpaperStore.getState().wallpapers).toHaveLength(1);
    expect(useWallpaperStore.getState().wallpapers[0].id).toBe('wp-existing');
    expect(mockFail).not.toHaveBeenCalled();
  });

  it('importWallpaper does not mutate list on { ok: false } response and reports error', async () => {
    mockImportWallpaper.mockResolvedValueOnce({ ok: false, error: 'import failed' });

    await useWallpaperStore.getState().importWallpaper();

    // 失败时保持初始空列表
    expect(useWallpaperStore.getState().wallpapers).toEqual([]);
    // ok=false 带 error 信息时应通知用户
    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({ message: 'import failed' }));
  });

  // -----------------------------------------------------------------------
  // 3. deleteWallpaper — error path triggers fail()
  // -----------------------------------------------------------------------

  it('deleteWallpaper calls fail() on API error', async () => {
    const error = new Error('delete failed');
    mockDeleteWallpaper.mockRejectedValueOnce(error);

    await useWallpaperStore.getState().deleteWallpaper('wp-001');

    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 4. setAgentWallpaper — error path triggers fail()
  // -----------------------------------------------------------------------

  it('setAgentWallpaper calls fail() on API error and returns false', async () => {
    const error = new Error('agent not found');
    mockSetAgentWallpaper.mockRejectedValueOnce(error);

    const result = await useWallpaperStore.getState().setAgentWallpaper('traework', true, 'wp-001');

    expect(result).toBe(false);
    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('setAgentWallpaper returns true and does not call toast on success', async () => {
    mockSetAgentWallpaper.mockResolvedValueOnce(mockSettings());

    const result = await useWallpaperStore.getState().setAgentWallpaper('traework', true, 'wp-001');

    expect(result).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. setAndApplyAgentWallpaper — persist-failed path (no injection)
  // -----------------------------------------------------------------------

  it('setAndApplyAgentWallpaper returns persist-failed and does not show toast when persist fails', async () => {
    const error = new Error('disk full');
    mockSetAgentWallpaper.mockRejectedValueOnce(error);

    const result = await useWallpaperStore
      .getState()
      .setAndApplyAgentWallpaper('traework', true, 'wp-001');

    // Persist failure → no apply attempt, no companion loop.
    expect(result).toEqual({ ok: false, reason: 'persist-failed' });
    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    // applyAgentWallpaper must NOT have been called.
    expect(mockApplyAgentWallpaper).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 6. activateThemeWallpaper — error path triggers fail()
  // -----------------------------------------------------------------------

  it('activateThemeWallpaper calls fail() on listWallpapers error', async () => {
    const error = new Error('wallpaper engine unavailable');
    mockListWallpapers.mockRejectedValueOnce(error);

    await useWallpaperStore.getState().activateThemeWallpaper('theme-amber');

    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(error);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 6b. activateThemeWallpaper — theme-apply linkage (appId)
  // -----------------------------------------------------------------------

  it('activateThemeWallpaper persists preferences WITHOUT injection (R1 Single Injector)', async () => {
    // listWallpapers returns the bundled wallpaper for this theme.
    mockListWallpapers.mockResolvedValueOnce([
      { id: 'theme:theme-amber', title: 'Amber', projectType: 'video' },
    ]);
    mockSetWallpaper.mockResolvedValueOnce(
      mockSettings({ enabled: true, id: 'theme:theme-amber' }),
    );
    mockSetAgentWallpaper.mockResolvedValueOnce(mockSettings());

    const result = await useWallpaperStore
      .getState()
      .activateThemeWallpaper('theme-amber', undefined, 'traework');

    // Global preference set (api.setWallpaper receives { enabled, id, render }).
    expect(mockSetWallpaper).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, id: 'theme:theme-amber' }),
    );
    // Per-agent preference persisted (api.setAgentWallpaper(appId, { enabled, id, render })).
    expect(mockSetAgentWallpaper).toHaveBeenCalledWith(
      'traework',
      expect.objectContaining({ enabled: true, id: 'theme:theme-amber' }),
    );
    // R1: NO renderer-side CDP injection — the main-process apply flow owns it.
    expect(mockApplyAgentWallpaper).not.toHaveBeenCalled();
    // Preference-only: no apply result to return.
    expect(result).toBeUndefined();
    // No failure reported.
    expect(mockFail).not.toHaveBeenCalled();
  });

  it('activateThemeWallpaper does NOT inject when per-agent persist fails', async () => {
    mockListWallpapers.mockResolvedValueOnce([
      { id: 'theme:theme-amber', title: 'Amber', projectType: 'video' },
    ]);
    mockSetWallpaper.mockResolvedValueOnce(
      mockSettings({ enabled: true, id: 'theme:theme-amber' }),
    );
    // Per-agent persist fails.
    mockSetAgentWallpaper.mockRejectedValueOnce(new Error('disk full'));

    await useWallpaperStore.getState().activateThemeWallpaper('theme-amber', undefined, 'traework');

    // Global preference still set.
    expect(mockSetWallpaper).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, id: 'theme:theme-amber' }),
    );
    // Injection must NOT happen without a persisted setting.
    expect(mockApplyAgentWallpaper).not.toHaveBeenCalled();
    // Failure reported.
    expect(mockFail).toHaveBeenCalledTimes(1);
  });

  it('activateThemeWallpaper backward-compatible: no appId → only global preference', async () => {
    mockListWallpapers.mockResolvedValueOnce([
      { id: 'theme:theme-amber', title: 'Amber', projectType: 'video' },
    ]);
    mockSetWallpaper.mockResolvedValueOnce(
      mockSettings({ enabled: true, id: 'theme:theme-amber' }),
    );

    await useWallpaperStore.getState().activateThemeWallpaper('theme-amber');

    // Only global preference set — no per-agent calls.
    expect(mockSetWallpaper).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, id: 'theme:theme-amber' }),
    );
    expect(mockSetAgentWallpaper).not.toHaveBeenCalled();
    expect(mockApplyAgentWallpaper).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 7. Companion flow — theme extract failure reports via fail()
  // -----------------------------------------------------------------------

  it('setAndApplyAgentWallpaper calls fail() when theme extraction fails', async () => {
    // Step 1: persist succeeds.
    mockSetAgentWallpaper.mockResolvedValueOnce(mockSettings());
    // Step 2: apply succeeds.
    mockApplyAgentWallpaper.mockResolvedValueOnce({ ok: true });
    // Step 3: theme extraction fails.
    const themeError = new Error('palette extraction timeout');
    mockExtractThemeFromWallpaper.mockRejectedValueOnce(themeError);

    const result = await useWallpaperStore
      .getState()
      .setAndApplyAgentWallpaper('traework', true, 'wp-001');

    // The original wallpaper apply still succeeded.
    expect(result.ok).toBe(true);
    // Theme-extract failure is reported via fail() without rolling back.
    expect(mockFail).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(themeError);
    // No success toast from the companion path.
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('setAndApplyAgentWallpaper does not enter the companion loop when apply fails', async () => {
    mockSetAgentWallpaper.mockResolvedValueOnce(mockSettings());
    mockApplyAgentWallpaper.mockResolvedValueOnce({ ok: false, reason: 'agent-not-running' });

    const result = await useWallpaperStore
      .getState()
      .setAndApplyAgentWallpaper('traework', true, 'wp-001');

    expect(result.ok).toBe(false);
    // Companion loop is gated on result.ok === true.
    expect(mockExtractThemeFromWallpaper).not.toHaveBeenCalled();
    // No fail() either — the apply result is returned to the caller.
    expect(mockFail).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('setAndApplyAgentWallpaper does not enter the companion loop when disabled', async () => {
    // Persist succeeds for a DISABLED wallpaper (user is turning it off).
    mockSetAgentWallpaper.mockResolvedValueOnce(mockSettings());
    mockApplyAgentWallpaper.mockResolvedValueOnce({ ok: true });

    const result = await useWallpaperStore.getState().setAndApplyAgentWallpaper(
      'traework',
      false, // disabled
      null,
    );

    expect(result.ok).toBe(true);
    // Companion loop is gated on nextEnabled && nextId.
    expect(mockExtractThemeFromWallpaper).not.toHaveBeenCalled();
    expect(mockFail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 8. Toast invariant: wallpaperStore never calls showToast directly
  //    (all user feedback is error-only via fail()).
  // -----------------------------------------------------------------------

  it('never calls showToast across any operation — error-only feedback', async () => {
    // Run a mix of success and error operations.
    mockSetWallpaper.mockRejectedValueOnce(new Error('fail1'));
    await useWallpaperStore.getState().setWallpaper(true, 'wp-001');

    mockDeleteWallpaper.mockRejectedValueOnce(new Error('fail2'));
    await useWallpaperStore.getState().deleteWallpaper('wp-001');

    mockSetAgentWallpaper.mockRejectedValueOnce(new Error('fail3'));
    await useWallpaperStore.getState().setAgentWallpaper('traework', true, 'wp-001');

    // Across all error paths, only fail() is called — never showToast.
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledTimes(3);
  });
});
