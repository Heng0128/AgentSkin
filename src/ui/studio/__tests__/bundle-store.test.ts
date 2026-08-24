// SPDX-License-Identifier: MPL-2.0

/**
 * # bundle-store tests
 *
 * Verifies BundleState actions: initial state, refreshBundles loading toggle,
 * installBundle success/failure, and deleteBundle removal.
 *
 * External modules (@/api/agentSkinClient, @/stores/notificationStore,
 * @/stores/shellStore) are mocked via vi.hoisted + vi.mock so tests run
 * without Electron IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockListBundles,
  mockImportBundle,
  mockInstallBundleById,
  mockDeleteBundle,
  mockShowToast,
} = vi.hoisted(() => ({
  mockListBundles: vi.fn(),
  mockImportBundle: vi.fn(),
  mockInstallBundleById: vi.fn(),
  mockDeleteBundle: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listBundles: mockListBundles,
    importBundle: mockImportBundle,
    installBundleById: mockInstallBundleById,
    deleteBundle: mockDeleteBundle,
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
      locale: 'en' as const,
    })),
  },
}));

// Import AFTER all mocks are in place
import type { StudioBundle } from '@/studio/bundle-store';
import { useBundleStore } from '@/studio/bundle-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeBundle = (id: string, name = 'Test Bundle'): StudioBundle => ({
  id,
  name,
  themeId: `theme-${id}`,
  hasWallpaper: false,
  createdAt: '2025-01-01T00:00:00.000Z',
});

/** Reset store to clean slate before each test. */
const resetStore = () => {
  useBundleStore.setState({
    bundles: [],
    bundlesLoading: false,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBundleStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Initial state
  // ------------------------------------------------------------------

  it('initializes with empty bundles and bundlesLoading=false', () => {
    const state = useBundleStore.getState();
    expect(state.bundles).toEqual([]);
    expect(state.bundlesLoading).toBe(false);
  });

  // ------------------------------------------------------------------
  // 2. refreshBundles — populates bundles and toggles loading
  // ------------------------------------------------------------------

  it('refreshBundles populates bundles and resets loading on success', async () => {
    const list = [makeBundle('b1'), makeBundle('b2')];
    mockListBundles.mockResolvedValueOnce(list);

    await useBundleStore.getState().refreshBundles();

    const state = useBundleStore.getState();
    expect(state.bundles).toEqual(list);
    expect(state.bundlesLoading).toBe(false);
    expect(mockListBundles).toHaveBeenCalledTimes(1);
  });

  it('refreshBundles sets bundlesLoading=false on error', async () => {
    mockListBundles.mockRejectedValueOnce(new Error('network error'));

    await useBundleStore.getState().refreshBundles();

    const state = useBundleStore.getState();
    expect(state.bundles).toEqual([]);
    expect(state.bundlesLoading).toBe(false);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 3. installBundle — success and failure
  // ------------------------------------------------------------------

  it('installBundle shows success toast when api returns ok', async () => {
    mockInstallBundleById.mockResolvedValueOnce({ ok: true });

    await useBundleStore.getState().installBundle('b1');

    expect(mockInstallBundleById).toHaveBeenCalledWith('b1');
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('installBundle shows failure toast when api returns not ok', async () => {
    mockInstallBundleById.mockResolvedValueOnce({ ok: false, error: 'invalid bundle' });

    await useBundleStore.getState().installBundle('b1');

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('installBundle shows failure toast on exception', async () => {
    mockInstallBundleById.mockRejectedValueOnce(new Error('timeout'));

    await useBundleStore.getState().installBundle('b1');

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 4. deleteBundle — removes from list on success
  // ------------------------------------------------------------------

  it('deleteBundle removes the bundle from the list on success', async () => {
    mockDeleteBundle.mockResolvedValueOnce({ ok: true });

    useBundleStore.setState({
      bundles: [makeBundle('b1'), makeBundle('b2')],
    });

    await useBundleStore.getState().deleteBundle('b1');

    expect(mockDeleteBundle).toHaveBeenCalledWith('b1');
    const state = useBundleStore.getState();
    expect(state.bundles).toHaveLength(1);
    expect(state.bundles[0]!.id).toBe('b2');
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('deleteBundle keeps the bundle when api returns not ok', async () => {
    mockDeleteBundle.mockResolvedValueOnce({ ok: false, error: 'not found' });

    useBundleStore.setState({
      bundles: [makeBundle('b1')],
    });

    await useBundleStore.getState().deleteBundle('b1');

    const state = useBundleStore.getState();
    expect(state.bundles).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('deleteBundle keeps the bundle on exception', async () => {
    mockDeleteBundle.mockRejectedValueOnce(new Error('io error'));

    useBundleStore.setState({
      bundles: [makeBundle('b1')],
    });

    await useBundleStore.getState().deleteBundle('b1');

    const state = useBundleStore.getState();
    expect(state.bundles).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
