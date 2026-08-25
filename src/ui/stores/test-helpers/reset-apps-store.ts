// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-apps-store — shared reset helper for appsStore tests
 *
 * Restores `useAppsStore` to a clean initial state.
 * Import this helper in appsStore test files instead of defining local
 * `resetStore` functions.
 *
 * NOTE: This module imports `useAppsStore`, which has module-level side effects
 * (getCoordinatorSnapshot + onCoordinatorStatus calls at creation time). Tests
 * MUST mock `@/api/agentSkinClient` before importing this helper.
 */

import { useAppsStore } from '../appsStore';

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
