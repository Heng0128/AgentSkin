// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-status-store — shared reset helper for statusStore tests
 *
 * Restores `useStatusStore` to a clean, non-refreshing state.
 * Import this helper in statusStore test files instead of defining local
 * `resetStore` functions.
 */

import { useStatusStore } from '../statusStore';

/** Reset `useStatusStore` to a clean, non-refreshing state. */
export function resetStatusStore(): void {
  useStatusStore.setState({
    status: null,
    lastStatusAt: null,
    isRefreshing: false,
    error: null,
  });
}
