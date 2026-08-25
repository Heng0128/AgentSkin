// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-workspace-store — shared reset helper for workspaceStore tests
 *
 * Restores `useWorkspaceStore` live-tweak state, including the monotonic push
 * token used for serialising async push receipts.
 * Import this helper in workspaceStore test files instead of defining local
 * `resetLiveTweakState` functions.
 */

import { useWorkspaceStore } from '../workspaceStore';

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
