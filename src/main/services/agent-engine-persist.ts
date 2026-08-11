// SPDX-License-Identifier: MPL-2.0

/**
 * # Agent Engine Persist
 *
 * Persistence serialisation chain + state-shape contract for
 * `AgentEngineService`.
 *
 * Extracted from `AgentEngineService` (Facade decomposition — persistence
 * module).  Holds:
 *
 *   - `PersistedState` — the filesystem state shape (version 2).
 *   - `isPersistedState` — structural guard for JSON.parse results.
 *   - `PersistChain` — FIFO serialisation queue for persistence writes.
 *
 * The `PersistChain` replaces the previous inline `persistChain` /
 * `persistChainPending` / `persistSafe` fields on the service class.  Every
 * write operation is still routed through the same promise chain so
 * `writeJsonAtomic` calls never overlap.
 */

import { AGENT_IDS, type AgentId } from '../../shared/types';
import type { SchemeSnapshot } from '../agent-scheme';

// ---------------------------------------------------------------------------
// Persisted state shape
// ---------------------------------------------------------------------------

export interface PersistedState {
  version: 2;
  apps: Partial<
    Record<
      AgentId,
      {
        activeThemeId: string | null;
        /**
         * Color-scheme id of the active theme (v2.2+). 'default' (or absent)
         * means the theme's own manifest colors; other values are alternative
         * schemes applied via `ApplyRequest.schemeId`.
         */
        activeSchemeId?: string | null;
        port: number | null;
        /**
         * The agent's light/dark scheme state captured before AgentSkin first
         * switched it to match a theme. Restored when the theme is removed.
         */
        schemeSnapshot?: SchemeSnapshot | null;
        /**
         * Auto-detected install directory for this agent (cached from the
         * first successful `detectInstallation`). Lets status() skip the
         * full filesystem + registry scan on later polls — the path is
         * verified cheaply on each use and refreshed when it goes stale.
         * `null` means "auto-detection has not run yet for this agent".
         */
        detectedPath?: string | null;
      }
    >
  >;
}

// ---------------------------------------------------------------------------
// Structural guard
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` (from JSON.parse) to PersistedState without unsafe casts.
 * Checks the minimal structural contract: version === 2, apps is a plain object.
 * Field-level types are enforced by the TypeScript interface at compile time;
 * the guard ensures the parse result matches the shape before assignment.
 *
 * R6-24: 增加 apps entry 字段级检查。原实现 `isPersistedState` 只做浅层检查
 * （只验证 apps 是对象），不验证 apps 内部结构。损坏数据（如 port 为字符串）
 * 会进入运行态导致后续逻辑出错。
 */
export function isPersistedState(x: unknown): x is PersistedState {
  if (!x || typeof x !== 'object') return false;
  const rec = x as Record<string, unknown>;
  if (rec.version !== 2) return false;
  if (!rec.apps || typeof rec.apps !== 'object' || Array.isArray(rec.apps)) return false;
  // R6-24: 逐条验证 apps 内部结构。
  for (const [appId, entry] of Object.entries(rec.apps)) {
    // appId 必须是合法 AgentId
    if (!(AGENT_IDS as readonly string[]).includes(appId)) return false;
    // entry 可以为 null 或对象
    if (entry == null) continue;
    if (typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    // activeThemeId: string | null | undefined
    if (e.activeThemeId != null && typeof e.activeThemeId !== 'string') return false;
    // activeSchemeId: string | null | undefined
    if (e.activeSchemeId != null && typeof e.activeSchemeId !== 'string') return false;
    // port: number | null | undefined
    if (e.port != null && typeof e.port !== 'number') return false;
    // schemeSnapshot: object | null | undefined
    if (e.schemeSnapshot != null && typeof e.schemeSnapshot !== 'object') return false;
    // schemeSnapshot 为对象时验证其必要字段
    if (e.schemeSnapshot && typeof e.schemeSnapshot === 'object') {
      const ss = e.schemeSnapshot as Record<string, unknown>;
      if (ss.mode != null && typeof ss.mode !== 'string') return false;
    }
    // detectedPath: string | null | undefined
    if (e.detectedPath != null && typeof e.detectedPath !== 'string') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Persist chain — FIFO serialisation queue
// ---------------------------------------------------------------------------

/**
 * Serialisation chain for all persistence writes.
 *
 * Every `safe()` call is appended to the promise chain, guaranteeing that
 * underlying `writeJsonAtomic` operations never overlap — even when
 * fire-and-forget callbacks from deps and awaited calls from
 * `reconcileActiveThemes` run concurrently.
 *
 * `safe()` appends `result.catch(() => {})` so a single failed write does not
 * break the chain (following writes would stall forever on a rejected promise).
 *
 * The `depth` getter exposes the current pending count so concurrency metrics
 * can detect a persist backlog.
 */
export class PersistChain {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  /**
   * Serialise a write onto the chain.
   *
   * @returns A promise that settles when THIS write completes (not just
   * when it is queued). The returned promise rejects if the update throws,
   * but the chain itself always continues (see `chain` field).
   */
  safe(update: () => Promise<void> | void): Promise<void> {
    this.pending++;
    const result = this.chain.then(() => update());
    // Swallow rejection so a single failed write does not poison the chain.
    this.chain = result.catch(() => {});
    // Decrement the pending counter when this write settles (success OR failure).
    void result.finally(() => {
      this.pending = Math.max(0, this.pending - 1);
    });
    return result;
  }

  /** Number of writes currently queued or in-flight. */
  get depth(): number {
    return this.pending;
  }
}
