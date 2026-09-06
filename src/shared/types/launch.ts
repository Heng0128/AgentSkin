// SPDX-License-Identifier: MPL-2.0

/** Parameters for launching a single application. */
export interface LaunchRequest {
  /** Unique app identifier (from `ScannedApp.id`). */
  readonly appId: string;
  /** Absolute path to the executable. */
  readonly exePath: string;
  /** Whether the app has an adapter (controls CDP flag injection). */
  readonly adapted: boolean;
  /**
   * Preferred CDP port. `null`/`undefined` = random port (0). Ignored when
   * `adapted === false`.
   */
  readonly preferredPort?: number | null;
  /**
   * When `true` and `preferredPort` is not explicitly given, the launcher
   * uses the adapter's configured preferred port instead of a random port.
   * Defaults to `false` (backward compatible — random port behavior).
   *
   * Set via user preference (e.g. settings toggle "Use fixed ports per
   * adapter") or by the apply flow for known adapters.
   */
  readonly useAdapterPreferredPort?: boolean;
  /** Kill any running instances before spawning a new one. */
  readonly forceRestart?: boolean;
  /**
   * AgentId of the backing adapter (required when `adapted === true`). Used
   * to resolve the adapter for `findRunningPids` / `resolveDebugPorts`.
   */
  readonly adapterId?: string;
}
