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
 *   3. `performance:cdp-metrics` — fires when CDP session state changes,
 *      updates `cdpSessionCount` and `cdpReconnectCount`
 *   4. `theme:health-report` — per-agent injection health pushed from the
 *      main process, updates `healthReportByAgent` in the diagnostics store
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

    // 3. CDP session metrics (session count + reconnect events)
    const unsubCdp = api.onPerformanceCdpMetrics((metrics) => {
      const store = useDiagnosticsStore.getState();
      store.setCdpSessionCount(metrics.sessionCount);
      if (metrics.reconnected) {
        store.incrementReconnectCount();
      }
    });

    // 4. Theme health report (per-agent injection health pushed from main process)
    const unsubHealth = api.onThemeHealthReport((report) => {
      useDiagnosticsStore.getState().setHealthReport(report);
    });

    return () => {
      unsubMetrics();
      unsubTraces();
      unsubCdp();
      unsubHealth();
    };
  }, []);
}
