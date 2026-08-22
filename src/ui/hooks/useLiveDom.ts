// SPDX-License-Identifier: MPL-2.0

/**
 * # useLiveDom
 *
 * Encapsulates the "real-time CDP + degraded cache" preview data pipeline.
 * Replaces the legacy manual-snapshot approach with a live DOM tree that
 * auto-refreshes and gracefully degrades when the CDP bridge is unavailable.
 *
 * ## Lifecycle
 *
 *   1. On mount (or when `agentId` changes), call `api.captureLiveDom(agentId)`.
 *   2. On success → store the DOM tree, stamp the cache timestamp, set `success`.
 *   3. On failure → fall back to cached tree if within `cacheTTL` → set `degraded`.
 *   4. Cache also expired → set `error`.
 *
 * ## Auto-refresh
 *
 * When `refreshInterval > 0`, a `setInterval` re-fetches on the cadence.
 * The in-flight guard (`loadingRef`) skips a tick if the previous fetch
 * hasn't resolved yet — slow CDP round-trips simply delay the next cycle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';

import type { AgentId } from '@shared/types/agent';
import type { DomTreeNode } from '@shared/types/ipc';

export type LiveDomStatus = 'idle' | 'loading' | 'success' | 'error' | 'degraded';

export interface LiveDomState {
  domTree: DomTreeNode | null;
  status: LiveDomStatus;
  error: string | null;
  cachedDomTree: DomTreeNode | null;
}

interface UseLiveDomOptions {
  /** Auto-refresh interval in ms. 0 disables auto-refresh. */
  refreshInterval?: number;
  /** Cache time-to-live in ms. Defaults to 30 000. */
  cacheTTL?: number;
}

const DEFAULT_CACHE_TTL = 30_000;

export function useLiveDom(
  agentId: AgentId | null,
  options: UseLiveDomOptions = {},
): LiveDomState & { refresh: () => void } {
  const { refreshInterval = 0, cacheTTL = DEFAULT_CACHE_TTL } = options;

  const [domTree, setDomTree] = useState<DomTreeNode | null>(null);
  const [status, setStatus] = useState<LiveDomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cachedDomTree, setCachedDomTree] = useState<DomTreeNode | null>(null);

  // In-flight guard — prevents concurrent fetches from stacking when a CDP
  // round-trip outlives the refresh interval.
  const loadingRef = useRef(false);
  // Timestamp (ms) of the last successful fetch — drives cache TTL checks.
  const cacheStampRef = useRef<number>(0);
  // Mutable copy of the latest DOM tree for cache reads inside async closures
  // without re-creating the closure on every change.
  const domTreeRef = useRef<DomTreeNode | null>(null);

  /** 读取磁盘缓存 */
  const readCache = useCallback(async (): Promise<{
    domTree: DomTreeNode;
    timestamp: number;
  } | null> => {
    if (!agentId) return null;
    try {
      const result = await api.readLiveDomCache({ agentId });
      if (result.domTree && Date.now() - result.timestamp < cacheTTL) {
        return { domTree: result.domTree, timestamp: result.timestamp };
      }
    } catch {
      // ignore
    }
    return null;
  }, [agentId, cacheTTL]);

  /** 写入磁盘缓存 */
  const writeCache = useCallback(
    async (tree: DomTreeNode) => {
      if (!agentId) return;
      try {
        await api.writeLiveDomCache({ agentId, domTree: tree });
      } catch {
        // ignore write failure
      }
    },
    [agentId],
  );

  /** Core fetch logic with CDP → cache-degradation → error fallback. */
  const fetchDom = useCallback(async () => {
    if (!agentId || loadingRef.current) return;
    loadingRef.current = true;
    setStatus('loading');
    setError(null);

    try {
      const tree = await api.captureLiveDom(agentId as AgentId);
      if (!tree) {
        throw new Error('captureLiveDom returned null — agent may not be running');
      }
      const now = Date.now();
      domTreeRef.current = tree;
      cacheStampRef.current = now;
      setDomTree(tree);
      setCachedDomTree(tree);
      setStatus('success');
      // 写入磁盘缓存，供下次挂载时快速恢复
      void writeCache(tree);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // CDP failed — attempt cache degradation if within TTL.
      const cached = domTreeRef.current;
      const stamp = cacheStampRef.current;
      if (cached && Date.now() - stamp < cacheTTL) {
        setDomTree(cached);
        setCachedDomTree(cached);
        setStatus('degraded');
        setError(message);
      } else {
        // No usable cache — surface the error.
        setStatus('error');
        setError(message);
      }
    } finally {
      loadingRef.current = false;
    }
  }, [agentId, cacheTTL, writeCache]);

  // 挂载时立即恢复磁盘缓存（如果有）
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once effect — readCache already closes over cacheTTL
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const cached = await readCache();
      if (disposed || !cached) return;
      // 立即显示缓存数据，后台刷新
      domTreeRef.current = cached.domTree;
      cacheStampRef.current = cached.timestamp;
      setDomTree(cached.domTree);
      setStatus(Date.now() - cached.timestamp < cacheTTL ? 'degraded' : 'success');
      setCachedDomTree(cached.domTree);
      setError(null);
    })();
    return () => {
      disposed = true;
    };
  }, [readCache]);

  // Initial fetch + re-fetch when agentId changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentId is a prop that triggers re-render
  useEffect(() => {
    let disposed = false;

    // Defer to a macrotask to avoid React 19 useSyncExternalStore tearing
    // (same pattern as useBoot — synchronous store sets inside a microtask
    // land in the tearing window → error #185).
    const rafId = requestAnimationFrame(() => {
      if (disposed) return;
      void fetchDom();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
    };
  }, [agentId, fetchDom]);

  // Auto-refresh interval.
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const id = window.setInterval(() => {
      void fetchDom();
    }, refreshInterval);
    return () => window.clearInterval(id);
  }, [refreshInterval, fetchDom]);

  // Manual refresh — exposed to consumers (e.g. pull-to-refresh button).
  const refresh = useCallback(() => {
    void fetchDom();
  }, [fetchDom]);

  return { domTree, status, error, cachedDomTree, refresh };
}
