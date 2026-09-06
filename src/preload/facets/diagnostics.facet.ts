// SPDX-License-Identifier: MPL-2.0

/**
 * Diagnostics facet — performance traces, IPC timeout events, CDP metrics,
 * concurrency metrics, theme health/drift reports, secondary injection progress.
 *
 * All read-only queries + push-subscription methods that power the Diagnostics UI.
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ConcurrencyMetrics, DriftStatus, HealthCheckReport } from '../../shared/types';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const diagnostics = {
  // --- IPC timeout events ---
  getPerformanceTimeouts: (count?: number) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS, count) as Promise<
      Array<{ id: string; channel: string; ms: number; timestamp: number }>
    >,
  clearPerformanceTimeouts: () =>
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_CLEAR_TIMEOUTS) as Promise<{ ok: true }>,

  // --- Performance trace history ---
  getPerformanceHistory: (count?: number) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET, count) as Promise<{
      recent: Array<{
        id: string;
        agentId: string;
        themeId?: string;
        finishedAt: number;
        duration: number;
        success: boolean;
        steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
        error?: string;
      }>;
      stats: {
        totalApplies: number;
        avgDurationMs: number;
        perAgentAvg: Record<string, number>;
        overflowCount: number;
      };
    }>,
  getPerformanceMemory: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET_MEMORY) as Promise<
      Array<{ ts: number; heapUsed: number; rss: number; external: number }>
    >,

  // --- Push subscriptions ---
  onDiagnosticsConcurrencyMetrics: (listener: (metrics: ConcurrencyMetrics) => void) =>
    subscribeEvent(IpcChannel.DIAGNOSTICS_CONCURRENCY_METRICS, listener),
  onPerformanceNewTrace: (
    listener: (trace: {
      id: string;
      agentId: string;
      themeId?: string;
      startedAt: number;
      finishedAt: number;
      duration: number;
      success: boolean;
      steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
      error?: string;
    }) => void,
  ) => subscribeEvent(IpcChannel.PERFORMANCE_NEW_TRACE, listener),

  onPersistFailureWarning: (listener: (payload: { failureCount: number }) => void) =>
    subscribeEvent(IpcChannel.PERSIST_FAILURE_WARNING, listener),

  onPerformanceCdpMetrics: (
    listener: (metrics: { sessionCount: number; reconnected: boolean }) => void,
  ) => subscribeEvent(IpcChannel.PERFORMANCE_CDP_METRICS, listener),

  // --- Secondary target injection trace ---
  onSecondaryInjectProgress: (
    listener: (progress: {
      agent: string;
      targetId: string;
      targetType: string;
      title?: string;
      success: boolean;
      error?: string;
      elapsed: number;
    }) => void,
  ) => subscribeEvent(IpcChannel.THEME_SECONDARY_INJECT_PROGRESS, listener),

  onSecondaryInjectSummary: (
    listener: (summary: {
      agent: string;
      injected: number;
      failed: number;
      total: number;
      duration: number;
    }) => void,
  ) => subscribeEvent(IpcChannel.THEME_SECONDARY_INJECT_SUMMARY, listener),

  // --- Theme health & drift ---
  onThemeHealthReport: (listener: (report: HealthCheckReport) => void) =>
    subscribeEvent(IpcChannel.THEME_HEALTH_REPORT, listener),
  onThemeDriftStatus: (listener: (status: DriftStatus) => void) =>
    subscribeEvent(IpcChannel.THEME_DRIFT_STATUS, listener),
};
