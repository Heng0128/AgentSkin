// SPDX-License-Identifier: MPL-2.0

/**
 * # Electron App Scanner
 *
 * Three-layer Windows scanner that discovers locally installed Electron
 * applications and classifies them as "adapted" (backed by an AgentSkin
 * adapter) or "other" (raw Electron, no backing adapter yet).
 *
 * Scan strategy:
 *   - **L1 — known agents**: for each of the 6 known AgentId, delegate to the
 *     existing `detectInstallation()` from `install-detection.ts`. Matched exes
 *     are tagged with their `adapterMatch: AgentId`.
 *   - **L2 — registry sweep**: enumerate `HKLM\...\Uninstall\*` and check
 *     whether any `InstallLocation` contains `resources/app.asar` or
 *     `resources/app`. Every hit is probed for its PE version info and matched
 *     against every adapter's `installHints`.
 *   - **L3 — filesystem sweep**: walk common Program Files / AppData roots,
 *     look for subdirectories containing `resources/app(.asar)`. Same PE probe
 *     + hint matching as L2.
 *
 * Deduplication uses SHA-256 (first 16 hex chars) of the exe path as the
 * stable `id`. An in-memory cache with a 5-minute TTL avoids repeated full
 * scans when the renderer polls the launcher repeatedly; callers can bypass
 * it with `useCache: false`.
 *
 * Timing: the whole operation is bounded by `SCAN_TIMEOUT_MS` (20s). On
 * timeout we return whatever partial results have been gathered so far.
 *
 * Module is main-process only (PowerShell via `execFileAsync`, registry,
 * filesystem). Renderer-facing IPC lives in the launcher handler — this module
 * returns plain data and stays testable.
 */

import type { ElectronScanResult, ScannedApp } from '../../../shared/types/agent';
import { mainWarn } from '../../logger';
import { isSkippableApp, scanFilesystem } from './collectors/filesystem';
import { scanKnownAgents } from './collectors/knownAgent';
import { scanRegistry } from './collectors/registry';
import { freshCache, getInflight, setCachedScan, setInflight } from './infra/cache';
import type { ScanOptions } from './types';

export { getCachedScan, invalidateScanCache } from './infra/cache';
export { matchAgainstHints } from './pipeline/match';
export type { ScanOptions };

/** Hard ceiling on how long a full scan may take before we return partial results. */
const SCAN_TIMEOUT_MS = 20_000;

/**
 * Run the three-layer Electron app scan and return the adapted/other split.
 *
 * The scan is bounded by {@link SCAN_TIMEOUT_MS}; on timeout whatever has been
 * collected so far is returned (best-effort).
 */
export async function scanElectronApps(options?: ScanOptions): Promise<ElectronScanResult> {
  const { useCache = true, extraDirs = [], onApp } = options ?? {};

  if (useCache) {
    const cached = freshCache();
    if (cached) return cached.result;
  }

  // Single-flight: a concurrent `useCache` call reuses the in-progress scan
  // rather than starting a duplicate (e.g. two renderer polls racing before
  // the first scan has cached).
  if (useCache) {
    const inFlight = getInflight();
    if (inFlight) return inFlight;
  }

  const run = (async (): Promise<ElectronScanResult> => {
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    const isTimedOut = () => Date.now() > deadline;

    const seen = new Map<string, ScannedApp>();

    const collect = (app: ScannedApp) => {
      if (seen.has(app.id)) return; // SHA-256 collision ≈ impossible; dedup by existing entry.
      if (isSkippableApp(app.exePath)) return;
      seen.set(app.id, app);
      mainWarn('ElectronScanner', `collect ${app.source}: ${app.productName} (${app.exePath})`);
      onApp?.(app);
    };

    // Track whether the scan hit the deadline. Partial (timed-out) results
    // must NOT be cached — a stale incomplete snapshot would be replayed to
    // every subsequent `useCache` caller until a manual force rescan.
    let timedOut = false;

    // L1 — known agents.
    const t1 = Date.now();
    await scanKnownAgents(collect, isTimedOut);
    mainWarn(
      'ElectronScanner',
      `L1 done ${Date.now() - t1}ms seen=${seen.size} timedOut=${isTimedOut()}`,
    );
    if (isTimedOut()) {
      timedOut = true;
      mainWarn('ElectronScanner', 'scan timed out after L1 — returning partial result');
    } else {
      // L2 — registry sweep.
      const t2 = Date.now();
      await scanRegistry(collect, isTimedOut);
      mainWarn(
        'ElectronScanner',
        `L2 done ${Date.now() - t2}ms seen=${seen.size} timedOut=${isTimedOut()}`,
      );
      if (isTimedOut()) {
        timedOut = true;
        mainWarn('ElectronScanner', 'scan timed out after L2 — returning partial result');
      } else {
        // L3 — filesystem sweep.
        const t3 = Date.now();
        await scanFilesystem(collect, isTimedOut, extraDirs);
        mainWarn(
          'ElectronScanner',
          `L3 done ${Date.now() - t3}ms seen=${seen.size} timedOut=${isTimedOut()}`,
        );
        if (isTimedOut()) {
          timedOut = true;
          mainWarn('ElectronScanner', 'scan timed out during L3 — returning partial result');
        }
      }
    }

    const adapted: ScannedApp[] = [];
    const other: ScannedApp[] = [];
    for (const app of seen.values()) {
      if (app.adapterMatch) adapted.push(app);
      else other.push(app);
    }

    const result: ElectronScanResult = { adapted, other };
    // Only complete (non-timed-out) results are cached; partial results are
    // returned to the caller but never persisted.
    if (!timedOut) {
      setCachedScan(result);
    }
    return result;
  })();

  if (useCache) {
    setInflight(run);
    try {
      return await run;
    } finally {
      setInflight(null);
    }
  }

  return run;
}
