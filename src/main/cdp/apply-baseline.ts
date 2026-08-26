// SPDX-License-Identifier: MPL-2.0

/**
 * # apply-baseline — BaselineSnapshot + semanticNodes 内存缓存（RFC §4.5/§4.6）
 *
 * Provides the fast-path baseline cache that lets a theme switch reuse the
 * previously-verified DOM state instead of re-analyzing it from scratch:
 *
 *   - {@link BaselineSnapshot}: a lightweight fingerprint of the applied theme
 *     — page URL, `--agentskin-accent`, owned adopted-sheet count, hero-blob
 *     activity, and a semantic-node count. This is NOT the full Studio DOM
 *     replica (see `snapshot-theme.ts`); it is the minimal signal set the fast
 *     path needs to detect cache staleness / DOM migration.
 *   - {@link ApplyBaselineCache}: per-agent LRU(3) with a 60s TTL, keyed by
 *     `{appId, url, themeId}`. Invalidation triggers: TTL expiry, LRU eviction,
 *     explicit `invalidate()` (e.g. after a failed light probe), and
 *     `clearAgent()` on epoch bump / service dispose.
 *   - {@link captureBaseline} / {@link captureBaselineOnPort}: read the live
 *     DOM via a single `Runtime.evaluate` and produce a snapshot.
 *   - {@link probeThemeLive} / {@link probeThemeLiveOnPort}: the §4.6 light
 *     probe — reuses `verifyTheme`'s exact core checks (accent + owned sheet
 *     count), returning a boolean "theme is live".
 *
 * Lifecycle rule (RFC §4.1/§4.5): the cache is only ever consulted on the
 * theme-switch fast path. It is seeded after a full-init apply and invalidated
 * on probe failure, URL change, or epoch flip — so a stale baseline can never
 * be reused across a newer apply instance.
 */

import { toMessage } from '../../shared/errors';
import { SHEET_OWNED_FLAG } from '../../shared/injection-constants';
import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import { type CdpSession, connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';
import { verifyTheme } from './injection/shared';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
  type SessionHandle,
  targetKeyFor,
} from './session-pool';

// ---------------------------------------------------------------------------
// BaselineSnapshot
// ---------------------------------------------------------------------------

/**
 * Lightweight fingerprint of an applied theme on one agent+page.
 *
 * `semanticNodeCount` is a coarse DOM-structure signal (total element count)
 * used to detect large structural changes that would invalidate the cached
 * baseline. It is deliberately cheap — captured in the same single
 * `Runtime.evaluate` as the other signals.
 */
export interface BaselineSnapshot {
  appId: AgentId;
  themeId: string;
  /** Page URL at capture time (invalidation key component). */
  url: string;
  accent: string;
  adoptedSheetCount: number;
  heroBlobActive: boolean;
  semanticNodeCount: number;
  capturedAt: number;
}

export const APPLY_BASELINE_TTL_MS = 60_000;
export const APPLY_BASELINE_LRU_CAPACITY = 3;

// ---------------------------------------------------------------------------
// ApplyBaselineCache
// ---------------------------------------------------------------------------

/**
 * Per-agent LRU cache for {@link BaselineSnapshot}.
 *
 * Key = `{appId, url, themeId}`. Capacity is 3 entries per agent (RFC §4.5),
 * entries expire after {@link APPLY_BASELINE_TTL_MS}. The cache is
 * self-contained and unit-testable; it holds no CDP state.
 */
export class ApplyBaselineCache {
  private readonly byAgent = new Map<AgentId, Map<string, BaselineSnapshot>>();
  /** LRU order per agent (most-recently-used at the end). */
  private readonly recency = new Map<AgentId, string[]>();

  private key(appId: AgentId, url: string, themeId: string): string {
    return `${appId}|${url}|${themeId}`;
  }

  /** Read + LRU touch + TTL check. Returns null on miss/expiry. */
  get(appId: AgentId, url: string, themeId: string): BaselineSnapshot | null {
    const agentCache = this.byAgent.get(appId);
    if (!agentCache) return null;
    const key = this.key(appId, url, themeId);
    const snap = agentCache.get(key);
    if (!snap) return null;
    if (Date.now() - snap.capturedAt > APPLY_BASELINE_TTL_MS) {
      this.removeKey(appId, key);
      return null;
    }
    this.touch(appId, key);
    return snap;
  }

  /** Insert (or refresh) a snapshot, applying LRU eviction if over capacity. */
  put(snap: BaselineSnapshot): void {
    let agentCache = this.byAgent.get(snap.appId);
    if (!agentCache) {
      agentCache = new Map();
      this.byAgent.set(snap.appId, agentCache);
      this.recency.set(snap.appId, []);
    }
    const key = this.key(snap.appId, snap.url, snap.themeId);
    agentCache.set(key, snap);
    this.touch(snap.appId, key);
    this.evict(snap.appId);
  }

  /**
   * Remove entries for an agent. When `themeId`/`url` are given, only matching
   * entries are removed; with neither, the whole agent's cache is cleared.
   */
  invalidate(appId: AgentId, themeId?: string, url?: string): void {
    const agentCache = this.byAgent.get(appId);
    if (!agentCache) return;
    if (themeId === undefined && url === undefined) {
      this.removeAll(appId);
      return;
    }
    for (const [key, snap] of agentCache) {
      if (themeId !== undefined && snap.themeId !== themeId) continue;
      if (url !== undefined && snap.url !== url) continue;
      this.removeKey(appId, key);
    }
  }

  clearAgent(appId: AgentId): void {
    this.removeAll(appId);
  }

  size(appId: AgentId): number {
    return this.byAgent.get(appId)?.size ?? 0;
  }

  private touch(appId: AgentId, key: string): void {
    const list = this.recency.get(appId) ?? [];
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    list.push(key);
    this.recency.set(appId, list);
  }

  private removeKey(appId: AgentId, key: string): void {
    this.byAgent.get(appId)?.delete(key);
    const list = this.recency.get(appId);
    if (list) {
      const idx = list.indexOf(key);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private evict(appId: AgentId): void {
    const list = this.recency.get(appId);
    const agentCache = this.byAgent.get(appId);
    if (!list || !agentCache) return;
    while (list.length > APPLY_BASELINE_LRU_CAPACITY) {
      const oldest = list.shift();
      if (oldest === undefined) break;
      agentCache.delete(oldest);
    }
  }

  private removeAll(appId: AgentId): void {
    this.byAgent.delete(appId);
    this.recency.delete(appId);
  }
}

// ---------------------------------------------------------------------------
// Capture + probe
// ---------------------------------------------------------------------------

/** Build the single-evaluate expression producing the baseline signal set. */
function buildBaselineProbeExpr(): string {
  return `(() => {
    const cs = getComputedStyle(document.documentElement);
    const root = document.getElementById('root') || document.body;
    const rootBg = getComputedStyle(root).backgroundImage || '';
    const bodyBg = getComputedStyle(document.body).backgroundImage || '';
    const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
    return JSON.stringify({
      url: location.href,
      accent: cs.getPropertyValue('--agentskin-accent').trim(),
      adoptedSheetCount: adopted,
      heroBlobActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
      semanticNodeCount: document.querySelectorAll('*').length,
    });
  })()`;
}

/**
 * Capture a {@link BaselineSnapshot} from an already-open session. Returns null
 * on any CDP/eval failure (best-effort — never throws).
 */
export async function captureBaseline(
  session: CdpSession,
  appId: AgentId,
  themeId: string,
): Promise<BaselineSnapshot | null> {
  try {
    const raw = await session.evaluate(buildBaselineProbeExpr());
    // TODO: type-guard — 待渐进式加固
    const parsed = JSON.parse(raw) as Omit<BaselineSnapshot, 'appId' | 'themeId' | 'capturedAt'>;
    return { ...parsed, appId, themeId, capturedAt: Date.now() };
  } catch (error) {
    mainWarn('Baseline.Capture', `baseline capture failed: ${toMessage(error)}`);
    return null;
  }
}

/**
 * §4.6 light probe: verify the theme is actually live on an open session.
 * Reuses `verifyTheme`'s exact core checks (accent + owned adoptedSheetCount).
 */
export async function probeThemeLive(session: CdpSession): Promise<boolean> {
  try {
    const verification = await verifyTheme(session);
    return verification !== null && verification.adoptedSheetCount > 0;
  } catch (error) {
    mainWarn('Baseline.Probe', `theme-live probe failed: ${toMessage(error)}`);
    return false;
  }
}

/**
 * Open a session to the main DOM-bearing target on a port, capture a baseline,
 * and release. Returns null when no DOM target is reachable or capture fails.
 *
 * When `pool` is provided the session is acquired from the pool (reusing an
 * existing connection to the same target if one exists) and released back into
 * the pool on completion. Without a pool a one-shot connect-then-close
 * session is used (backwards-compatible path for callers that don't pass one).
 */
export async function captureBaselineOnPort(
  port: number,
  appId: AgentId,
  themeId: string,
  pool?: CdpSessionPool,
): Promise<BaselineSnapshot | null> {
  const { session, targetKey, pooled } = await openMainDomSession(port, appId, pool);
  if (!session) return null;
  try {
    return await captureBaseline(session, appId, themeId);
  } finally {
    if (pooled) {
      releaseSession(pool, appId, targetKey);
    } else {
      closeSafely(session);
    }
  }
}

/**
 * Open a session to the main DOM-bearing target on a port and probe whether
 * the theme is live. Returns false when no DOM target is reachable.
 *
 * Pooling follows the same contract as {@link captureBaselineOnPort}.
 */
export async function probeThemeLiveOnPort(
  port: number,
  appId: AgentId,
  pool?: CdpSessionPool,
): Promise<boolean> {
  const { session, targetKey, pooled } = await openMainDomSession(port, appId, pool);
  if (!session) return false;
  try {
    return await probeThemeLive(session);
  } finally {
    if (pooled) {
      releaseSession(pool, appId, targetKey);
    } else {
      closeSafely(session);
    }
  }
}

/**
 * Acquire (or one-shot-connect) a session to the main DOM-bearing target on a
 * port. Returns the session, the pool targetKey, and whether it was pooled
 * (so the caller knows whether to release or close).
 */
async function openMainDomSession(
  port: number,
  appId: AgentId,
  pool?: CdpSessionPool,
): Promise<{ session: CdpSession | null; targetKey: string; pooled: boolean }> {
  try {
    const targets = await findDomTargets(port);
    if (!targets.length || !targets[0].webSocketDebuggerUrl) {
      return { session: null, targetKey: '', pooled: false };
    }
    const target = targets[0];
    const targetKey = targetKeyFor(target.id, target.webSocketDebuggerUrl);
    const handle: SessionHandle = await acquireSession(pool, appId, targetKey, () =>
      connectCdp(target.webSocketDebuggerUrl!, 3000),
    );
    return { session: handle.session, targetKey, pooled: handle.pooled };
  } catch (error) {
    mainWarn('Baseline.Connect', `open main DOM session failed: ${toMessage(error)}`);
    return { session: null, targetKey: '', pooled: false };
  }
}

function closeSafely(session: CdpSession): void {
  try {
    session.close();
  } catch {
    // already closed
  }
}
