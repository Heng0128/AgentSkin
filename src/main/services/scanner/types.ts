// SPDX-License-Identifier: MPL-2.0

import type { InstallHints } from '../../../adapters/base';
import type {
  AgentId,
  ElectronScanResult,
  ScanMeta,
  ScannedApp,
} from '../../../shared/types/agent';

export type { AgentId, ElectronScanResult, InstallHints, ScanMeta, ScannedApp };

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
  /** Called once per newly-discovered app (streaming progress, pre-dedupe). */
  onApp?: (app: ScannedApp) => void;
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
