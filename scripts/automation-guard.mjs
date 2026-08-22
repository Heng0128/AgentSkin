// SPDX-License-Identifier: MPL-2.0
/**
 * Automation Guard
 *
 * Wrapper around automation-lock.mjs that lets automation workflows
 * acquire a cross-process lock before running critical operations and
 * guarantees release afterwards (even on failure / crash).
 *
 * Two usage modes:
 *   1. Programmatic:  await withLock('my-task', async () => { ... })
 *   2. CLI:           node scripts/automation-guard.mjs <name> -- <cmd> [args...]
 *
 * Exit codes:
 *   0 – lock acquired, command (or fn) ran successfully
 *   1 – lock held by another automation, or spawn failure
 *   N – command exited with code N (>= 2)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, getLockStatus, releaseLock } from './automation-lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE_RELEASE_HINT = 'node scripts/automation-lock.mjs force-release';

// ---------------------------------------------------------------------------
// Programmatic API
// ---------------------------------------------------------------------------

/**
 * Acquire the lock, run `fn`, then release the lock in a finally block.
 *
 * @param {string} automationName  Identifier stamped into the lock file.
 * @param {() => Promise<void>} fn  Async work to perform under the lock.
 * @throws {Error} If the lock is already held by another automation.
 */
export async function withLock(automationName, fn) {
  const acquired = acquireLock(automationName);
  if (!acquired) {
    const { lock } = getLockStatus();
    throw new Error(
      `另一个 automation 正在运行：${lock?.automation ?? 'unknown'}（since ${lock?.acquiredAt ?? '?'}）` +
        `，请等待或手动 force-release: ${FORCE_RELEASE_HINT}`,
    );
  }

  try {
    await fn();
  } finally {
    releaseLock();
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into { name, command }.
 *   `guard <name> -- <cmd> [args...]`
 * The name is everything before `--` (joined with space), the command is
 * everything after `--`.
 */
function parseCliArgs(argv) {
  const args = argv.slice(2);
  const sep = args.indexOf('--');

  if (sep === -1 || sep === 0) {
    console.error('Error: missing "--" separator and/or automation name.');
    console.error(
      'Usage: node scripts/automation-guard.mjs <automation-name> -- <command> [args...]',
    );
    process.exit(1);
  }

  const command = args.slice(sep + 1);
  if (command.length === 0) {
    console.error('Error: no command provided after "--".');
    console.error(
      'Usage: node scripts/automation-guard.mjs <automation-name> -- <command> [args...]',
    );
    process.exit(1);
  }

  return {
    name: args.slice(0, sep).join(' ').trim(),
    command,
  };
}

/**
 * Determine whether a given command token needs a shell on the current
 * platform. On Windows, `.cmd` / `.bat` / `.ps1` files cannot be executed
 * via spawn() without shell:true.
 */
function needsShell(cmd) {
  if (process.platform !== 'win32') return false;
  const lower = cmd.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

/**
 * Spawn a command, wire up stdio, and resolve with the exit code.
 * Never rejects — spawn errors resolve with code 1 after logging.
 */
function spawnPiped(command) {
  const [file, ...args] = command;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: 'inherit',
      shell: needsShell(file),
      cwd: process.cwd(),
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      // If killed by a signal, use 128+signal convention (bash-like).
      resolve(signal ? 128 + (process.constants?.[signal] ?? 1) : (code ?? 0));
    });

    child.on('error', (err) => {
      console.error(`automation-guard: failed to spawn "${file}": ${err.message}`);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function runCli() {
  const { name, command } = parseCliArgs(process.argv);

  if (!name) {
    console.error('Error: automation name must not be empty.');
    process.exit(1);
  }

  const acquired = acquireLock(name);
  if (!acquired) {
    const { lock } = getLockStatus();
    console.error(
      `另一个 automation 正在运行：${lock?.automation ?? 'unknown'}（since ${lock?.acquiredAt ?? '?'}）`,
    );
    console.error(`请等待完成后重试，或手动释放: ${FORCE_RELEASE_HINT}`);
    process.exit(1);
  }

  const code = await spawnPiped(command);
  releaseLock();
  process.exit(code);
}

// Run CLI only when executed directly (mirrors automation-lock.mjs pattern).
function isRunDirectly() {
  if (process.argv.length < 2) return false;
  const scriptPath = fileURLToPath(import.meta.url);
  const argvPath = path.resolve(process.argv[1]);
  return scriptPath === argvPath;
}

if (isRunDirectly()) {
  runCli().catch((err) => {
    console.error('automation-guard: unexpected error:', err);
    releaseLock();
    process.exit(1);
  });
}
