// SPDX-License-Identifier: MPL-2.0

import type { ElectronScanResult } from '@shared/types/agent';
import type { ScanCache } from '../types';

/** How long a completed scan result stays fresh in the in-memory cache. */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: ScanCache | null = null;

/** Return the cached entry when it is still within the TTL window, else null. */
export function freshCache(): ScanCache | null {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null;
}

/**
 * In-flight scan promise (single-flight guard). `useCache` callers that race
 * before the first scan has cached share this one promise instead of each
 * launching a full PowerShell-heavy sweep. Cleared once the scan settles.
 */
let inflight: Promise<ElectronScanResult> | null = null;

/** Read the in-flight scan promise (single-flight guard). */
export function getInflight(): Promise<ElectronScanResult> | null {
  return inflight;
}

/** Set (or clear) the in-flight scan promise. */
export function setInflight(p: Promise<ElectronScanResult> | null): void {
  inflight = p;
}

/** Return the cached scan result, or null if no fresh cached result exists. */
export function getCachedScan(): ElectronScanResult | null {
  return freshCache()?.result ?? null;
}

/** Discard any cached scan result. The next `scanElectronApps` call re-runs the full scan. */
export function invalidateScanCache(): void {
  cache = null;
}

/** Store a completed (non-timed-out) scan result in the cache. */
export function setCachedScan(result: ElectronScanResult): void {
  cache = { result, timestamp: Date.now() };
}
