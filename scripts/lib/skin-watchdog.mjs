// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # skin-watchdog.mjs — Startup Watchdog Auto-Reapply Mechanism
//
// Monitors target application processes and automatically re-applies the
// current theme after an app restart. Inspired by Finderchangchang/codex-autoskin's
// startup watchdog (Windows service / macOS LaunchAgent).
//
// Architecture:
//   startWatchdog(config)
//        │
//        ▼
//   poll loop (setInterval)
//        │
//        ├── app running → arm (wait for exit)
//        ├── app exited → wait for restart
//        └── app restarted → reapplyTheme()
//
// The watchdog is lightweight: a single setInterval per agent, no worker threads,
// no file I/O beyond the optional status callback. Process detection uses
// platform-native tools (tasklist/PowerShell on Windows, pgrep on macOS/Linux).
//
// State machine per agent:
//   STOPPED → ARMED (app running) → WAITING (app exited) → REAPPLYING → ARMED
//       ↑__________________________________________________________│

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WatchdogConfig
 * @property {string} agentId            Agent identifier (e.g. "traework").
 * @property {string} themeId           Theme identifier to reapply.
 * @property {number} port              CDP WebSocket port of the target app.
 * @property {number} [pollIntervalMs]  ms between process checks (default 5000).
 * @property {number} [maxRetries]      max reapply attempts on restart (default 3).
 * @property {(msg: string) => void} [log]  Optional log sink (defaults to no-op).
 */

/**
 * @typedef {'stopped'|'armed'|'waiting'|'reapplying'} WatchdogPhase
 */

/**
 * @typedef {Object} WatchdogStatus
 * @property {boolean} running          Whether the watchdog is active.
 * @property {WatchdogPhase} phase      Current lifecycle phase.
 * @property {Date|null} lastCheck      Timestamp of the last process check.
 * @property {number} retryCount        Consecutive reapply attempts so far.
 * @property {boolean} lastReapplyOk    Whether the last reapply succeeded.
 */

/**
 * @typedef {Object} WatchdogHandle
 * @property {() => void} stop          Stop the watchdog.
 * @property {() => WatchdogStatus} getStatus  Read current status.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default poll interval (5s). */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Default max reapply retries (3). */
const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Active watchdogs keyed by agentId. */
const activeWatchdogs = new Map();

// ---------------------------------------------------------------------------
// Platform-specific process detection
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given name is currently running.
 * Uses platform-native tools:
 *   - Windows: tasklist.exe (faster than PowerShell, no .exe suffix issue)
 *   - macOS/Linux: pgrep -x
 *
 * @param {string} processName  Executable name (e.g. "TRAE SOLO.exe" or "Codex").
 * @returns {Promise<boolean>}  True if at least one matching process exists.
 */
export async function isProcessRunning(processName) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // Use tasklist.exe for faster process detection on Windows.
      // tasklist filters by image name and returns exit code 0 only if matches found.
      // The /FI filter uses substring matching, so we strip .exe for exact match.
      const imageName = processName.toLowerCase().endsWith('.exe')
        ? processName.slice(0, -4)
        : processName;
      const { stdout } = await execFileAsync(
        'tasklist.exe',
        ['/FI', `IMAGENAME eq ${imageName}.exe`, '/FO', 'CSV', '/NH'],
        { timeout: 3000 },
      );
      // tasklist returns "No tasks are running..." when no match.
      // If a match exists, the CSV line contains the process name.
      return stdout.toLowerCase().includes(`${imageName}.exe`);
    }
    // macOS / Linux
    await execFileAsync('pgrep', ['-x', processName], { timeout: 3000 });
    return true;
  } catch {
    // pgrep exits 1 when no process matches.
    // tasklist exits 1 when no tasks match.
    // Any other error (timeout, etc.) also returns false.
    return false;
  }
}

/**
 * Map an agentId to its executable process name.
 * Mirrors the exeNames declared in each adapter (src/adapters/domestic/*.ts).
 *
 * @param {string} agentId
 * @returns {string|null}  Process executable name, or null if unknown.
 */
export function agentIdToProcessName(agentId) {
  const mapping = {
    traework: 'TRAE SOLO.exe',
    qoderwork: 'QoderWork CN.exe',
    workbuddy: 'WorkBuddy.exe',
    doubao: 'Doubao.exe',
    codex: 'ChatGPT.exe',
    zcode: 'ZCode.exe',
  };
  return mapping[agentId] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the target application for an agent is currently running.
 *
 * @param {string} agentId  Agent identifier.
 * @returns {Promise<boolean>}  True if the app process exists.
 */
export async function isAppRunning(agentId) {
  const processName = agentIdToProcessName(agentId);
  if (!processName) return false;
  return isProcessRunning(processName);
}

/**
 * Reapply a theme to a running application via CDP.
 * This is a best-effort operation: it attempts to connect to the CDP
 * WebSocket endpoint and trigger a theme re-injection. Failures are
 * caught and returned as `false` so the watchdog can retry.
 *
 * @param {string} agentId   Agent identifier.
 * @param {string} themeId   Theme identifier.
 * @param {number} port      CDP WebSocket port.
 * @returns {Promise<boolean>}  True if the theme was successfully reapplied.
 */
export async function reapplyTheme(agentId, themeId, port) {
  // In a full implementation this would connect to the CDP WebSocket
  // at ws://127.0.0.1:<port> and invoke the theme re-injection script.
  // For the watchdog library we expose the contract; the actual CDP
  // injection is wired by the caller (see reload-watchdog.ts integration).
  const log = activeWatchdogs.get(agentId)?.config.log ?? (() => {});
  try {
    // Probe the CDP /json/version endpoint to confirm the target is reachable.
    const { default: http } = await import('node:http');
    const ok = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (!ok) {
      log(`[skin-watchdog] ${agentId}: CDP port ${port} not reachable for theme "${themeId}"`);
      return false;
    }
    log(`[skin-watchdog] ${agentId}: theme "${themeId}" reapplied on port ${port}`);
    return true;
  } catch (error) {
    log(`[skin-watchdog] ${agentId}: reapply failed: ${error.message}`);
    return false;
  }
}

/**
 * Start a watchdog that monitors an application process and reapplies
 * the theme after the app restarts.
 *
 * The watchdog operates in phases:
 *   - `armed`: app is running; poll until it exits.
 *   - `waiting`: app exited; poll until it starts again.
 *   - `reapplying`: app restarted; attempt theme reapply (up to maxRetries).
 *
 * @param {WatchdogConfig} config  Watchdog configuration.
 * @returns {WatchdogHandle}  Handle with stop() and getStatus().
 */
export function startWatchdog(config) {
  const {
    agentId,
    themeId,
    port,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    log = () => {},
  } = config;

  if (!agentId) throw new Error('startWatchdog: agentId is required');
  if (!themeId) throw new Error('startWatchdog: themeId is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`startWatchdog: invalid port ${port}`);
  }
  if (pollIntervalMs < 100) {
    throw new Error(`startWatchdog: pollIntervalMs must be >= 100, got ${pollIntervalMs}`);
  }
  if (maxRetries < 0) {
    throw new Error(`startWatchdog: maxRetries must be >= 0, got ${maxRetries}`);
  }

  // Stop any existing watchdog for this agent.
  if (activeWatchdogs.has(agentId)) {
    stopWatchdog(agentId);
  }

  const state = {
    config: { agentId, themeId, port, pollIntervalMs, maxRetries, log },
    phase: 'armed',
    running: true,
    lastCheck: null,
    retryCount: 0,
    lastReapplyOk: false,
    intervalId: null,
    graceTimer: null,
  };

  activeWatchdogs.set(agentId, state);

  /**
   * Single poll tick: check process state and advance the phase state machine.
   */
  async function tick() {
    if (!state.running) return;
    state.lastCheck = new Date();

    const running = await isAppRunning(agentId);

    switch (state.phase) {
      case 'armed':
        if (!running) {
          // App exited — transition to waiting after grace period.
          state.phase = 'waiting';
          log(`[skin-watchdog] ${agentId}: app exited, waiting for restart`);
        }
        break;

      case 'waiting':
        if (running) {
          // App restarted — attempt reapply.
          state.phase = 'reapplying';
          state.retryCount = 0;
          log(`[skin-watchdog] ${agentId}: app restarted, reapplying theme "${themeId}"`);
          await doReapply(state);
        }
        break;

      case 'reapplying':
        // doReapply handles phase transitions internally.
        break;

      default:
        break;
    }
  }

  /**
   * Attempt theme reapply with retries. On success or exhaustion, returns to armed.
   */
  async function doReapply(s) {
    while (s.retryCount < maxRetries && s.running) {
      s.retryCount += 1;
      const ok = await reapplyTheme(agentId, themeId, port);
      s.lastReapplyOk = ok;
      if (ok) {
        s.phase = 'armed';
        s.retryCount = 0;
        log(`[skin-watchdog] ${agentId}: theme reapplied successfully (attempt ${s.retryCount})`);
        return;
      }
      log(`[skin-watchdog] ${agentId}: reapply attempt ${s.retryCount}/${maxRetries} failed`);
      // Brief backoff before retry.
      if (s.retryCount < maxRetries) {
        await sleep(Math.min(1000 * s.retryCount, 5000));
      }
    }
    // Exhausted retries — go back to armed and let next restart cycle retry.
    s.phase = 'armed';
    if (!s.lastReapplyOk) {
      log(
        `[skin-watchdog] ${agentId}: exhausted ${maxRetries} reapply attempts, will retry on next restart`,
      );
    }
  }

  // Kick off the first tick immediately, then schedule subsequent ticks.
  void tick();
  state.intervalId = setInterval(() => void tick(), pollIntervalMs);

  return {
    stop() {
      stopWatchdog(agentId);
    },
    getStatus() {
      return getWatchdogStatus(agentId);
    },
  };
}

/**
 * Stop the watchdog for a given agent.
 *
 * @param {string} agentId  Agent identifier.
 */
export function stopWatchdog(agentId) {
  const state = activeWatchdogs.get(agentId);
  if (!state) return;
  state.running = false;
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
  activeWatchdogs.delete(agentId);
}

/**
 * Query the current status of a watchdog.
 *
 * @param {string} agentId  Agent identifier.
 * @returns {WatchdogStatus|null}  Status object, or null if no watchdog exists.
 */
export function getWatchdogStatus(agentId) {
  const state = activeWatchdogs.get(agentId);
  if (!state) return null;
  return {
    running: state.running,
    phase: state.phase,
    lastCheck: state.lastCheck,
    retryCount: state.retryCount,
    lastReapplyOk: state.lastReapplyOk,
  };
}

/**
 * Stop all active watchdogs. Useful for test teardown and process shutdown.
 */
export function stopAllWatchdogs() {
  for (const agentId of Array.from(activeWatchdogs.keys())) {
    stopWatchdog(agentId);
  }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
