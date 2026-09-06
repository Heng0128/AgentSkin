// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # adapter-registry.mjs — Multi-App Adapter Registry
//
// Provides unified registration, discovery, compatibility checking, and
// health monitoring for AgentSkin's six adapters (traework, qoderwork,
// workbuddy, doubao, codex, zcode).
//
// Architecture:
//   AdapterRegistry
//        │
//        ├── register(agentId, metadata)   →  stores AdapterMetadata
//        ├── unregister(agentId)           →  removes adapter
//        ├── get(agentId)                  →  returns AdapterMetadata
//        ├── list()                        →  all registered adapters
//        ├── findByCapability(cap)         →  capability filter
//        ├── checkCompatibility(id, ver)   →  semver range check
//        ├── getHealth(agentId)            →  health status
//        └── runHealthCheck(agentId)       →  executes health probe
//
// Inspired by xxxhh336/dream-work-theme's app-registry architecture,
// adapted for AgentSkin's CDP injection model.

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {'win32'|'darwin'|'linux'} Platform
 */

/**
 * @typedef {Object} AdapterMetadata
 * @property {string} agentId           Unique identifier (e.g. "traework").
 * @property {string} name              Display name (e.g. "TRAE Work").
 * @property {Platform[]} platform      Supported platforms.
 * @property {string[]} capabilities    Capability tags (e.g. "cdp", "theme").
 * @property {{ min: string, max: string }} version  Compatible app version range.
 * @property {number} [cdpPort]         Default CDP WebSocket port.
 * @property {() => Promise<boolean>} [healthCheck]  Async health probe function.
 */

/**
 * @typedef {'healthy'|'unhealthy'|'unknown'} HealthStatus
 */

/**
 * @typedef {'registered'|'unregistered'|'healthChange'} RegistryEvent
 */

/**
 * @typedef {Object} HealthChangeEvent
 * @property {string} agentId    The adapter whose health changed.
 * @property {HealthStatus} prevStatus  Previous health status.
 * @property {HealthStatus} newStatus   New health status.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The six built-in adapter identifiers, frozen for immutability. */
export const BUILTIN_ADAPTERS = Object.freeze([
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
]);

/** Pre-built metadata for the six adapters. */
export const ADAPTER_PRESETS = Object.freeze({
  traework: {
    agentId: 'traework',
    name: 'TRAE Work',
    platform: ['win32', 'darwin'],
    capabilities: ['cdp', 'theme', 'injection'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9222,
  },
  qoderwork: {
    agentId: 'qoderwork',
    name: 'QoderWork',
    platform: ['win32', 'darwin'],
    capabilities: ['cdp', 'theme', 'injection'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9223,
  },
  workbuddy: {
    agentId: 'workbuddy',
    name: 'WorkBuddy',
    platform: ['win32', 'darwin', 'linux'],
    capabilities: ['cdp', 'theme', 'injection'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9224,
  },
  doubao: {
    agentId: 'doubao',
    name: '豆包 Desktop',
    platform: ['win32', 'darwin'],
    capabilities: ['cdp', 'theme', 'injection', 'background'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9225,
  },
  codex: {
    agentId: 'codex',
    name: 'OpenAI Codex',
    platform: ['win32', 'darwin', 'linux'],
    capabilities: ['cdp', 'theme', 'injection'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9226,
  },
  zcode: {
    agentId: 'zcode',
    name: 'ZCode',
    platform: ['win32', 'darwin'],
    capabilities: ['cdp', 'theme', 'injection'],
    version: { min: '1.0.0', max: '99.99.99' },
    cdpPort: 9227,
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an agentId is a non-empty string.
 * @param {string} agentId
 * @param {string} context - Caller context for error messages.
 * @throws {TypeError} If agentId is not a non-empty string.
 */
function assertAgentId(agentId, context) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new TypeError(`${context}: agentId must be a non-empty string`);
  }
}

/**
 * Validate that metadata is a non-null object with required fields.
 * @param {AdapterMetadata} metadata
 * @param {string} context - Caller context for error messages.
 * @throws {TypeError} If metadata is invalid.
 */
function assertMetadata(metadata, context) {
  if (!metadata || typeof metadata !== 'object') {
    throw new TypeError(`${context}: metadata must be a non-null object`);
  }
  if (typeof metadata.agentId !== 'string' || metadata.agentId.trim() === '') {
    throw new TypeError(`${context}: metadata.agentId must be a non-empty string`);
  }
  if (typeof metadata.name !== 'string' || metadata.name.trim() === '') {
    throw new TypeError(`${context}: metadata.name must be a non-empty string`);
  }
  if (!Array.isArray(metadata.platform) || metadata.platform.length === 0) {
    throw new TypeError(`${context}: metadata.platform must be a non-empty array`);
  }
  if (!Array.isArray(metadata.capabilities)) {
    throw new TypeError(`${context}: metadata.capabilities must be an array`);
  }
  if (!metadata.version || typeof metadata.version !== 'object') {
    throw new TypeError(`${context}: metadata.version must be an object`);
  }
  if (typeof metadata.version.min !== 'string' || typeof metadata.version.max !== 'string') {
    throw new TypeError(`${context}: metadata.version.min and .max must be strings`);
  }
}

/**
 * Parse a semver string into a comparable array [major, minor, patch].
 * Supports pre-release suffixes by stripping them for comparison.
 * @param {string} version
 * @returns {number[]} [major, minor, patch]
 */
function parseSemver(version) {
  const parts = version.trim().split('.');
  const nums = [];
  for (let i = 0; i < 3; i++) {
    const raw = parts[i] ?? '0';
    // Strip pre-release suffix (e.g. "1.0.0-beta" → "1.0.0")
    const cleaned = raw.replace(/-.*$/, '');
    const n = Number.parseInt(cleaned, 10);
    nums.push(Number.isNaN(n) ? 0 : n);
  }
  return nums;
}

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

/**
 * Central registry for adapter metadata, compatibility, and health tracking.
 *
 * Pre-loaded with the six built-in adapters. Supports custom registration,
 * capability-based discovery, version compatibility checks, and async
 * health monitoring with event notifications.
 */
export class AdapterRegistry {
  /** @type {Map<string, AdapterMetadata>} */
  #adapters;

  /** @type {Map<string, HealthStatus>} */
  #health;

  /** @type {Map<RegistryEvent, Set<Function>>} */
  #listeners;

  /**
   * Create a new AdapterRegistry, pre-loaded with the six built-in adapters.
   */
  constructor() {
    this.#adapters = new Map();
    this.#health = new Map();
    this.#listeners = new Map();

    // Pre-register the six built-in adapters.
    for (const agentId of BUILTIN_ADAPTERS) {
      const preset = ADAPTER_PRESETS[agentId];
      this.#adapters.set(agentId, {
        ...preset,
        platform: [...preset.platform],
        capabilities: [...preset.capabilities],
      });
      this.#health.set(agentId, 'unknown');
    }
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a new adapter or overwrite an existing one.
   *
   * Emits a `registered` event with the adapter metadata.
   *
   * @param {string} agentId - Unique adapter identifier.
   * @param {AdapterMetadata} metadata - Adapter metadata.
   * @throws {TypeError} If agentId or metadata is invalid.
   */
  register(agentId, metadata) {
    assertAgentId(agentId, 'register');
    assertMetadata(metadata, 'register');

    if (metadata.agentId !== agentId) {
      throw new Error(
        `register: metadata.agentId "${metadata.agentId}" does not match agentId "${agentId}"`,
      );
    }

    /** @type {AdapterMetadata} */
    const entry = {
      agentId: metadata.agentId,
      name: metadata.name,
      platform: [...metadata.platform],
      capabilities: [...metadata.capabilities],
      version: { min: metadata.version.min, max: metadata.version.max },
    };
    if (typeof metadata.cdpPort === 'number') {
      entry.cdpPort = metadata.cdpPort;
    }
    if (typeof metadata.healthCheck === 'function') {
      entry.healthCheck = metadata.healthCheck;
    }

    this.#adapters.set(agentId, entry);
    // Reset health status for newly registered adapters.
    const prevHealth = this.#health.get(agentId) ?? 'unknown';
    if (prevHealth !== 'unknown') {
      this.#health.set(agentId, 'unknown');
    }
    this.#emit('registered', entry);
  }

  /**
   * Unregister an adapter by its agentId.
   *
   * Emits an `unregistered` event with the removed metadata. Unregistering
   * a non-existent adapter is a silent no-op.
   *
   * @param {string} agentId - The adapter to remove.
   * @throws {TypeError} If agentId is not a non-empty string.
   */
  unregister(agentId) {
    assertAgentId(agentId, 'unregister');

    const metadata = this.#adapters.get(agentId);
    if (!metadata) return;

    this.#adapters.delete(agentId);
    this.#health.delete(agentId);
    this.#emit('unregistered', metadata);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get adapter metadata by agentId.
   *
   * @param {string} agentId - The adapter identifier.
   * @returns {AdapterMetadata|undefined} The metadata, or undefined if not found.
   */
  get(agentId) {
    return this.#adapters.get(agentId);
  }

  /**
   * List all registered adapters.
   *
   * @returns {AdapterMetadata[]} Array of all adapter metadata (insertion order).
   */
  list() {
    return [...this.#adapters.values()];
  }

  /**
   * Find adapters that declare a specific capability.
   *
   * @param {string} capability - Capability tag to search for (e.g. "cdp").
   * @returns {AdapterMetadata[]} Adapters that include the capability.
   */
  findByCapability(capability) {
    if (typeof capability !== 'string' || capability.trim() === '') {
      return [];
    }
    return this.list().filter((meta) => meta.capabilities.includes(capability));
  }

  // -----------------------------------------------------------------------
  // Compatibility
  // -----------------------------------------------------------------------

  /**
   * Check whether a given app version falls within the adapter's supported range.
   *
   * Uses inclusive bounds: min <= version <= max.
   *
   * @param {string} agentId - The adapter identifier.
   * @param {string} appVersion - The app version to check (semver string).
   * @returns {{ compatible: boolean, reason: string }}
   *   `compatible` indicates whether the version is in range;
   *   `reason` explains the result.
   * @throws {Error} If the adapter is not registered.
   */
  checkCompatibility(agentId, appVersion) {
    assertAgentId(agentId, 'checkCompatibility');

    const metadata = this.#adapters.get(agentId);
    if (!metadata) {
      throw new Error(`checkCompatibility: adapter "${agentId}" is not registered`);
    }
    if (typeof appVersion !== 'string' || appVersion.trim() === '') {
      return { compatible: false, reason: 'invalid version string' };
    }

    const { min, max } = metadata.version;
    if (compareSemver(appVersion, min) < 0) {
      return {
        compatible: false,
        reason: `version ${appVersion} is below minimum ${min}`,
      };
    }
    if (compareSemver(appVersion, max) > 0) {
      return {
        compatible: false,
        reason: `version ${appVersion} is above maximum ${max}`,
      };
    }
    return { compatible: true, reason: `version ${appVersion} is within range [${min}, ${max}]` };
  }

  // -----------------------------------------------------------------------
  // Health tracking
  // -----------------------------------------------------------------------

  /**
   * Get the current health status of an adapter.
   *
   * @param {string} agentId - The adapter identifier.
   * @returns {HealthStatus} `healthy`, `unhealthy`, or `unknown`.
   */
  getHealth(agentId) {
    return this.#health.get(agentId) ?? 'unknown';
  }

  /**
   * Run the health check for an adapter and update its status.
   *
   * If the adapter has no `healthCheck` function, the status remains
   * `unknown`. On success the status becomes `healthy`; on failure or
   * exception it becomes `unhealthy`.
   *
   * Emits a `healthChange` event when the status actually changes.
   *
   * @param {string} agentId - The adapter identifier.
   * @returns {Promise<HealthStatus>} The health status after the check.
   * @throws {Error} If the adapter is not registered.
   */
  async runHealthCheck(agentId) {
    assertAgentId(agentId, 'runHealthCheck');

    const metadata = this.#adapters.get(agentId);
    if (!metadata) {
      throw new Error(`runHealthCheck: adapter "${agentId}" is not registered`);
    }

    const prevStatus = this.#health.get(agentId) ?? 'unknown';

    if (typeof metadata.healthCheck !== 'function') {
      // No health check function — status stays unknown.
      return prevStatus;
    }

    let newStatus;
    try {
      const ok = await metadata.healthCheck();
      newStatus = ok ? 'healthy' : 'unhealthy';
    } catch {
      newStatus = 'unhealthy';
    }

    this.#health.set(agentId, newStatus);

    if (newStatus !== prevStatus) {
      this.#emit('healthChange', { agentId, prevStatus, newStatus });
    }

    return newStatus;
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  /**
   * Subscribe to a registry event.
   *
   * @param {RegistryEvent} event - Event name to listen for.
   * @param {Function} listener - Callback invoked when the event fires.
   * @returns {Function} Unsubscribe function that removes the listener.
   */
  on(event, listener) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Unsubscribe from a registry event.
   *
   * @param {RegistryEvent} event - Event name.
   * @param {Function} listener - The listener to remove.
   */
  off(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Remove all adapters, health data, and event listeners.
   *
   * After disposal, the registry can be reused by calling `register` again,
   * but previous state and listeners are gone.
   */
  dispose() {
    this.#adapters.clear();
    this.#health.clear();
    this.#listeners.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Emit an event to all registered listeners.
   *
   * Listener errors are caught and silently discarded so a misbehaving
   * listener cannot break the registry or other listeners.
   *
   * @param {RegistryEvent} event - Event name.
   * @param {unknown} payload - Event payload passed to listeners.
   */
  #emit(event, payload) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Listener errors do not affect the registry.
      }
    }
  }
}

export default AdapterRegistry;
