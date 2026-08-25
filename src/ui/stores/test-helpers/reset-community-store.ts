// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-community-store — shared reset helper for communityStore tests
 *
 * Restores `useCommunityStore` to a pristine catalog-browsing state.
 * Import this helper in communityStore test files instead of defining local
 * `resetStore` functions.
 */

import { useCommunityStore } from '../communityStore';

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
    retryCount: new Map(),
  });
}
