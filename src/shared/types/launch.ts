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
   * Defaults to `false` (random port behavior).
   *
   * 2026-09-07: since the no-fixed-port policy every built-in adapter's
   * preferred port is `0`, so this flag currently resolves to random for all
   * built-ins; only a future non-zero adapter config or user setting would
   * produce a fixed port.
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
