// SPDX-License-Identifier: MPL-2.0

/**
 * # useConcurrencyRenderer
 *
 * Periodically reports renderer-side concurrency primitive sizes to the main
 * process via `api.sendRendererConcurrencyMetrics`. The main process includes
 * these values in its unified concurrency-metrics broadcast (every 5s), so the
 * Diagnostics tab can show a complete view of ALL concurrency guards — both
 * main-process-side and renderer-side.
 *
 * ## Why the renderer must self-report
 *
 * Two concurrency primitives live on the renderer side:
 *   - `companionBusyByAgent` (Set) in wallpaperStore — guards the wallpaper →
 *     theme → wallpaper companion recursion loop (per agent).
 *   - `switchEpochByAgent` (Map) in environmentStore — epoch guard for
 *     rapid consecutive environment switches (per agent).
 *
 * The main process cannot read renderer memory, so the renderer must push
 * these sizes explicitly. The main process registered an `ipcMain.on`
 * handler at `DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY` for exactly this
 * purpose — but until now, no renderer code ever called send().
 *
 * ## Lifecycle
 *
 * The hook starts the reporting timer on mount and clears it on unmount.
 * Reporting cadence (5s) matches the main-process broadcast interval, so
 * the main process always has a fresh sample when it constructs each
 * broadcast payload.
 */

import { useEffect } from 'react';
import { api } from '@/api/agentSkinClient';
import { getSwitchEpochSize } from '@/stores/environmentStore';
import { getCompanionBusySize } from '@/stores/wallpaperStore';

/** Reporting cadence in milliseconds — matches the main-process broadcast. */
export const REPORT_INTERVAL_MS = 5000;

/** Push one sample of renderer-side concurrency primitives to the main process. */
export function reportConcurrencyMetrics(): void {
  api.sendRendererConcurrencyMetrics(getCompanionBusySize(), getSwitchEpochSize());
}

/**
 * React hook: start reporting on mount, stop on unmount.
 * Uses a stable effect (empty deps) so the timer survives Strict Mode's
 * double-invoke without leaking.
 */
export function useConcurrencyReporter(): void {
  useEffect(() => {
    // Fire once immediately so the main process has data before the first
    // 5s tick (avoids a cold-start window where the renderer-side fields
    // show 0 even if a guard is already active).
    reportConcurrencyMetrics();
    const id = window.setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
