// SPDX-License-Identifier: MPL-2.0

/**
 * # ZCode Adapter
 *
 * Active adapter backed by the engine's "zcode" adapter
 * (`src/engine/src/adapters/zcode.mjs`). ZCode is a packaged Electron
 * desktop app (v3.6.5+, product "ZCode", @zcode/desktop) shipping a local
 * Vite/React renderer (`file://` + `#root`), so it is CDP-themable like
 * Codex/Doubao. User-data lives under `%APPDATA%\ZCode\` (with the Chromium
 * profile in `session\`).
 *
 * ## Connection management
 *
 * `ZcodeConnectionManager` provides CDP connection state tracking and
 * intelligent reconnection. It implements a state machine
 * (DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → DISCONNECTED)
 * with transition history, quality metrics, and error-type-aware retry
 * decisions. It integrates with `PortLeasePool` for port allocation.
 */

import type { PortLeasePool } from '../../main/cdp/port-manager';
import { AGENT_META } from '../../shared/types';
import { WindowRole } from '../../shared/types/window-matcher';
import { BaseApplicationAdapter, type InstallHints } from '../base';

// ---------------------------------------------------------------------------
// Connection state types
// ---------------------------------------------------------------------------

/** CDP connection states. */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

/** Error categories for reconnection decisions. */
export enum ConnectionErrorCategory {
  /** Network timeout — immediate retry. */
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  /** CDP protocol error — exponential backoff retry. */
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  /** Target page crashed — wait for page recovery. */
  PAGE_CRASHED = 'PAGE_CRASHED',
  /** Unknown / unrecoverable error. */
  FATAL = 'FATAL',
}

/** A single state transition record. */
export interface StateTransition {
  /** The state transitioned from. */
  from: ConnectionState;
  /** The state transitioned to. */
  to: ConnectionState;
  /** Epoch timestamp (ms) of the transition. */
  timestamp: number;
  /** Optional reason for the transition. */
  reason?: string;
}

/** Connection quality metrics. */
export interface ConnectionQuality {
  /** Average round-trip latency in ms (exponential moving average). */
  averageLatencyMs: number;
  /** Connection success rate (0–1). */
  successRate: number;
  /** Total connection attempts. */
  totalAttempts: number;
  /** Total successful connections. */
  totalSuccesses: number;
  /** Total failed connections. */
  totalFailures: number;
}

/** Configuration for the connection manager. */
export interface ZcodeConnectionOptions {
  /** Maximum immediate retries for network timeouts. Default: 3. */
  maxImmediateRetries?: number;
  /** Maximum consecutive failures before giving up. Default: 5. */
  maxConsecutiveFailures?: number;
  /** Base delay for exponential backoff (ms). Default: 1000. */
  baseDelayMs?: number;
  /** Maximum backoff delay cap (ms). Default: 30000. */
  maxDelayMs?: number;
  /** Jitter factor 0–1. Default: 0.1. */
  jitterFactor?: number;
  /** Number of state transitions to retain in history. Default: 10. */
  historySize?: number;
  /** Timeout for page crash recovery wait (ms). Default: 10000. */
  pageRecoveryTimeoutMs?: number;
}

/** Port lease provider interface (dependency injection for testability). */
export interface PortLeaseProvider {
  acquire(timeoutMs?: number): Promise<{ port: number; leaseId: string }>;
  release(leaseId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classify an error into a {@link ConnectionErrorCategory} to drive the
 * reconnection decision. Inspects the error message and common CDP error
 * codes to determine the appropriate retry strategy.
 */
export function classifyConnectionError(error: unknown): ConnectionErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Page crash indicators
  if (
    lower.includes('target closed') ||
    lower.includes('target crashed') ||
    lower.includes('detached') ||
    lower.includes('renderer gone') ||
    lower.includes('page is gone')
  ) {
    return ConnectionErrorCategory.PAGE_CRASHED;
  }

  // Network timeout indicators
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up')
  ) {
    return ConnectionErrorCategory.NETWORK_TIMEOUT;
  }

  // Fatal / unrecoverable indicators
  if (
    lower.includes('fatal') ||
    lower.includes('unrecoverable') ||
    lower.includes('session is closed') ||
    lower.includes('reconnect exhausted')
  ) {
    return ConnectionErrorCategory.FATAL;
  }

  // Default: CDP protocol error (e.g. "Cannot navigate", "Internal error")
  return ConnectionErrorCategory.PROTOCOL_ERROR;
}

// ---------------------------------------------------------------------------
// ZcodeConnectionManager
// ---------------------------------------------------------------------------

/**
 * Manages CDP connection lifecycle for the ZCode adapter.
 *
 * Implements a state machine with transition history, quality metrics, and
 * error-type-aware retry decisions. Integrates with `PortLeasePool` for
 * port allocation.
 *
 * ### State machine
 *
 * ```
 * DISCONNECTED ──connect()──→ CONNECTING ──success──→ CONNECTED
 *      ↑                          │                      │
 *      │                          │ failure              │ disconnect
 *      │                          ▼                      ▼
 *      └────────────────── RECONNECTING ◄──────────────┘
 *           give up ↑ │    │ success
 *                   │ └────┘
 *                   └──────────── DISCONNECTED
 * ```
 */
export class ZcodeConnectionManager {
  private _state = ConnectionState.DISCONNECTED;
  private readonly history: StateTransition[] = [];
  private consecutiveFailures = 0;
  private totalAttempts = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private latencyEma = 0;
  private lastConnectTimestamp = 0;
  private currentPort: number | null = null;
  private currentLeaseId: string | null = null;

  private readonly maxImmediateRetries: number;
  private readonly maxConsecutiveFailures: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterFactor: number;
  private readonly historySize: number;
  private readonly pageRecoveryTimeoutMs: number;

  /** @param portPool - Optional PortLeasePool for port allocation. */
  constructor(
    private readonly portPool?: PortLeaseProvider,
    options: ZcodeConnectionOptions = {},
  ) {
    this.maxImmediateRetries = options.maxImmediateRetries ?? 3;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.jitterFactor = options.jitterFactor ?? 0.1;
    this.historySize = options.historySize ?? 10;
    this.pageRecoveryTimeoutMs = options.pageRecoveryTimeoutMs ?? 10000;
  }

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** Whether the connection is in CONNECTED state. */
  get isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /** Current port number (null if not connected). */
  get port(): number | null {
    return this.currentPort;
  }

  /** Current lease ID (null if no lease held). */
  get leaseId(): string | null {
    return this.currentLeaseId;
  }

  /** Number of consecutive failures. */
  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * Get a snapshot of the state transition history (most recent last).
   * Returns at most `historySize` entries.
   */
  getTransitionHistory(): ReadonlyArray<StateTransition> {
    return [...this.history];
  }

  /**
   * Get current connection quality metrics.
   */
  getQuality(): ConnectionQuality {
    return {
      averageLatencyMs: this.latencyEma,
      successRate: this.totalAttempts > 0 ? this.totalSuccesses / this.totalAttempts : 0,
      totalAttempts: this.totalAttempts,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Transition to a new state, recording the transition in history.
   *
   * @param to - The target state.
   * @param reason - Optional reason for the transition.
   */
  private transition(to: ConnectionState, reason?: string): void {
    const from = this._state;
    if (from === to) return;

    this._state = to;
    this.history.push({ from, to, timestamp: Date.now(), reason });

    // Trim history to the configured size
    while (this.history.length > this.historySize) {
      this.history.shift();
    }
  }

  /**
   * Record a successful connection. Updates quality metrics and transitions
   * to CONNECTED.
   *
   * @param port - The port number that was connected.
   * @param leaseId - The lease ID from PortLeasePool (if applicable).
   */
  recordConnected(port: number, leaseId?: string): void {
    this.totalAttempts++;
    this.totalSuccesses++;
    this.consecutiveFailures = 0;

    // Update latency EMA (alpha = 0.3 for responsiveness)
    if (this.lastConnectTimestamp > 0) {
      const latency = Date.now() - this.lastConnectTimestamp;
      this.latencyEma = this.latencyEma === 0 ? latency : this.latencyEma * 0.7 + latency * 0.3;
    }

    this.currentPort = port;
    this.currentLeaseId = leaseId ?? null;
    this.transition(ConnectionState.CONNECTED);
  }

  /**
   * Record a connection failure. Updates quality metrics and determines
   * the next action based on the error category.
   *
   * @param error - The error that caused the failure.
   * @returns A {@link ReconnectDecision} indicating what to do next.
   */
  recordFailure(error: unknown): ReconnectDecision {
    this.totalAttempts++;
    this.totalFailures++;
    this.consecutiveFailures++;

    const category = classifyConnectionError(error);

    // Check if we've exhausted all retries
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.transition(
        ConnectionState.DISCONNECTED,
        `max consecutive failures reached (${this.maxConsecutiveFailures})`,
      );
      return { action: 'give_up', reason: `连续失败 ${this.consecutiveFailures} 次，放弃重连` };
    }

    switch (category) {
      case ConnectionErrorCategory.NETWORK_TIMEOUT:
        return this.handleNetworkTimeout();

      case ConnectionErrorCategory.PROTOCOL_ERROR:
        return this.handleProtocolError();

      case ConnectionErrorCategory.PAGE_CRASHED:
        return this.handlePageCrashed();

      default:
        this.transition(
          ConnectionState.DISCONNECTED,
          `fatal error: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { action: 'give_up', reason: '不可恢复错误' };
    }
  }

  /**
   * Handle network timeout: immediate retry up to maxImmediateRetries.
   */
  private handleNetworkTimeout(): ReconnectDecision {
    if (this.consecutiveFailures <= this.maxImmediateRetries) {
      this.transition(ConnectionState.RECONNECTING, 'network timeout — immediate retry');
      return { action: 'retry_immediate', delayMs: 0 };
    }
    // Fall through to exponential backoff after max immediate retries
    return this.handleProtocolError();
  }

  /**
   * Handle protocol error: exponential backoff retry.
   */
  private handleProtocolError(): ReconnectDecision {
    const delay = this.calculateBackoffDelay();
    this.transition(ConnectionState.RECONNECTING, 'protocol error — backoff retry');
    return { action: 'retry_with_delay', delayMs: delay };
  }

  /**
   * Handle page crash: wait for recovery then retry.
   */
  private handlePageCrashed(): ReconnectDecision {
    this.transition(ConnectionState.RECONNECTING, 'page crashed — waiting for recovery');
    return {
      action: 'wait_for_recovery',
      delayMs: Math.min(this.pageRecoveryTimeoutMs, this.calculateBackoffDelay()),
    };
  }

  /**
   * Calculate exponential backoff delay with jitter.
   *
   * Formula: min(baseDelayMs × 2^(n-1), maxDelayMs) × (1 ± jitterFactor)
   */
  private calculateBackoffDelay(): number {
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (this.consecutiveFailures - 1));
    const jitter = exp * this.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(exp + jitter));
  }

  /**
   * Begin a connection attempt. Transitions to CONNECTING and records the
   * timestamp for latency measurement.
   */
  beginConnect(): void {
    this.lastConnectTimestamp = Date.now();
    this.transition(ConnectionState.CONNECTING);
  }

  /**
   * Acquire a port from the PortLeasePool (if configured).
   *
   * @returns The acquired port and lease ID, or null if no pool is configured.
   * @throws Error if the pool is exhausted.
   */
  async acquirePort(): Promise<{ port: number; leaseId: string } | null> {
    if (!this.portPool) return null;
    const lease = await this.portPool.acquire();
    this.currentPort = lease.port;
    this.currentLeaseId = lease.leaseId;
    return { port: lease.port, leaseId: lease.leaseId };
  }

  /**
   * Release the current port lease back to the pool.
   */
  async releasePort(): Promise<void> {
    if (this.portPool && this.currentLeaseId) {
      await this.portPool.release(this.currentLeaseId);
    }
    this.currentPort = null;
    this.currentLeaseId = null;
  }

  /**
   * Handle an unexpected disconnect (e.g. WebSocket closed by remote).
   * Releases the port lease and transitions to RECONNECTING.
   */
  async handleDisconnect(): Promise<void> {
    await this.releasePort();
    if (this._state === ConnectionState.CONNECTED) {
      this.transition(ConnectionState.RECONNECTING, 'unexpected disconnect');
    }
  }

  /**
   * Reset the connection manager to its initial state. Releases any held
   * port lease and clears all metrics.
   */
  async reset(): Promise<void> {
    await this.releasePort();
    this._state = ConnectionState.DISCONNECTED;
    this.history.length = 0;
    this.consecutiveFailures = 0;
    this.totalAttempts = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.latencyEma = 0;
    this.lastConnectTimestamp = 0;
  }
}

/** Reconnection decision returned by {@link ZcodeConnectionManager.recordFailure}. */
export interface ReconnectDecision {
  /** The recommended action. */
  action: 'retry_immediate' | 'retry_with_delay' | 'wait_for_recovery' | 'give_up';
  /** Delay in ms before the next action (0 for immediate). */
  delayMs?: number;
  /** Human-readable reason for the decision. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// ZcodeAdapter (existing, unchanged interface)
// ---------------------------------------------------------------------------

export class ZcodeAdapter extends BaseApplicationAdapter {
  readonly id = 'zcode';
  readonly name = AGENT_META.zcode.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'zcode';

  /**
   * AgentSkin-side install detection hints. The Windows installer is
   * Squirrel-based (ZCode.exe + Uninstall ZCode.exe in C:\Program Files\ZCode),
   * so the exe-name/registry probes below let AgentSkin confirm a local
   * install even when the app is closed.
   */
  override readonly installHints: InstallHints = {
    dirNames: ['ZCode'],
    exeNames: ['ZCode.exe'],
    registryNames: ['ZCode'],
  };

  /**
   * 多窗口声明（P0-2）。ZCode 主窗口为 file:// 渲染器 + 可能的 settings 子窗口。
   * 主窗口走完整引擎注入。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['zcode', 'app.asar'],
      label: 'ZCode main',
    },
    {
      role: WindowRole.Settings,
      patterns: ['*/settings*', '*/preferences*', 'settings'],
      label: 'ZCode settings',
    },
  ] as const;

  /**
   * Optional connection manager for CDP connection state tracking and
   * intelligent reconnection. Adapters that need advanced connection
   * management can instantiate this with a PortLeasePool reference.
   */
  readonly connectionManager: ZcodeConnectionManager;

  constructor(portPool?: PortLeasePool) {
    super();
    const pool: PortLeaseProvider | undefined = portPool
      ? {
          acquire: (timeoutMs) => portPool.acquire(timeoutMs),
          release: (leaseId) => portPool.release(leaseId),
        }
      : undefined;
    this.connectionManager = new ZcodeConnectionManager(pool);
  }
}
