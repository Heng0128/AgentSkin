// SPDX-License-Identifier: MIT
//
// # purge-engine.mjs — Zero-Residual Cleanup Engine
//
// Provides a whitelist-based cleanup mechanism for theme injection residuals.
// When switching themes, previously injected DOM decorations, CSS variables,
// timers, global state, and body classes must be fully removed to prevent
// cross-theme contamination.
//
// Architecture:
//   1. createPurgeContract — Declares what a theme injected (the "whitelist").
//   2. purge(contract)     — Executes cleanup against a live DOM/window.
//   3. verifyPurge(contract) — Confirms all injected artifacts are gone.
//   4. contractFromManifest(path) — Builds a contract from a manifest.json.
//
// The engine is environment-agnostic: it accepts an optional `host` object
// (defaults to `globalThis`) and `document` (defaults to `globalThis.document`)
// so it can run in both real browser contexts and test (happy-dom) contexts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PurgeContract
 * @property {string[]} domIds - Injected DOM element IDs to remove.
 * @property {string[]} cssVars - Injected CSS variable names to remove (on document.documentElement).
 * @property {string[]} timers - Timer keys in the global timer registry to clear.
 * @property {string[]} globalState - Global state keys to delete from the host object.
 * @property {string[]} classList - Body class names to remove.
 * @property {object} [_refs] - Internal references populated during purge (timers, state).
 */

/**
 * @typedef {Object} PurgeReport
 * @property {number} domRemoved - Number of DOM elements successfully removed.
 * @property {number} cssVarsRemoved - Number of CSS variables successfully removed.
 * @property {number} timersCleared - Number of timers successfully cleared.
 * @property {number} stateCleared - Number of global state keys successfully deleted.
 * @property {number} classesRemoved - Number of body classes successfully removed.
 * @property {string[]} errors - Non-fatal error messages encountered during cleanup.
 * @property {boolean} success - True if all categories reported zero errors.
 */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default host object (browser: window; node: globalThis). */
const DEFAULT_HOST = globalThis;

// ---------------------------------------------------------------------------
// Contract creation
// ---------------------------------------------------------------------------

/**
 * Create a purge contract that declares all artifacts a theme injection
 * may have produced. The contract serves as both the cleanup instruction
 * set and the verification checklist.
 *
 * @param {Object} config - Configuration object.
 * @param {string[]} [config.domIds=[]] - Injected DOM element IDs.
 * @param {string[]} [config.cssVars=[]] - Injected CSS variable names.
 * @param {string[]} [config.timers=[]] - Timer keys in the global registry.
 * @param {string[]} [config.globalState=[]] - Global state keys.
 * @param {string[]} [config.classList=[]] - Body class names.
 * @returns {PurgeContract} A normalized purge contract.
 */
export function createPurgeContract(config = {}) {
  return {
    domIds: [...(config.domIds ?? [])],
    cssVars: [...(config.cssVars ?? [])],
    timers: [...(config.timers ?? [])],
    globalState: [...(config.globalState ?? [])],
    classList: [...(config.classList ?? [])],
    _refs: {},
  };
}

// ---------------------------------------------------------------------------
// Purge execution
// ---------------------------------------------------------------------------

/**
 * Execute cleanup against the live environment based on the contract.
 *
 * Removes DOM elements, CSS variables, timers, global state keys, and
 * body classes declared in the contract. Non-existent items are silently
 * skipped (no error thrown).
 *
 * @param {PurgeContract} contract - The cleanup contract.
 * @param {Object} [options] - Execution options.
 * @param {any} [options.host=globalThis] - Host object for timer/state lookup.
 * @param {Document|null} [options.document] - Document object for DOM/CSS/body operations.
 * @returns {PurgeReport} A report detailing what was cleaned up.
 */
export function purge(contract, options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const doc = options.document ?? globalThis.document ?? null;

  const report = {
    domRemoved: 0,
    cssVarsRemoved: 0,
    timersCleared: 0,
    stateCleared: 0,
    classesRemoved: 0,
    errors: [],
    success: true,
  };

  // Store references for verification
  contract._refs = { host, doc, timerHandles: {}, stateValues: {} };

  // 1. DOM removal
  if (doc) {
    for (const id of contract.domIds) {
      try {
        const el = doc.getElementById(id);
        if (el) {
          el.remove();
          report.domRemoved++;
        }
      } catch (err) {
        report.errors.push(`DOM removal failed for #${id}: ${err.message}`);
      }
    }
  }

  // 2. CSS variable cleanup
  if (doc?.documentElement) {
    const style = doc.documentElement.style;
    for (const varName of contract.cssVars) {
      try {
        const value = style.getPropertyValue(varName);
        if (value) {
          style.removeProperty(varName);
          report.cssVarsRemoved++;
        }
      } catch (err) {
        report.errors.push(`CSS variable removal failed for ${varName}: ${err.message}`);
      }
    }
  }

  // 3. Timer cleanup
  const timerRegistry = host.__agentskinTimers;
  if (timerRegistry) {
    for (const key of contract.timers) {
      try {
        const handle = timerRegistry.get(key);
        if (handle !== undefined) {
          // Support both browser clearTimeout and node clearTimeout
          const clearFn = host.clearTimeout ?? globalThis.clearTimeout ?? clearTimeout;
          clearFn(handle);
          timerRegistry.delete(key);
          report.timersCleared++;
          contract._refs.timerHandles[key] = handle;
        }
      } catch (err) {
        report.errors.push(`Timer cleanup failed for "${key}": ${err.message}`);
      }
    }
  }

  // 4. Global state cleanup
  for (const key of contract.globalState) {
    try {
      if (key in host) {
        contract._refs.stateValues[key] = host[key];
        delete host[key];
        report.stateCleared++;
      }
    } catch (err) {
      report.errors.push(`State cleanup failed for "${key}": ${err.message}`);
    }
  }

  // 5. Body class cleanup
  if (doc?.body) {
    for (const cls of contract.classList) {
      try {
        if (doc.body.classList.contains(cls)) {
          doc.body.classList.remove(cls);
          report.classesRemoved++;
        }
      } catch (err) {
        report.errors.push(`Class removal failed for "${cls}": ${err.message}`);
      }
    }
  }

  report.success = report.errors.length === 0;
  return report;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify that all artifacts declared in the contract have been fully
 * removed from the live environment.
 *
 * @param {PurgeContract} contract - The cleanup contract to verify against.
 * @param {Object} [options] - Verification options.
 * @param {any} [options.host=globalThis] - Host object for timer/state lookup.
 * @param {Document|null} [options.document] - Document object for DOM/CSS/body checks.
 * @returns {boolean} true if no residuals remain, false otherwise.
 */
export function verifyPurge(contract, options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const doc = options.document ?? globalThis.document ?? null;

  // 1. DOM elements must not exist
  if (doc) {
    for (const id of contract.domIds) {
      if (doc.getElementById(id) !== null) return false;
    }
  }

  // 2. CSS variables must not be set
  if (doc?.documentElement) {
    const style = doc.documentElement.style;
    for (const varName of contract.cssVars) {
      if (style.getPropertyValue(varName)) return false;
    }
  }

  // 3. Timers must not be in the registry
  const timerRegistry = host.__agentskinTimers;
  if (timerRegistry) {
    for (const key of contract.timers) {
      if (timerRegistry.has(key)) return false;
    }
  }

  // 4. Global state keys must not exist on host
  for (const key of contract.globalState) {
    if (key in host) return false;
  }

  // 5. Body classes must not be present
  if (doc?.body) {
    for (const cls of contract.classList) {
      if (doc.body.classList.contains(cls)) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Manifest integration
// ---------------------------------------------------------------------------

/**
 * Build a purge contract from a manifest.json file.
 *
 * Reads the manifest and extracts the purge-relevant fields:
 *   - domIds: string[]
 *   - cssVars: string[]
 *   - timers: string[]
 *   - globalState: string[]
 *   - classList: string[]
 *
 * Missing or empty fields are treated as empty arrays.
 *
 * @param {string} manifestPath - Absolute or relative path to manifest.json.
 * @returns {PurgeContract} A contract derived from the manifest.
 * @throws {Error} If the file cannot be read or parsed.
 */
export function contractFromManifest(manifestPath) {
  const absPath = resolve(manifestPath);
  let raw;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read manifest at ${absPath}: ${err.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse manifest JSON at ${absPath}: ${err.message}`);
  }

  return createPurgeContract({
    domIds: manifest.domIds,
    cssVars: manifest.cssVars,
    timers: manifest.timers,
    globalState: manifest.globalState,
    classList: manifest.classList,
  });
}
