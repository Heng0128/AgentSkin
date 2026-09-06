// SPDX-License-Identifier: MPL-2.0

/**
 * # Permission Automation Policy Engine
 *
 * Implements a 3-tier automation strategy (off / auto-tools / unattended)
 * inspired by Clawd's permission model. Governs whether common AgentSkin
 * operations (apply theme, remove theme, etc.) can proceed automatically
 * or require explicit user confirmation.
 *
 * Architecture:
 *
 * ```
 *                  +-------------------------------+
 *                  |   PermissionAutomationPolicy   |
 *                  |                               |
 *                  |  +-------------------------+  |
 *                  |  |   PolicyConfig          |  |
 *                  |  | mode/whitelist/blacklist|  |
 *                  |  +------------+------------+  |
 *                  |               |               |
 *                  |  +------------v------------+  |
 *                  |  |  SessionGrantManager    |  |
 *                  |  | Map<action,Map<sess,exp>>| |
 *                  |  +-------------------------+  |
 *                  +-------------------------------+
 * ```
 *
 * Decision flow for `shouldAutomate`:
 *
 * ```
 *   +-- whitelist contains action? --+--yes--> true (always auto)
 *   |                                |
 *   no                               |
 *   +-- blacklist contains action? --+--yes--> false (always manual)
 *   |                                |
 *   no                               |
 *   +-- session granted & valid? ----+--yes--> true (per-session grant)
 *   |                                |
 *   no                               |
 *   +-- mode rule: off->false, auto-tools->risk!=high, unattended->true
 * ```
 *
 * Separated from any IPC or UI layer so the core logic remains fully
 * unit-testable in a Node environment.
 */

// ---------------------------------------------------------------------------
// PermissionAction
// ---------------------------------------------------------------------------

/** Risk levels for permission-sensitive operations. */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Enumerates all operations that the policy engine can govern.
 * Each action carries a static risk level used in automation decisions.
 */
export enum PermissionAction {
  /** Apply an installed theme to a target agent. */
  APPLY_THEME = 'APPLY_THEME',
  /** Remove an applied theme from a target agent. */
  REMOVE_THEME = 'REMOVE_THEME',
  /** Import a theme from an external source (file / URL / community). */
  IMPORT_THEME = 'IMPORT_THEME',
  /** Restore an agent to its native appearance (destructive - defaults). */
  RESTORE_DEFAULT = 'RESTORE_DEFAULT',
  /** Modify persistent settings (e.g. font size, accent overrides). */
  MODIFY_SETTINGS = 'MODIFY_SETTINGS',
  /** Inject arbitrary CSS into a target agent. */
  INJECT_CSS = 'INJECT_CSS',
}

/** Mapping of each action to its inherent risk level. */
const ACTION_RISK_LEVELS: Readonly<Record<PermissionAction, RiskLevel>> = {
  [PermissionAction.APPLY_THEME]: 'medium',
  [PermissionAction.REMOVE_THEME]: 'low',
  [PermissionAction.IMPORT_THEME]: 'low',
  [PermissionAction.RESTORE_DEFAULT]: 'high',
  [PermissionAction.MODIFY_SETTINGS]: 'medium',
  [PermissionAction.INJECT_CSS]: 'high',
};

/**
 * Returns the inherent risk level for a given permission action.
 *
 * @param action - The permission action to query.
 * @returns The associated risk level.
 */
export function getRiskLevel(action: PermissionAction): RiskLevel {
  return ACTION_RISK_LEVELS[action];
}

// ---------------------------------------------------------------------------
// AutomationMode
// ---------------------------------------------------------------------------

/**
 * Automation modes - mirrors Clawd's 3-tier permission model.
 *
 * - off          All operations require manual confirmation (default).
 * - auto-tools   Low and medium risk operations proceed automatically;
 *                high-risk operations still require confirmation.
 * - unattended   All operations proceed automatically unless explicitly
 *                blacklisted.
 */
export type AutomationMode = 'off' | 'auto-tools' | 'unattended';

// ---------------------------------------------------------------------------
// PolicyConfig
// ---------------------------------------------------------------------------

/** Context passed to `shouldAutomate` for extensibility. */
export interface ActionContext {
  /** Optional session identifier for per-session grant lookup. */
  sessionId?: string;
  /** Optional agent identifier for audit logging. */
  agentId?: string;
}

/**
 * Permission policy configuration interface.
 *
 * @property mode            - The active automation mode.
 * @property whitelist       - Actions that are always auto-approved
 *                             regardless of mode (even off).
 * @property blacklist       - Actions that always require manual
 *                             confirmation regardless of mode (even
 *                             unattended).
 * @property perSessionGrant - Whether per-session grants are tracked
 *                             and honored.
 * @property sessionTTL      - Time-to-live for per-session grants in ms.
 */
export interface PolicyConfig {
  mode: AutomationMode;
  whitelist: ReadonlySet<PermissionAction>;
  blacklist: ReadonlySet<PermissionAction>;
  perSessionGrant: boolean;
  sessionTTL: number;
}

/** The configuration schema version used for migration. */
export const POLICY_CONFIG_VERSION = 1;

/**
 * Creates a default PolicyConfig.
 *
 * Mode defaults to `off` (user must opt-in), with IMPORT_THEME whitelisted
 * (import is read-only / reverts cleanly) and RESTORE_DEFAULT blacklisted
 * (destructive - always confirm).
 *
 * @returns A new PolicyConfig with sensible defaults.
 */
export function createDefaultConfig(): PolicyConfig {
  return {
    mode: 'off',
    whitelist: Object.freeze(
      new Set([PermissionAction.IMPORT_THEME]),
    ) as ReadonlySet<PermissionAction>,
    blacklist: Object.freeze(
      new Set([PermissionAction.RESTORE_DEFAULT]),
    ) as ReadonlySet<PermissionAction>,
    perSessionGrant: false,
    sessionTTL: 3_600_000, // 1 hour
  };
}

// ---------------------------------------------------------------------------
// SessionGrantManager
// ---------------------------------------------------------------------------

/** Internal record tracking a single session grant's expiry timestamp. */
interface SessionRecord {
  /** Absolute expiry timestamp (ms since epoch). */
  expiresAt: number;
}

/**
 * Manages per-action, per-session grants with automatic expiry cleanup.
 *
 * Internal storage: `Map<PermissionAction, Map<sessionId, SessionRecord>>`.
 *
 * When the total number of active grant entries exceeds `maxSessions`, the
 * oldest expired entry is evicted; if none are expired, the oldest entry
 * (by insertion order) is evicted to make room.
 */
export class SessionGrantManager {
  /**
   * action to (sessionId to session record).
   * Records within each action map are maintained in insertion order
   * so that eviction can target the oldest entry deterministically.
   */
  private readonly grants = new Map<PermissionAction, Map<string, SessionRecord>>();

  /** Maximum total grant entries before eviction kicks in. */
  private readonly maxSessions: number;

  /** Time-to-live in ms applied to each grant. */
  private readonly ttl: number;

  /**
   * @param maxSessions - Maximum total grant entries (default 50).
   * @param ttl         - Grant time-to-live in ms (default 3_600_000).
   */
  constructor(maxSessions = 50, ttl = 3_600_000) {
    this.maxSessions = maxSessions;
    this.ttl = ttl;
  }

  /**
   * Grant a session permission for a specific action.
   * The grant expires after `ttl` milliseconds.
   *
   * @param action    - The action to grant.
   * @param sessionId - The session identifier.
   */
  grant(action: PermissionAction, sessionId: string): void {
    this.purgeExpired();

    let actionMap = this.grants.get(action);
    if (!actionMap) {
      actionMap = new Map();
      this.grants.set(action, actionMap);
    }

    // Delete-then-set to update insertion order so that re-granting
    // moves the entry to the newest position.
    actionMap.delete(sessionId);
    actionMap.set(sessionId, { expiresAt: Date.now() + this.ttl });

    this.enforceCapacity();
  }

  /**
   * Revoke a session grant.
   *
   * @param action    - The action to revoke.
   * @param sessionId - The session identifier.
   */
  revoke(action: PermissionAction, sessionId: string): void {
    const actionMap = this.grants.get(action);
    if (!actionMap) return;
    actionMap.delete(sessionId);
    if (actionMap.size === 0) {
      this.grants.delete(action);
    }
  }

  /**
   * Check whether a valid (non-expired) grant exists for the given action
   * and session. Expired records are lazily removed during this call.
   *
   * @param action    - The action to check.
   * @param sessionId - The session identifier.
   * @returns `true` if a valid grant exists.
   */
  isGranted(action: PermissionAction, sessionId: string): boolean {
    this.purgeExpired();

    const actionMap = this.grants.get(action);
    if (!actionMap) return false;

    const record = actionMap.get(sessionId);
    if (!record) return false;

    if (record.expiresAt <= Date.now()) {
      actionMap.delete(sessionId);
      if (actionMap.size === 0) {
        this.grants.delete(action);
      }
      return false;
    }

    return true;
  }

  /**
   * Returns the total number of active (non-expired) grant entries.
   *
   * @returns Active grant count.
   */
  size(): number {
    this.purgeExpired();
    let total = 0;
    for (const actionMap of this.grants.values()) {
      total += actionMap.size;
    }
    return total;
  }

  /**
   * Remove all grants that have expired.
   */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [action, actionMap] of this.grants) {
      for (const [sessionId, record] of actionMap) {
        if (record.expiresAt <= now) {
          actionMap.delete(sessionId);
        }
      }
      if (actionMap.size === 0) {
        this.grants.delete(action);
      }
    }
  }

  /**
   * Evict the oldest grant entry (by insertion order) if the total
   * count exceeds `maxSessions`.
   */
  private enforceCapacity(): void {
    let total = 0;
    for (const actionMap of this.grants.values()) {
      total += actionMap.size;
    }
    if (total <= this.maxSessions) return;

    // Evict from the actionMap with the most entries first to
    // distribute evictions evenly across actions.
    while (total > this.maxSessions) {
      let targetAction: PermissionAction | null = null;
      let maxSize = 0;
      for (const [action, actionMap] of this.grants) {
        if (actionMap.size > maxSize) {
          maxSize = actionMap.size;
          targetAction = action;
        }
      }
      if (!targetAction) break;

      const actionMap = this.grants.get(targetAction)!;
      const oldestKey = actionMap.keys().next().value;
      if (oldestKey === undefined) break;
      actionMap.delete(oldestKey);
      if (actionMap.size === 0) {
        this.grants.delete(targetAction);
      }
      total--;
    }
  }
}

// ---------------------------------------------------------------------------
// PolicyStatistics
// ---------------------------------------------------------------------------

/** Statistical snapshot of policy decisions (for diagnostics / dashboard). */
export interface PolicyStatistics {
  /** Current automation mode. */
  mode: AutomationMode;
  /** Number of actions in the whitelist. */
  whitelistSize: number;
  /** Number of actions in the blacklist. */
  blacklistSize: number;
  /** Number of active per-session grants. */
  activeSessionGrants: number;
  /** Whether per-session grants are enabled. */
  perSessionGrantEnabled: boolean;
}

// ---------------------------------------------------------------------------
// PermissionAutomationPolicy
// ---------------------------------------------------------------------------

/**
 * The core permission automation policy engine.
 *
 * Given a `PolicyConfig` and an optional `SessionGrantManager`, it decides
 * whether a given `PermissionAction` should proceed automatically or
 * require manual confirmation, following this decision hierarchy:
 *
 * 1. Whitelist   - if the action is in config.whitelist, auto-approve.
 * 2. Blacklist   - if the action is in config.blacklist, require manual.
 * 3. Per-session - if config.perSessionGrant is true and the session has
 *                  a valid grant, auto-approve.
 * 4. Mode rule   - off: require manual; auto-tools: high-risk requires
 *                  manual; unattended: auto-approve.
 */
export class PermissionAutomationPolicy {
  private config: PolicyConfig;
  private sessionManager: SessionGrantManager;

  /**
   * @param config          - The policy configuration. Defaults to
   *                          `createDefaultConfig()` if omitted.
   * @param sessionManager  - An optional external SessionGrantManager.
   *                          If omitted, a new one is created with defaults.
   */
  constructor(config?: PolicyConfig, sessionManager?: SessionGrantManager) {
    this.config = config ?? createDefaultConfig();
    this.sessionManager = sessionManager ?? new SessionGrantManager(50, this.config.sessionTTL);
  }

  /**
   * Determines whether the given action should be automated.
   *
   * @param action  - The permission action to evaluate.
   * @param context - Optional action context (e.g. sessionId for per-session
   *                  grant lookup).
   * @returns `true` if the action may proceed automatically.
   */
  shouldAutomate(action: PermissionAction, context?: ActionContext): boolean {
    // 1. Whitelist always wins.
    if (this.config.whitelist.has(action)) {
      return true;
    }

    // 2. Blacklist always overrides.
    if (this.config.blacklist.has(action)) {
      return false;
    }

    // 3. Per-session grant check.
    if (this.config.perSessionGrant && context?.sessionId) {
      if (this.sessionManager.isGranted(action, context.sessionId)) {
        return true;
      }
    }

    // 4. Mode-based rule.
    switch (this.config.mode) {
      case 'off':
        return false;
      case 'auto-tools':
        return ACTION_RISK_LEVELS[action] !== 'high';
      case 'unattended':
        return true;
      default:
        return false;
    }
  }

  /**
   * Grant a session permission for a specific action.
   *
   * @param action    - The action to grant.
   * @param sessionId - The session identifier.
   */
  grantSession(action: PermissionAction, sessionId: string): void {
    this.sessionManager.grant(action, sessionId);
  }

  /**
   * Revoke a previously granted session permission.
   *
   * @param action    - The action to revoke.
   * @param sessionId - The session identifier.
   */
  revokeSession(action: PermissionAction, sessionId: string): void {
    this.sessionManager.revoke(action, sessionId);
  }

  /**
   * Check whether a session has a valid (non-expired) grant for an action.
   *
   * @param action    - The action to check.
   * @param sessionId - The session identifier.
   * @returns `true` if a valid grant exists.
   */
  isSessionGranted(action: PermissionAction, sessionId: string): boolean {
    return this.sessionManager.isGranted(action, sessionId);
  }

  /**
   * Returns a statistical snapshot of the current policy state.
   *
   * @returns The current policy statistics.
   */
  getStatistics(): PolicyStatistics {
    return {
      mode: this.config.mode,
      whitelistSize: this.config.whitelist.size,
      blacklistSize: this.config.blacklist.size,
      activeSessionGrants: this.sessionManager.size(),
      perSessionGrantEnabled: this.config.perSessionGrant,
    };
  }

  /**
   * Returns the current policy configuration (read-only reference).
   *
   * @returns The active PolicyConfig.
   */
  getConfig(): PolicyConfig {
    return this.config;
  }

  /**
   * Updates the policy configuration.
   *
   * @param config - The new configuration to apply.
   */
  setConfig(config: PolicyConfig): void {
    this.config = config;
  }

  /**
   * Migrates a configuration from an older schema version to the current
   * version. Currently only version 0 (unversioned / legacy format) is
   * supported as a migration source - it fills in missing fields with
   * defaults.
   *
   * @param oldVersion - The schema version of the incoming config.
   * @param config     - The raw config object (unknown shape).
   * @returns A valid PolicyConfig for the current schema version.
   * @throws If `oldVersion` is greater than the current version.
   */
  static migrateConfig(oldVersion: number, config: unknown): PolicyConfig {
    if (oldVersion > POLICY_CONFIG_VERSION) {
      throw new Error(
        `Cannot migrate config from version ${oldVersion} to ${POLICY_CONFIG_VERSION}: downgrades are not supported`,
      );
    }

    if (oldVersion === POLICY_CONFIG_VERSION) {
      // Already current version - validate and return as-is if possible.
      if (config && typeof config === 'object' && 'mode' in (config as object)) {
        return config as PolicyConfig;
      }
    }

    // Version 0 to 1: legacy format, merge missing fields from defaults.
    const defaults = createDefaultConfig();
    const partial = (config ?? {}) as Record<string, unknown>;

    const rawWhitelist = Array.isArray(partial.whitelist)
      ? (partial.whitelist.filter((a): a is PermissionAction =>
          Object.values(PermissionAction).includes(a as PermissionAction),
        ) as PermissionAction[])
      : [...defaults.whitelist];

    const rawBlacklist = Array.isArray(partial.blacklist)
      ? (partial.blacklist.filter((a): a is PermissionAction =>
          Object.values(PermissionAction).includes(a as PermissionAction),
        ) as PermissionAction[])
      : [...defaults.blacklist];

    return {
      mode:
        typeof partial.mode === 'string' && isValidMode(partial.mode)
          ? (partial.mode as AutomationMode)
          : defaults.mode,
      whitelist: new Set([...defaults.whitelist, ...rawWhitelist]),
      blacklist: new Set([...defaults.blacklist, ...rawBlacklist]),
      perSessionGrant:
        typeof partial.perSessionGrant === 'boolean'
          ? partial.perSessionGrant
          : defaults.perSessionGrant,
      sessionTTL:
        typeof partial.sessionTTL === 'number' && partial.sessionTTL > 0
          ? partial.sessionTTL
          : defaults.sessionTTL,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Type guard for AutomationMode. */
function isValidMode(value: string): value is AutomationMode {
  return value === 'off' || value === 'auto-tools' || value === 'unattended';
}
