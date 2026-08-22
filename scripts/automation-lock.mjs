// SPDX-License-Identifier: MPL-2.0
/**
 * Automation Lock Helper v1
 *
 * Cross-process file lock for CatPaw automations.
 * Uses O_EXCL flag for atomic creation to avoid race conditions.
 *
 * Lock file: .codebuddy/automations/.lock
 * Format: { "automation": "...", "pid": ..., "acquiredAt": "ISO" }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCK_DIR = path.join(ROOT, '.codebuddy', 'automations');
const LOCK_FILE = path.join(LOCK_DIR, '.lock');
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// --- Helpers ---

function ensureDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isStale(lock) {
  if (!lock?.acquiredAt) return true;
  const acquired = new Date(lock.acquiredAt).getTime();
  if (Number.isNaN(acquired)) return true;
  return Date.now() - acquired > STALE_THRESHOLD_MS;
}

// --- Public API ---

/**
 * Acquire the lock for an automation.
 * @param {string} automationName
 * @returns {boolean} true if lock acquired, false otherwise
 */
export function acquireLock(automationName) {
  ensureDir();

  const existing = readLock();
  if (existing && !isStale(existing)) {
    return false; // Lock still held
  }

  // Stale or missing — try atomic create
  const lockData = {
    automation: automationName,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
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
 */
export function releaseLock() {
  try {
    const lock = readLock();
    if (lock && lock.pid === process.pid) {
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
  if (isStale(lock)) return false;
  return true;
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
 * @returns {{ held: boolean, stale: boolean, lock: object | null }}
 */
export function getLockStatus() {
  const lock = readLock();
  if (!lock) return { held: false, stale: false, lock: null };
  const stale = isStale(lock);
  return { held: !stale, stale, lock };
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
  check-exists        exit(0) if lock FREE, exit(1) if HELD (for shell ` &&
      `)

Options:
  --help, -h          Show this help message
`,
  );
}

function printStatus() {
  const { held, stale, lock } = getLockStatus();
  if (!lock) {
    console.log('Lock: FREE');
    return;
  }
  console.log(`Lock: ${held ? 'HELD' : stale ? 'STALE' : 'FREE'}`);
  console.log(`  automation: ${lock.automation}`);
  console.log(`  pid:        ${lock.pid}`);
  console.log(`  acquiredAt: ${lock.acquiredAt}`);
  console.log(`  stale:      ${stale}`);
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
          `Lock held by "${lock?.automation ?? 'unknown'}" since ${lock?.acquiredAt ?? '?'}`,
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
