// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';

/**
 * Theme Usage Tracking Types
 *
 * Records how frequently each theme is applied per agent, enabling
 * LRU-sorted quick-switch menus (inspired by dream-work-theme).
 *
 * Persisted to `theme-usage.json` under userData.
 */

/** Usage statistics for a single theme within a single agent. */
export interface ThemeUsageEntry {
  /** Number of times this theme has been applied. */
  count: number;
  /** Timestamp (ms since epoch) of the most recent application. */
  lastUsed: number;
}

/**
 * Full usage map: agent → themeId → entry.
 *
 * Example:
 * ```json
 * {
 *   "traework": {
 *     "neon":   { "count": 5, "lastUsed": 1700000000000 },
 *     "ocean":  { "count": 3, "lastUsed": 1700000100000 }
 *   }
 * }
 * ```
 */
export type ThemeUsageMap = Partial<Record<AgentId, Record<string, ThemeUsageEntry>>>;
