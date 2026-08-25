// SPDX-License-Identifier: MPL-2.0
/**
 * Automation Lock Helper v2
 *
 * Cross-process file lock for CatPaw automations.
 * Uses O_EXCL flag for atomic creation to avoid race conditions.
 *
 * Lock file: .agentskin/automations/.lock
 * Format v2: { "schemaVersion": 2, "automation": "...", "pid": ...,
 *             "startedAt": "ISO", "operations": [...] }
 * Format v1 (legacy): { "automation": "...", "pid": ...,
 *                       "acquiredAt": "ISO", "operations": [...] }
 *
 * v2 additions over v1:
 *   - schemaVersion: 2 discriminator
 *   - startedAt replaces acquiredAt (v1 still readable for backward compat)
 *   - process liveness check via process.kill(pid, 0) — a lock whose PID
 *     is dead is treated as stale even within the time threshold
 *   - isOwnLock() distinguishes self-held vs. foreign-held locks
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCK_DIR = path.join(ROOT, '.agentskin', 'automations');
const LOCK_FILE = path.join(LOCK_DIR, '.lock');
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// --- Helpers ---

function ensureDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

/**
 * Read and parse the lock file.
 * @returns {Record<string, unknown> | null} The parsed lock data, or null if missing/invalid.
 */
function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Check whether a PID is currently alive.
 * Uses process.kill(pid, 0) which throws ESRCH if the process does not exist,
 * EPERM if we lack permission (process exists but we can't signal it), or
 * succeeds if the process exists. Returns false for non-positive or
 * non-numeric PIDs.
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH — process does not exist. Any other error (EPERM) means it exists.
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * Resolve the timestamp from either a v2 (startedAt) or v1 (acquiredAt) lock.
 * Returns a Date, or null if neither field is present/invalid.
 * @param {Record<string, unknown> | null} lock
 * @returns {Date | null}
 */
function lockTimestamp(lock) {
  const raw = /** @type {string | undefined} */ (lock?.startedAt ?? lock?.acquiredAt);
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Determine whether a lock is stale.
 *
 * A lock is stale when ANY of the following hold:
 *   - No lock data, or no recognizable timestamp
 *   - The timestamp is older than STALE_THRESHOLD_MS
 *   - (v2 only) The PID recorded in the lock is no longer alive
 *
 * v1 locks (no schemaVersion) skip the liveness check to preserve backward
 * compatibility with the original time-only staleness semantics.
 * @param {Record<string, unknown> | null} lock
 * @returns {boolean}
 */
function isStale(lock) {
  if (!lock) return true;

  const ts = lockTimestamp(lock);
  if (!ts) return true;

  if (Date.now() - ts.getTime() > STALE_THRESHOLD_MS) return true;

  // v2 liveness check — a dead PID means the lock is abandoned.
  if (lock.schemaVersion === 2) {
    if (!isPidAlive(/** @type {number} */ (lock.pid))) return true;
  }

  return false;
}

/**
 * Check whether the current process is the lock holder.
 *
 * Returns true only when:
 *   - A lock file exists
 *   - The PID matches the current process
 *   - The lock is not stale (alive + within threshold)
 *
 * This is stricter than `isLockHeld()` — it requires the lock to belong to
 * THIS process, not just any live process.
 * @returns {boolean}
 */
export function isOwnLock() {
  const lock = readLock();
  if (!lock) return false;
  if (lock.pid !== process.pid) return false;
  return !isStale(lock);
}

// --- Public API ---

/**
 * Acquire the lock for an automation.
 *
 * If a non-stale lock already exists (held by a live process within the
 * time threshold), the call returns false. Otherwise the old lock is
 * overwritten with a fresh v2 lock.
 *
 * @param {string} automationName
 * @returns {boolean} true if lock acquired, false otherwise
 */
export function acquireLock(automationName) {
  ensureDir();

  const existing = readLock();
  if (existing && !isStale(existing)) {
    return false; // Lock still held
  }

  // Stale lock — remove the old file so O_EXCL create below can succeed.
  // A race between unlink and open is harmless: if another process writes
  // a fresh lock in between, our open(wx) will correctly fail and we return
  // false (the other process wins the race).
  if (existing) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // File already gone — proceed normally.
    }
  }

  // Try atomic create with v2 format.
  const lockData = {
    schemaVersion: 2,
    automation: automationName,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    operations: ['git-add', 'git-commit', 'git-push'],
  };

  try {
    const fd = fs.openSync(LOCK_FILE, 'wx'); // O_EXCL | O_CREAT
    fs.writeSync(fd, JSON.stringify(lockData, null, 2));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the lock if held by this process.
 *
 * Uses isOwnLock() so a stale lock belonging to a dead process that happens
 * to share our PID (extremely unlikely PID reuse) is not accidentally removed.
 */
export function releaseLock() {
  try {
    if (isOwnLock()) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Already gone or not ours
  }
}

/**
 * Check whether a lock is currently held (and not stale).
 * @returns {boolean}
 */
export function isLockHeld() {
  const lock = readLock();
  if (!lock) return false;
  return !isStale(lock);
}

/**
 * Force-remove the lock regardless of owner.
 */
export function forceReleaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // File doesn't exist
  }
}

/**
 * Get current lock status (for CLI / status display).
 * @returns {{ held: boolean, stale: boolean, own: boolean, lock: Record<string, unknown> | null }}
 */
export function getLockStatus() {
  const lock = readLock();
  if (!lock) return { held: false, stale: false, own: false, lock: null };
  const stale = isStale(lock);
  return { held: !stale, stale, own: isOwnLock(), lock };
}

// --- CLI ---

function printUsage() {
  console.log(
    `automation-lock.mjs — Automation Lock Helper

Usage:
  node scripts/automation-lock.mjs <command> [options]

Commands:
  acquire <name>      Acquire the lock (returns exit code 0 on success)
  release             Release the lock (only if held by this PID)
  status              Show current lock status
  force-release       Remove the lock regardless of owner
  check-exists        exit(0) if lock FREE, exit(1) if HELD (for shell \`&&\`)

Options:
  --help, -h          Show this help message
`,
  );
}

function printStatus() {
  const { held, stale, own, lock } = getLockStatus();
  if (!lock) {
    console.log('Lock: FREE');
    return;
  }
  console.log(`Lock: ${held ? 'HELD' : stale ? 'STALE' : 'FREE'}`);
  console.log(`  automation: ${lock.automation}`);
  console.log(`  pid:        ${lock.pid}`);
  console.log(`  startedAt:  ${lock.startedAt ?? lock.acquiredAt ?? '?'}`);
  console.log(`  stale:      ${stale}`);
  console.log(`  own:        ${own}`);
}

function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case '--help':
    case '-h':
      printUsage();
      break;

    case 'acquire': {
      const name = args[1];
      if (!name) {
        console.error('Error: automation name required');
        console.error('Usage: node scripts/automation-lock.mjs acquire <automation-name>');
        process.exit(1);
      }
      const ok = acquireLock(name);
      if (ok) {
        console.log(`Lock acquired by "${name}" (pid ${process.pid})`);
        process.exit(0);
      } else {
        const { lock } = getLockStatus();
        console.error(
          `Lock held by "${lock?.automation ?? 'unknown'}" since ${lock?.startedAt ?? lock?.acquiredAt ?? '?'}`,
        );
        process.exit(1);
      }
      break;
    }

    case 'release':
      releaseLock();
      console.log('Lock released (if held by this process)');
      break;

    case 'force-release':
      forceReleaseLock();
      console.log('Lock forcibly removed');
      break;

    case 'check-exists': {
      const held = isLockHeld();
      if (held) {
        const { lock } = getLockStatus();
        console.error(`Lock held by "${lock?.automation ?? 'unknown'}" (pid ${lock?.pid ?? '?'})`);
        process.exit(1);
      }
      console.log('Lock is free');
      process.exit(0);
      break;
    }

    case 'status':
    case '--status':
      printStatus();
      break;

    case undefined:
    case '':
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      printUsage();
      process.exit(1);
  }
}

// Only run CLI when executed directly (not imported)
// On Windows process.argv[1] may use backslashes; import.meta.url uses file:// URI.
// Normalize by comparing the resolved path segment from argv[1] with the script URL's pathname.
function isRunDirectly() {
  if (process.argv.length < 2) return false;
  const scriptPath = fileURLToPath(import.meta.url);
  const argvPath = path.resolve(process.argv[1]);
  return scriptPath === argvPath;
}

if (isRunDirectly()) {
  runCli();
}
