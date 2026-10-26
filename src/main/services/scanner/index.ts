// SPDX-License-Identifier: MPL-2.0

/**
 * # Electron App Scanner
 *
 * Five-layer Windows scanner that discovers locally installed Electron
 * applications and classifies them as "adapted" (backed by an AgentSkin
 * adapter) or "other" (raw Electron, no backing adapter yet).
 *
 * Scan strategy:
 *   - **L1 — known agents**: for each of the 6 known AgentId, delegate to the
 *     existing `detectInstallation()` from `install-detection.ts`. Matched exes
 *     are tagged with their `adapterMatch: AgentId`.
 *   - **L2 — registry sweep**: enumerate the Uninstall registry
 *     (HKLM 64-bit + WOW6432Node 32-bit + HKCU per-user) and check whether any
 *     `InstallLocation` contains `resources/app.asar` or `resources/app`. Every
 *     hit is probed for its PE version info and matched against every adapter's
 *     `installHints`.
 *   - **L2.5 — MSIX sweep**: `Get-AppxPackage` enumeration for Store-packaged
 *     apps the Uninstall registry never lists (see `collectors/msix.ts`).
 *   - **L3 — filesystem sweep**: walk common Program Files / AppData roots,
 *     look for subdirectories containing `resources/app(.asar)`. Same PE probe
 *     + hint matching as L2.
 *   - **L3.5 — Start-menu shortcut sweep**: resolve `.lnk` targets for
 *     green/portable Electron software the registry + filesystem sweeps both
 *     missed (see `collectors/shortcut.ts`).
 *
 * The five layers form the discovery union; identities are deduplicated by
 * normalized `productName | companyName` (StreamMerge) so the same app found
 * by multiple layers folds into one entry, keeping the most user-facing
 * source (`agent` > `registry` > `msix` > `shortcut` > `filesystem`). An
 * in-memory cache with a 5-minute TTL avoids repeated full scans when the
 * renderer polls the launcher repeatedly; callers can bypass it with
 * `useCache: false`.
 *
 * Timing: the whole operation is bounded by `SCAN_TIMEOUT_MS` (35s). On
 * timeout we return whatever partial results have been gathered so far.
 *
 * Module is main-process only (PowerShell via `execFileAsync`, registry,
 * filesystem). Renderer-facing IPC lives in the launcher handler — this module
 * returns plain data and stays testable.
 */

import { normalizeProductName } from '../../../shared/app-identity';
import type {
  ElectronScanResult,
  ScanMeta,
  ScannedApp,
  ScanProgressEvent,
} from '../../../shared/types/agent';
import { mainWarn } from '../../logger';
import { extractAppIcon } from '../app-icon';
import {
  isSkippableApp,
  resolveScanRoots,
  scanFilesystem,
  scanFilesystemParallel,
} from './collectors/filesystem';
import { scanKnownAgents } from './collectors/knownAgent';
import { scanMsixPackages } from './collectors/msix';
import { scanRegistry, scanRegistryV2 } from './collectors/registry';
import type { RegistryNameIndex } from './collectors/shared';
import { scanStartMenuShortcuts } from './collectors/shortcut';
import { scannerPipeline } from './flags';
import { freshCache, getInflight, setCachedScan, setInflight } from './infra/cache';
import { loadPersistedScan, savePersistedScan } from './infra/persist-cache';
import { validateExistence } from './infra/validate';
import { StreamMerge } from './pipeline/stream-merge';
import type { ScanOptions } from './types';

export { resolveScanRoots } from './collectors/filesystem';
export { parseMsixLine, pickMsixIcon, scanMsixPackages } from './collectors/msix';
export {
  nameFromShortcut,
  parseShortcutLine,
  scanStartMenuShortcuts,
  startMenuRoots,
} from './collectors/shortcut';
export { scannerPipeline } from './flags';
export { getCachedScan, invalidateScanCache } from './infra/cache';
export { loadPersistedScan, savePersistedScan } from './infra/persist-cache';
export { validateExistence } from './infra/validate';
export { matchAgainstHints } from './pipeline/match';
export type { ScanOptions };

/** Hard ceiling on how long a full scan may take before we return partial results. */
const SCAN_TIMEOUT_MS = 35_000;

/** Interval (ms) between streaming individual cached apps to the renderer on a cache hit. */
const SCAN_STREAM_INTERVAL_MS = 10;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Guards against concurrent background re-scans after a cache hit. */
let backgroundInflight: Promise<void> | null = null;

/**
 * Enrich unadapted apps with real icons (data URLs), streaming each one to the
 * renderer as it resolves so tiles upgrade from a letter placeholder to a real
 * icon without waiting for the whole batch. Adapted apps already render their
 * bundled brand logo (`AppMark`), so only `other` is processed.
 *
 * Apps that already carry an `iconPath` (e.g. replayed from a persisted cache
 * that previously enriched them) are skipped — no redundant extraction, no
 * accidental overwrite.
 *
 * Icon extraction runs **outside** the `SCAN_TIMEOUT_MS` budget — it is a
 * cosmetic enrichment and must never fail the scan. Extraction errors degrade
 * to the renderer's letter placeholder.
 */
async function enrichIcons(
  result: ElectronScanResult,
  onApp?: (event: ScanProgressEvent) => void,
): Promise<ElectronScanResult> {
  const otherWithIcons = await Promise.all(
    result.other.map(async (app) => {
      if (app.iconPath) return app;
      // The scan may have discovered a curated icon location (MSIX Assets
      // PNG / Start-menu .ico); it ranks between the PE probe and the OS
      // shell icon inside extractAppIcon.
      const iconPath = await extractAppIcon(app.exePath, app.iconHint);
      if (!iconPath) return app;
      onApp?.({ op: 'icon', appId: app.id, iconPath });
      return { ...app, iconPath };
    }),
  );
  return { ...result, other: otherWithIcons };
}

/**
 * Run the three-layer Electron app scan and return the adapted/other split.
 *
 * The scan is bounded by {@link SCAN_TIMEOUT_MS}; on timeout whatever has been
 * collected so far is returned (best-effort).
 */
export async function scanElectronApps(options?: ScanOptions): Promise<ElectronScanResult> {
  const {
    useCache = true,
    extraDirs = [],
    onApp,
    userDataPath,
    validateExistence: shouldValidate = true,
  } = options ?? {};

  if (useCache) {
    const cached = freshCache();
    if (cached) return cached.result;
  }

  // Persisted cross-session cache: warm the launcher on a cold Electron start
  // (process restart) by replaying yesterday's successful scan. Cheaper than a
  // full sweep and covers the "re-open the launcher an hour later" flow.
  // Stale entries (uninstalled software) are pruned by `validateExistence`.
  //
  // Skipped when:
  //   - useCache=false (manual force-rescan) — caller wants a real re-sweep.
  //   - userDataPath unset (unit tests, caller didn't wire the Electron
  //     userData root) — persistence disabled.
  if (useCache && userDataPath) {
    const persisted = await loadPersistedScan(userDataPath);
    if (persisted) {
      // A persisted cache is stale-by-definition — prune ghosts the user
      // has uninstalled since the last scan.
      const validated = shouldValidate
        ? await validateExistence(persisted.result)
        : persisted.result;
      // Seed the in-memory cache so the next 5-min poll avoids disk I/O.
      setCachedScan(validated);

      // Stream the cached apps to the renderer so the list appears
      // incrementally (same UX as a live scan) rather than all at once.
      if (onApp) {
        for (const app of [...validated.adapted, ...validated.other]) {
          onApp({ op: 'add', app });
          await delay(SCAN_STREAM_INTERVAL_MS);
        }
      }

      // Fire-and-forget background re-scan: a persisted cache is stale-by-definition,
      // so kick off a full sweep to pick up newly installed software. The in-memory
      // cache is already seeded with the persisted result, so the renderer shows the
      // old list instantly and new apps appear as they're found.
      if (!backgroundInflight) {
        backgroundInflight = (async () => {
          try {
            const fresh = await scanElectronApps({
              useCache: false,
              extraDirs,
              onApp,
              userDataPath,
              validateExistence: shouldValidate,
            });
            setCachedScan(fresh);
          } catch (error) {
            mainWarn(
              'ElectronScanner',
              `background re-scan failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            backgroundInflight = null;
          }
        })();
      }

      return validated;
    }
  }

  // Single-flight: a concurrent `useCache` call reuses the in-progress scan
  // rather than starting a duplicate (e.g. two renderer polls racing before
  // the first scan has cached).
  if (useCache) {
    const inFlight = getInflight();
    if (inFlight) return inFlight;
  }

  const run = (async (): Promise<ElectronScanResult> => {
    const startedAt = Date.now();
    const deadline = startedAt + SCAN_TIMEOUT_MS;
    const isTimedOut = () => Date.now() > deadline;
    const pipeline = scannerPipeline();

    // L2 populates this with a registry DisplayName per exe so L3 can backfill
    // a proper product name when an app's PE block has no ProductName (avoids
    // degrading to the raw exe filename, which for a few apps ≠ the product).
    const registryNameIndex: RegistryNameIndex = new Map();
    // Identity-merged collect: every discovered app folds into the stream
    // merger (one entry per product), and the renderer gets a clean
    // `add`/`update` event stream instead of the raw multi-version flood —
    // so the streaming phase and the final result are the same data.
    const merger = new StreamMerge();

    const collect = (app: ScannedApp) => {
      if (isSkippableApp(app.exePath)) return;
      const op = merger.upsert(app);
      if (op === 'discard') return;
      mainWarn(
        'ElectronScanner',
        `collect ${op} ${app.source}: ${app.productName} (${app.exePath})`,
      );
      onApp?.({ op, app });
    };

    // Track whether the scan hit the deadline. Partial (timed-out) results
    // must NOT be cached — a stale incomplete snapshot would be replayed to
    // every subsequent `useCache` caller until a manual force rescan.
    let timedOut = false;
    const degradedSources: string[] = [];

    // Resolve the L3 roots once up front so `meta.scannedRoots` reports the
    // exact set the sweep was (or would have been) given.
    const resolvedRoots = resolveScanRoots(extraDirs);

    // L1 — known agents.
    const t1 = Date.now();
    await scanKnownAgents(collect, isTimedOut);
    mainWarn(
      'ElectronScanner',
      `L1 done ${Date.now() - t1}ms seen=${merger.size} timedOut=${isTimedOut()}`,
    );
    if (isTimedOut()) {
      timedOut = true;
      degradedSources.push('L2', 'L3');
      mainWarn('ElectronScanner', 'scan timed out after L1 — returning partial result');
    } else {
      // L2 — registry sweep.
      const t2 = Date.now();
      // Products already discovered by L1 — the v2 sweep skips re-reading PE
      // info for these (the known-agent probe already has authoritative
      // identity + version).
      const knownProducts = new Set(
        merger.entries().map((a) => normalizeProductName(a.productName || a.exePath)),
      );
      if (pipeline === 'v2') {
        await scanRegistryV2(collect, isTimedOut, knownProducts, registryNameIndex);
      } else {
        await scanRegistry(collect, isTimedOut, registryNameIndex);
      }
      mainWarn(
        'ElectronScanner',
        `L2 done ${Date.now() - t2}ms seen=${merger.size} timedOut=${isTimedOut()}`,
      );
      if (isTimedOut()) {
        timedOut = true;
        degradedSources.push('L3');
        mainWarn('ElectronScanner', 'scan timed out after L2 — returning partial result');
      } else {
        // L2.5 — MSIX / Store packages (skipped entirely on timeout; the
        // registry sweep above never sees them).
        const t25 = Date.now();
        await scanMsixPackages(collect, isTimedOut);
        mainWarn(
          'ElectronScanner',
          `L2.5 done ${Date.now() - t25}ms seen=${merger.size} timedOut=${isTimedOut()}`,
        );
        // L3 — filesystem sweep.
        const t3 = Date.now();
        if (pipeline === 'v2') {
          await scanFilesystemParallel(collect, isTimedOut, extraDirs, registryNameIndex);
        } else {
          await scanFilesystem(collect, isTimedOut, extraDirs, registryNameIndex);
        }
        mainWarn(
          'ElectronScanner',
          `L3 done ${Date.now() - t3}ms seen=${merger.size} timedOut=${isTimedOut()}`,
        );
        if (isTimedOut()) {
          timedOut = true;
          degradedSources.push('L3');
          mainWarn('ElectronScanner', 'scan timed out during L3 — returning partial result');
        } else {
          // L3.5 — Start-menu shortcut sweep (green/portable software the
          // registry + filesystem sweeps both missed).
          const t35 = Date.now();
          await scanStartMenuShortcuts(collect, isTimedOut);
          mainWarn(
            'ElectronScanner',
            `L3.5 done ${Date.now() - t35}ms seen=${merger.size} timedOut=${isTimedOut()}`,
          );
        }
      }
    }

    // The final result is exactly what was streamed (identity-merged), so the
    // renderer's incremental merges and the settled result can never diverge.
    // Sections sort by display name for a stable, scannable grid order — the
    // renderer renders in array order and has no sort of its own.
    const byName = (a: ScannedApp, b: ScannedApp) =>
      a.productName.localeCompare(b.productName, 'zh-Hans-CN', { sensitivity: 'base' });
    const merged = merger.finalize().sort(byName);
    const adapted = merged.filter((a) => a.adapterMatch);
    const other = merged.filter((a) => !a.adapterMatch);

    const meta: ScanMeta = {
      timedOut,
      degradedSources,
      scannedRoots: resolvedRoots.map((root) => root.dir),
      durationMs: Date.now() - startedAt,
      collectedAt: Date.now(),
      pipeline,
    };

    const result: ElectronScanResult = { adapted, other, meta };

    // Icon enrichment runs outside the scan timeout budget — a cosmetic step
    // that must never fail the scan. Done BEFORE caching so both the in-memory
    // and persisted caches carry icons (avoids the "background re-scan clears
    // icons" bug where a non-enriched result would overwrite the enriched one).
    const enriched = await enrichIcons(result, onApp);

    // Only complete (non-timed-out) results are cached; partial results are
    // returned to the caller but never persisted.
    if (!timedOut) {
      setCachedScan(enriched);
      // Persist the complete result to disk so a future cold Electron start
      // can skip the full sweep. Failures are swallowed inside
      // `savePersistedScan` — a cache write issue must not fail the scan.
      if (userDataPath) {
        void savePersistedScan(userDataPath, enriched);
      }
    }
    mainWarn(
      'ElectronScanner',
      `scan complete pipeline=${pipeline} adapted=${adapted.length} other=${other.length} degraded=${degradedSources.join(',') || 'none'} ${meta.durationMs}ms`,
    );
    return enriched;
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
