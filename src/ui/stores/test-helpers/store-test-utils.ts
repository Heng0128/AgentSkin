// SPDX-License-Identifier: MPL-2.0

/**
 * # store-test-utils — shared reset helpers for store tests
 *
 * Each `reset*` function restores its corresponding Zustand store to a clean
 * initial state, ensuring test isolation when tests mutate shared store state.
 *
 * These helpers are the single source of truth for store reset logic —
 * individual test files should import from here rather than defining local
 * `resetStore` functions.
 */

import { useAgentStore } from '../agentStore';
import { FALLBACK_AGENTS } from '../agentStore';
import { useAppsStore } from '../appsStore';
import { useCommunityStore } from '../communityStore';
import { useSettingsStore } from '../settingsStore';
import { useStatusStore } from '../statusStore';
import { useWorkspaceStore } from '../workspaceStore';

/** Reset `useAgentStore` to its initial state (with fallback agents). */
export function resetAgentStore(): void {
  useAgentStore.setState({
    agents: FALLBACK_AGENTS,
    loaded: false,
  });
}

/** Reset `useAppsStore` state that tests commonly mutate. */
export function resetAppsStore(): void {
  useAppsStore.setState({
    scanResult: null,
    scanning: false,
    scanError: null,
    launchingApps: new Set(),
    runningApps: new Map(),
    hiddenApps: new Set(),
  });
}

/** Reset `useCommunityStore` to a pristine catalog-browsing state. */
export function resetCommunityStore(): void {
  useCommunityStore.setState({
    themes: [],
    total: 0,
    page: 1,
    pageSize: 20,
    sortBy: 'popular',
    query: '',
    loading: false,
    loadingMore: false,
    error: null,
    selectedThemeId: null,
    selectedThemeDetail: null,
    detailLoading: false,
    downloadProgress: new Map(),
    installingIds: new Set(),
    installedIds: new Set(),
  });
}

/** Reset `useSettingsStore` UI and MCP state to defaults. */
export function resetSettingsStore(): void {
  useSettingsStore.setState({
    settingsOpen: false,
    settingsSection: 'general',
    settings: null,
    radiusScale: '2',
    density: 'comfortable',
    motion: 'full',
    mcpRunning: false,
    mcpUrl: null,
  });
}

/** Reset `useStatusStore` to a clean, non-refreshing state. */
export function resetStatusStore(): void {
  useStatusStore.setState({
    status: null,
    lastStatusAt: null,
    isRefreshing: false,
    error: null,
  });
}

/**
 * Reset `useWorkspaceStore` live-tweak state, including the monotonic push
 * token used for serialising async push receipts.
 */
export function resetWorkspaceStore(): void {
  useWorkspaceStore.setState({
    currentAgentId: null,
    currentPort: null,
    currentOverrides: {},
    dirty: false,
    overridesByAgent: {},
    pushError: null,
    history: [],
    historyIndex: -1,
    tweakPresets: [],
    tweakPresetActiveId: null,
  });
  // Reset module-level pushToken to ensure monotonic token isolation between tests.
  useWorkspaceStore.getState().testResetPushToken();
}
