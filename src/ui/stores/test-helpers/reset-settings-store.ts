// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-settings-store — shared reset helper for settingsStore tests
 *
 * Restores `useSettingsStore` UI and MCP state to defaults.
 * Import this helper in settingsStore test files instead of defining local
 * `resetStore` functions.
 */

import { useSettingsStore } from '../settingsStore';

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
