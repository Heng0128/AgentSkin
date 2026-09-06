// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-community-store — shared reset helper for communityStore tests
 *
 * Restores `useCommunityStore` to a pristine catalog-browsing state.
 * Resets both flat mirrors (backward-compatible) and source-driven slices
 * (sources, activeSourceId, installationLog), plus per-source request tokens.
 * Import this helper in communityStore test files instead of defining local
 * `resetStore` functions.
 */

import { resetRequestToken, useCommunityStore } from '../communityStore';

function createEmptySources() {
  return {
    dreamskin: {
      status: 'online' as const,
      error: null,
      loading: false,
      loadingMore: false,
      detailLoading: false,
      themes: [],
      total: 0,
      page: 1,
      pageSize: 20,
      sortBy: 'popular' as const,
      query: '',
      installingIds: new Set<string>(),
      installedIds: new Set<string>(),
      downloadProgress: new Map(),
      retryCount: new Map(),
      cache: undefined,
    },
    codedrobe: {
      status: 'offline' as const,
      error: null,
      loading: false,
      loadingMore: false,
      detailLoading: false,
      themes: [],
      total: 0,
      page: 1,
      pageSize: 20,
      sortBy: 'popular' as const,
      query: '',
      installingIds: new Set<string>(),
      installedIds: new Set<string>(),
      downloadProgress: new Map(),
      retryCount: new Map(),
      cache: undefined,
    },
  };
}

/** Reset `useCommunityStore` to a pristine catalog-browsing state. */
export function resetCommunityStore(): void {
  // Clear per-source request tokens first
  resetRequestToken();

  useCommunityStore.setState({
    // Source-driven state
    sources: createEmptySources(),
    activeSourceId: 'dreamskin',
    installationLog: new Map(),
    statusHistory: new Map(),

    // Flat mirrors (derived from dreamskin slice)
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
    retryCount: new Map(),
  });
}
