// SPDX-License-Identifier: MPL-2.0

/**
 * # useDiagnosticsSync
 *
 * Subscribes to real-time diagnostics events from the main process and
 * pushes them into `useDiagnosticsStore`:
 *
 *   1. `diagnostics:concurrency-metrics` — every 5s, updates the full
 *      concurrency metrics object (companion busy, inflight ops, etc.)
 *   2. `performance:new-trace` — fires when a theme-apply flow finishes,
 *      pushes the trace into the store's `recentTraces` list
 *
 * Mounted once in the Settings page (Diagnostics tab) — the subscription
 * lives for the component's lifetime and cleans up on unmount.
 */

import { useEffect } from 'react';
import { api } from '@/api/agentSkinClient';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';

export function useDiagnosticsSync(): void {
  useEffect(() => {
    // 1. Concurrency metrics broadcast (every 5s from main process)
    const unsubMetrics = api.onDiagnosticsConcurrencyMetrics((metrics) => {
      useDiagnosticsStore.getState().updateConcurrencyMetrics(metrics);
    });

    // 2. Real-time trace push (fires when a theme-apply flow finishes)
    const unsubTraces = api.onPerformanceNewTrace((trace) => {
      useDiagnosticsStore.getState().pushTrace(trace);
    });

    return () => {
      unsubMetrics();
      unsubTraces();
    };
  }, []);
}
