// SPDX-License-Identifier: MPL-2.0

import type { InstallHints } from '../../../adapters/base';
import type {
  AgentId,
  ElectronScanResult,
  ScanMeta,
  ScannedApp,
  ScanProgressEvent,
} from '../../../shared/types/agent';

export type { AgentId, ElectronScanResult, ScanMeta, ScannedApp, ScanProgressEvent };

/** Snapshot of a single scan result plus the timestamp it was stored. */
export interface ScanCache {
  result: ElectronScanResult;
  timestamp: number;
}

/** Options controlling a single scan invocation. */
export interface ScanOptions {
  /** Return a cached result if one exists. Defaults to true. */
  useCache?: boolean;
  /** Additional directories to include in the L3 filesystem sweep. */
  extraDirs?: string[];
  /**
   * Called once per streaming progress event (identity-merged: `add` for a
   * new product, `update` when a better entry replaces one already emitted).
   */
  onApp?: (event: ScanProgressEvent) => void;
  /**
   * Electron `app.getPath('userData')` root. When provided, the scanner reads
   * the persisted cross-session cache (`<userData>/scan-cache.json`) before
   * launching a full scan, and writes a fresh cache after a successful scan.
   * Leave undefined to disable persistence (e.g. in unit tests).
   */
  userDataPath?: string;
  /**
   * Validate that each cached app's `exePath` still exists before returning a
   * persisted or in-memory cached result. Prunes ghost entries (uninstalled
   * software) so the launcher never shows dead tiles. Defaults to true when
   * `userDataPath` is set.
   */
  validateExistence?: boolean;
}

/**
 * A scan root plus the maximum directory depth to descend when hunting for
 * `resources/app(.asar)`.
 */
export interface ScanRoot {
  dir: string;
  depth: number;
}

/** Multi-signal Electron detection result: a boolean plus a 0-100 confidence score. */
export interface ElectronMarker {
  isElectron: boolean;
  confidence: number;
}
