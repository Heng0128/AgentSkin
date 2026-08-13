// SPDX-License-Identifier: MPL-2.0

/**
 * # studioStore tests — loadProjectSnapshots snapshotError behavior
 *
 * Verifies that the `loadProjectSnapshots` action correctly captures and exposes
 * API failures via `snapshotError` (instead of silently swallowing them):
 * - Initial state has `snapshotError === null`.
 * - Error instances → `snapshotError` is the Error's `.message`.
 * - Non-Error values → `snapshotError` is the string form.
 * - Recovery sequence: failure then success → `snapshotError` cleared to null.
 * - Stale-guard: `activeProjectId` changed mid-load → no `snapshotError` set.
 * - No-project guard: resets state, does NOT call API.
 * - Loading transitions: `snapshotLoading` true→false on both paths.
 * - Failure clears `snapshotThemeName` to empty string.
 *
 * External modules (`@/api/agentSkinClient`, `@/stores/notificationStore`,
 * `@/stores/shellStore`) are mocked via `vi.hoisted` + `vi.mock` so tests run
 * without Electron IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadStudioSnapshot,
  mockShowToast,
} = vi.hoisted(() => ({
  mockLoadStudioSnapshot: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    loadStudioSnapshot: mockLoadStudioSnapshot,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({
      locale: 'zh' as const,
    })),
  },
}));

// Import AFTER all mocks are in place
import type { StudioProject, ThemeVisualSnapshot } from '@shared/types';
import { useStudioStore } from './studioStore';

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

/** Minimal StudioProject fixture accepted by the store. */
const mockProject: StudioProject = {
  schema: 'agentskin-studio-project/v1',
  id: 'proj-001',
  name: 'Test Project',
  author: 'Test Author',
  agentId: 'traework',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  hasSnapshot: false,
};

/** Minimal ThemeVisualSnapshot fixture for successful API resolution. */
const mockSnapshot: ThemeVisualSnapshot = {
  themeId: 'theme-001',
  themeName: 'My Theme',
  agentId: 'traework',
  timestamp: '2025-01-01T00:00:00.000Z',
  landmarks: [],
  summary: {
    totalLandmarks: 0,
    visibleLandmarks: 0,
    selectorsTried: 0,
    boxModelAvailable: false,
    cascadeAvailable: false,
  },
};

/** Reset store to a clean slate before each test. */
const resetStore = () => {
  useStudioStore.setState({
    projects: [],
    activeProjectId: null,
    snapshot: null,
    snapshotLoading: false,
    snapshotError: null,
    snapshotThemeName: '',
    baselines: {},
    baselineLoadingMap: {},
    baselineErrorMap: {},
    exportName: '',
    exportAuthor: '',
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('studioStore — loadProjectSnapshots snapshotError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Initial state: snapshotError is null when no project is active
  // -----------------------------------------------------------------------

  it('initializes snapshotError as null when no project is active', () => {
    expect(useStudioStore.getState().snapshotError).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 2. Error instance → snapshotError is Error.message
  // -----------------------------------------------------------------------

  it('sets snapshotError to Error.message when api.loadStudioSnapshot rejects with Error', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    const error = new Error('ipc:loadStudioSnapshot timeout');
    mockLoadStudioSnapshot.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    await useStudioStore.getState().loadProjectSnapshots();

    expect(useStudioStore.getState().snapshotError).toBe('ipc:loadStudioSnapshot timeout');
  });

  // -----------------------------------------------------------------------
  // 3. Non-Error value → snapshotError is string form
  // -----------------------------------------------------------------------

  it('stringifies non-Error thrown values into snapshotError', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    mockLoadStudioSnapshot.mockRejectedValueOnce('raw string rejection');

    await useStudioStore.getState().loadProjectSnapshots();

    expect(useStudioStore.getState().snapshotError).toBe('raw string rejection');
  });

  // -----------------------------------------------------------------------
  // 4. Recovery sequence: failure then success → snapshotError cleared
  // -----------------------------------------------------------------------

  it('clears snapshotError to null after a failure followed by a successful load', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    // First call: failure
    const error = new Error('first failure');
    mockLoadStudioSnapshot.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    await useStudioStore.getState().loadProjectSnapshots();
    expect(useStudioStore.getState().snapshotError).toBe('first failure');

    // Second call: success
    mockLoadStudioSnapshot
      .mockResolvedValueOnce(mockSnapshot)
      .mockResolvedValueOnce(mockSnapshot);
    await useStudioStore.getState().loadProjectSnapshots();
    expect(useStudioStore.getState().snapshotError).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 5. Stale-guard: activeProjectId changed mid-load → no snapshotError set
  // -----------------------------------------------------------------------

  it('does not set snapshotError when activeProjectId changes during load (stale guard)', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    // Create a deferred promise so we can control resolution timing.
    let rejectApi!: (reason: any) => void;
    mockLoadStudioSnapshot.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectApi = reject;
        }),
    );

    // Start loading (do not await yet).
    const loadPromise = useStudioStore.getState().loadProjectSnapshots();

    // Mutate activeProjectId before the API resolves — simulates user switching projects.
    useStudioStore.setState({ activeProjectId: 'other-project' });

    // Now reject the API call.
    rejectApi(new Error('should be ignored'));

    await loadPromise;

    // The stale guard early-returns; snapshotError stays as the initial null
    // set by the loading transition (catch block never runs).
    expect(useStudioStore.getState().snapshotError).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 6. No-project guard: resets state, does NOT call API
  // -----------------------------------------------------------------------

  it('resets snapshotError/snapshotLoading to initial values and does not call API when no project is active', async () => {
    // Start from a state that has stale error/loading set.
    useStudioStore.setState({
      projects: [],
      activeProjectId: null,
      snapshotError: 'stale error',
      snapshotLoading: true,
      snapshotThemeName: 'stale-theme',
    });

    await useStudioStore.getState().loadProjectSnapshots();

    // State is reset to initial values.
    expect(useStudioStore.getState().snapshotError).toBeNull();
    expect(useStudioStore.getState().snapshotLoading).toBe(false);
    expect(useStudioStore.getState().snapshotThemeName).toBe('');
    // API must NOT have been called.
    expect(mockLoadStudioSnapshot).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 7. Loading transitions: snapshotLoading true→false on both paths
  // -----------------------------------------------------------------------

  it('transitions snapshotLoading from true to false after a failed load', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    mockLoadStudioSnapshot.mockRejectedValueOnce(new Error('fail'));

    await useStudioStore.getState().loadProjectSnapshots();

    expect(useStudioStore.getState().snapshotLoading).toBe(false);
  });

  it('transitions snapshotLoading from true to false after a successful load', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
    });

    mockLoadStudioSnapshot
      .mockResolvedValueOnce(mockSnapshot)
      .mockResolvedValueOnce(mockSnapshot);

    await useStudioStore.getState().loadProjectSnapshots();

    expect(useStudioStore.getState().snapshotLoading).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 8. Failure clears snapshotThemeName to empty string
  // -----------------------------------------------------------------------

  it('clears snapshotThemeName to empty string when load fails', async () => {
    useStudioStore.setState({
      projects: [mockProject],
      activeProjectId: mockProject.id,
      snapshotThemeName: 'some-prior-theme',
    });

    mockLoadStudioSnapshot.mockRejectedValueOnce(new Error('load failed'));

    await useStudioStore.getState().loadProjectSnapshots();

    expect(useStudioStore.getState().snapshotThemeName).toBe('');
  });
});
