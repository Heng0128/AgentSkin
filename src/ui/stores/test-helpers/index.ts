// SPDX-License-Identifier: MPL-2.0

/**
 * # test-helpers — shared reset helpers for store tests
 *
 * Single import point for all store reset helpers. Each helper restores its
 * corresponding Zustand store to a clean initial state for test isolation.
 *
 * IMPORTANT: `reset-apps-store` imports `useAppsStore`, which has module-level
 * side effects (getCoordinatorSnapshot + onCoordinatorStatus calls at creation
 * time). Tests using `resetAppsStore` MUST mock `@/api/agentSkinClient` before
 * importing.
 */

export { resetAgentStore } from './reset-agent-store';
export { resetAppsStore } from './reset-apps-store';
export { resetCommunityStore } from './reset-community-store';
export { resetSettingsStore } from './reset-settings-store';
export { resetStatusStore } from './reset-status-store';
export { resetWorkspaceStore } from './reset-workspace-store';
