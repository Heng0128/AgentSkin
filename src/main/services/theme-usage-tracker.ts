// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Usage Tracker
 *
 * Records how frequently each theme is applied per agent, enabling
 * LRU-sorted quick-switch menus. Persists to `theme-usage.json` under
 * userData so usage history survives restarts.
 *
 * LRU sort order: count descending, then lastUsed descending (most recent
 * first). This matches dream-work-theme's frequency-based quick-switch UX.
 *
 * Concurrency safety: all mutations go through a serialisation chain
 * (same pattern as `PersistChain`) so concurrent `recordUsage` calls
 * never result in lost updates or torn writes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { AGENT_IDS, type AgentId } from '../../shared/types';
import type { ThemeUsageEntry, ThemeUsageMap } from '../../shared/types/theme-usage';
import { atomicWriteJson } from '../fs-utils';
import { mainWarnFromCatch } from '../logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of themes returned by getSortedThemes. */
export const DEFAULT_SORTED_LIMIT = 4;

/** Persisted file name under userData. */
const USAGE_FILE = 'theme-usage.json';

// ---------------------------------------------------------------------------
// Structural guard
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` (from JSON.parse) to ThemeUsageMap without unsafe casts.
 * Validates: known AgentId keys, numeric count/lastUsed, no extra types.
 */
export function isThemeUsageMap(x: unknown): x is ThemeUsageMap {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const rec = x as Record<string, unknown>;
  for (const [appId, themes] of Object.entries(rec)) {
    // AppId must be a recognized agent id.
    if (!(AGENT_IDS as readonly string[]).includes(appId)) return false;
    if (themes == null) continue;
    if (typeof themes !== 'object' || Array.isArray(themes)) return false;
    for (const [themeId, entry] of Object.entries(themes)) {
      if (typeof themeId !== 'string') return false;
      if (!entry || typeof entry !== 'object') return false;
      const e = entry as Record<string, unknown>;
      if (typeof e.count !== 'number' || !Number.isInteger(e.count) || e.count < 0) return false;
      if (typeof e.lastUsed !== 'number' || !Number.isFinite(e.lastUsed)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// ThemeUsageTracker
// ---------------------------------------------------------------------------

export class ThemeUsageTracker {
  /** Serialisation chain for all persistence writes — prevents torn writes. */
  private chain: Promise<void> = Promise.resolve();
  /** In-memory cache of the usage map, kept in sync with disk. */
  private cache: ThemeUsageMap | null = null;

  constructor(private readonly userDataPath: string) {}

  /** Resolve the persisted usage file path under userData. */
  private get filePath(): string {
    return path.join(this.userDataPath, USAGE_FILE);
  }

  /**
   * Load the usage map from disk into memory. Called once during boot
   * (boot-sequence) before any recordUsage / getSortedThemes call.
   *
   * If the file does not exist yet (first run), initialises an empty map.
   * If the file is corrupted, logs a warning and starts fresh rather than
   * crashing the boot sequence.
   */
  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (isThemeUsageMap(parsed)) {
        this.cache = parsed;
      } else {
        this.cache = {};
      }
    } catch (error) {
      // File does not exist — first run, start with empty map.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.cache = {};
        return;
      }
      // Corrupted or unreadable — log and degrade to empty map so the
      // feature still works (without history) rather than blocking boot.
      this.cache = {};
      mainWarnFromCatch('ThemeUsageTracker', error, 'failed to load usage map, starting fresh');
    }
  }

  /**
   * Record a theme application event. Increments the usage count and
   * updates the lastUsed timestamp.
   *
   * Fire-and-forget safe: returns a promise that resolves when the write
   * is persisted, but callers may choose to ignore it. Concurrency-safe
   * through the internal serialisation chain.
   *
   * @param appId  The agent the theme was applied to.
   * @param themeId  The theme that was applied.
   */
  recordUsage(appId: AgentId, themeId: string): Promise<void> {
    // Fast path: update the in-memory cache synchronously so subsequent
    // getSortedThemes calls see the new data even before the write lands.
    const now = Date.now();
    const current = this.cache ?? {};
    const agentThemes = current[appId] ?? {};
    const existing = agentThemes[themeId];
    const updated: ThemeUsageEntry = existing
      ? { count: existing.count + 1, lastUsed: now }
      : { count: 1, lastUsed: now };
    this.cache = {
      ...current,
      [appId]: {
        ...agentThemes,
        [themeId]: updated,
      },
    };

    // Serialise the persistence write. safe() swallows rejection so a
    // single failed write does not block the chain — subsequent writes
    // still execute.
    return this.safe(() => this.persist());
  }

  /**
   * Get the most frequently used themes for an agent, sorted by:
   *   1. count descending (higher count = more used = higher rank)
   *   2. lastUsed descending as tiebreaker (more recent = higher rank)
   *
   * Returns at most `limit` theme ids. Themes not present in the usage
   * map are excluded (they have never been used).
   *
   * @param appId  The agent to query.
   * @param allThemes  Full list of installed theme ids (for filtering).
   * @param limit  Maximum number of results (default: 4).
   * @returns Theme ids sorted by LRU ranking.
   */
  getSortedThemes(
    appId: AgentId,
    allThemes: string[],
    limit: number = DEFAULT_SORTED_LIMIT,
  ): string[] {
    const agentThemes = this.cache?.[appId];
    if (!agentThemes) return [];

    const available = new Set(allThemes);
    return Object.entries(agentThemes)
      .filter(([themeId]) => available.has(themeId))
      .sort((a, b) => {
        // Primary: count descending.
        if (b[1].count !== a[1].count) return b[1].count - a[1].count;
        // Tiebreaker: lastUsed descending (more recent first).
        return b[1].lastUsed - a[1].lastUsed;
      })
      .slice(0, limit)
      .map(([themeId]) => themeId);
  }

  /**
   * Get the full usage map (for diagnostics / debugging).
   * Returns a deep copy to prevent external mutation of nested entries.
   */
  getUsageMap(): ThemeUsageMap {
    if (!this.cache) return {};
    const copy: ThemeUsageMap = {};
    for (const [appId, themes] of Object.entries(this.cache)) {
      if (!themes) continue;
      const agentCopy: Record<string, ThemeUsageEntry> = {};
      for (const [themeId, entry] of Object.entries(themes)) {
        agentCopy[themeId] = { ...entry };
      }
      copy[appId as AgentId] = agentCopy;
    }
    return copy;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Serialise a write onto the chain. Mirrors the PersistChain.safe()
   * pattern: appends to the promise chain so writes never overlap.
   */
  private safe(update: () => Promise<void>): Promise<void> {
    const result = this.chain.then(() => update());
    this.chain = result.catch(() => {
      // Swallow rejection so a single failed write does not poison the chain.
    });
    return result;
  }

  /** Persist the in-memory cache to disk atomically. */
  private async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, this.cache);
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _instance: ThemeUsageTracker | null = null;

/**
 * Get (or lazily create) the singleton ThemeUsageTracker.
 * Uses `app.getPath('userData')` for the persistence directory.
 */
export function getThemeUsageTracker(): ThemeUsageTracker {
  if (!_instance) {
    _instance = new ThemeUsageTracker(app.getPath('userData'));
  }
  return _instance;
}
