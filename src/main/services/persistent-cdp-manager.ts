// SPDX-License-Identifier: MPL-2.0

/**
 * # persistent-cdp-manager — Persistent CDP Port Manager
 *
 * Every theme injection currently requires a restart of the target app so the
 * `--remote-debugging-port` flag can take effect. This module eliminates the
 * restart for *subsequent* injections by persisting the flag at the source:
 *
 *   - **Windows**: the `.lnk` shortcut the user actually clicks (Desktop,
 *     Start Menu, Taskbar). We read the shortcut's `Arguments` property via
 *     the `WScript.Shell` COM object and append `--remote-debugging-port=<port>`
 *     when it is absent.
 *
 *   - **macOS**: an environment variable exported from the user's shell profile
 *     (`~/.zshrc` or `~/.bash_profile`). GUI-launched apps inherit launchd
 *     environment; a launch agent or wrapper script can then forward the value
 *     to `--remote-debugging-port`.
 *
 * ## Flow
 *
 * `ensurePersistentCdpPort(options)` is the single entry point:
 *
 *   1. **Detect** — read the shortcut args / env var and check for an existing
 *      `--remote-debugging-port=<port>`.
 *   2. **Already configured?** → return `{ alreadyConfigured: true, port }`
 *      so the caller can connect immediately.
 *   3. **Not configured?** → modify the shortcut / env var (after backing up
 *      the original), return `{ alreadyConfigured: false, modified: true, port }`
 *      so the caller knows the app needs one restart before the flag is live.
 *
 * ## Safety
 *
 *   - Every shortcut modification is preceded by a file-level backup into
 *     `backupDir` (`.bak` suffix). The backup path is returned so the caller
 *     can offer an "undo" action.
 *   - The module **never throws** — all errors are caught and returned as a
 *     structured `PersistentCdpResult` with `ok: false`.
 *   - Dependencies (`log` sink) are injected through `configurePersistentCdpManager()`
 *     so the default (no-op) is side-effect free — tests call this with a
 *     capturing logger.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toMessage } from '../../shared/errors';
import { execFileAsync } from '../../shared/exec-async';
import type { AgentId } from '../../shared/types/agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The Chromium flag we persist into shortcuts / env vars. */
const DEBUG_PORT_FLAG = '--remote-debugging-port';

/** Prefix for the per-agent environment variable used on macOS. */
const ENV_VAR_PREFIX = 'AGENTSKIN_CDP_PORT_';

/** Valid port range (mirrors PortResolver in src/main/cdp/port-resolver.ts). */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** Default CDP port when the caller doesn't supply one. */
const DEFAULT_PORT = 9222;

/** Well-known Windows directories to scan for `.lnk` shortcuts. */
const WINDOWS_SHORTCUT_DIRS = ['Desktop', 'StartMenu', 'CommonDesktop', 'CommonStartMenu'] as const;

/** macOS shell profile candidates, in precedence order. */
const MACOS_SHELL_PROFILES = ['.zshrc', '.bash_profile'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link ensurePersistentCdpPort}. */
export interface PersistentCdpOptions {
  /** Target agent id (one of the 6 active agents). */
  agentId: AgentId;
  /**
   * Executable path the shortcut must point to. Used to match a candidate
   * `.lnk` against the correct agent when several shortcuts exist.
   */
  exePath: string;
  /**
   * Port to persist. Defaults to {@link DEFAULT_PORT}. When the shortcut /
   * env already carries a flag the stored port wins (this value is ignored).
   */
  preferredPort?: number;
  /**
   * Directory where backups are written. Must exist — callers are responsible
   * for creating it (typically `<userData>/persistent-cdp-backups`).
   */
  backupDir: string;
}

/** Result of {@link ensurePersistentCdpPort}. */
export interface PersistentCdpResult {
  /** False when an unrecoverable error occurred (see `message`). */
  ok: boolean;
  /** The effective CDP port (persisted or detected). Null on failure. */
  port: number | null;
  /**
   * True when the shortcut / env already contained the flag — the caller can
   * connect immediately without restarting the app.
   */
  alreadyConfigured: boolean;
  /** True when this call modified the shortcut / env var. */
  modified: false | true;
  /** Path to the backup file written when `modified` is true (else null). */
  backupPath: string | null;
  /** Which mechanism was used — useful for diagnostics / UI messaging. */
  method: 'shortcut' | 'env-var' | 'none';
  /** Human-readable status or error message. */
  message: string;
}

/** Injectable dependencies — log sink for diagnostics. */
export interface PersistentCdpDeps {
  readonly log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let moduleDeps: PersistentCdpDeps = { log: () => {} };

/**
 * Configure the manager's dependencies. Must be called once during startup
 * to wire a real log sink. Tests call this with a capturing logger.
 */
export function configurePersistentCdpManager(deps: PersistentCdpDeps): void {
  moduleDeps = deps;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a target agent's launch configuration持久ly carries the
 * `--remote-debugging-port` flag.
 *
 * Never throws — all errors are caught and returned as `ok: false`.
 */
export async function ensurePersistentCdpPort(
  options: PersistentCdpOptions,
): Promise<PersistentCdpResult> {
  try {
    return await ensurePersistentCdpPortInner(options);
  } catch (error) {
    return {
      ok: false,
      port: null,
      alreadyConfigured: false,
      modified: false,
      backupPath: null,
      method: 'none',
      message: `ensurePersistentCdpPort failed: ${toMessage(error)}`,
    };
  }
}

async function ensurePersistentCdpPortInner(
  options: PersistentCdpOptions,
): Promise<PersistentCdpResult> {
  return process.platform === 'win32'
    ? ensurePersistentCdpPortWindows(options)
    : ensurePersistentCdpPortMacOS(options);
}

// ---------------------------------------------------------------------------
// Windows — shortcut modification
// ---------------------------------------------------------------------------

/** Windows implementation: find the `.lnk`, check, and patch if needed. */
async function ensurePersistentCdpPortWindows(
  options: PersistentCdpOptions,
): Promise<PersistentCdpResult> {
  const { agentId, exePath, backupDir } = options;
  const port = normalizePort(options.preferredPort) ?? DEFAULT_PORT;

  // 1. Locate the shortcut.
  const shortcutPath = await findShortcutForAgent(agentId, exePath);
  if (!shortcutPath) {
    return {
      ok: false,
      port: null,
      alreadyConfigured: false,
      modified: false,
      backupPath: null,
      method: 'none',
      message: `No shortcut found for ${agentId} (${exePath})`,
    };
  }

  // 2. Check for an existing flag.
  const existing = await shortcutHasDebugPort(shortcutPath);
  if (existing.has) {
    moduleDeps.log(
      `[persistent-cdp] ${agentId}: shortcut already has flag on port ${existing.port}`,
    );
    return {
      ok: true,
      port: existing.port ?? port,
      alreadyConfigured: true,
      modified: false,
      backupPath: null,
      method: 'shortcut',
      message: `Shortcut already contains ${DEBUG_PORT_FLAG}=${existing.port}`,
    };
  }

  // 3. Patch it (with backup).
  const backupPath = await addDebugPortToShortcut(shortcutPath, port, backupDir);
  moduleDeps.log(`[persistent-cdp] ${agentId}: patched shortcut ${shortcutPath} → port ${port}`);
  return {
    ok: true,
    port,
    alreadyConfigured: false,
    modified: true,
    backupPath,
    method: 'shortcut',
    message: `Shortcut patched with ${DEBUG_PORT_FLAG}=${port} (backup: ${backupPath})`,
  };
}

/**
 * Search well-known Windows directories for a `.lnk` whose target matches
 * `exePath`. Returns the first match, or null when none is found.
 */
export async function findShortcutForAgent(
  _agentId: AgentId,
  exePath: string,
): Promise<string | null> {
  const dirs = getWindowsShortcutDirs();

  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch {
      continue; // directory doesn't exist on this machine
    }
    const psScript = buildLnkSearchScript(dir, exePath);
    let output: string;
    try {
      output = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        10_000,
      );
    } catch {
      continue; // PowerShell not available or timed out
    }
    for (const line of output.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * Read a `.lnk` file's `Arguments` property and check whether it already
 * contains `--remote-debugging-port`. When present, the detected port is
 * returned.
 */
export async function shortcutHasDebugPort(
  shortcutPath: string,
): Promise<{ has: boolean; port?: number }> {
  const args = await readShortcutArgs(shortcutPath);
  const match = args.match(/--remote-debugging-port=(\d+)/);
  if (match) {
    return { has: true, port: Number(match[1]) };
  }
  return { has: false };
}

/**
 * Read the `Arguments` property of a `.lnk` shortcut via the `WScript.Shell`
 * COM object. Returns an empty string when the shortcut has no arguments.
 */
export async function readShortcutArgs(shortcutPath: string): Promise<string> {
  const escaped = shortcutPath.replace(/'/g, "''");
  const psScript = `
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut('${escaped}')
    $shortcut.Arguments
  `;
  const output = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    5_000,
  );
  return output.trim();
}

/**
 * Append `--remote-debugging-port=<port>` to a shortcut's arguments.
 *
 * The original `.lnk` is backed up to `<backupDir>/<basename>.bak` before
 * the modification. Returns the backup file path.
 */
export async function addDebugPortToShortcut(
  shortcutPath: string,
  port: number,
  backupDir: string,
): Promise<string> {
  const args = await readShortcutArgs(shortcutPath);
  const newArgs = args ? `${args} ${DEBUG_PORT_FLAG}=${port}` : `${DEBUG_PORT_FLAG}=${port}`;

  // Backup first.
  await backupFile(shortcutPath, backupDir);

  // Patch.
  const escaped = shortcutPath.replace(/'/g, "''");
  const escapedArgs = newArgs.replace(/'/g, "''");
  const psScript = `
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut('${escaped}')
    $shortcut.Arguments = '${escapedArgs}'
    $shortcut.Save()
  `;
  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], 5_000);

  return computeBackupPath(shortcutPath, backupDir);
}

// ---------------------------------------------------------------------------
// macOS — shell-profile environment variable
// ---------------------------------------------------------------------------

/** macOS implementation: check / set the env var in the shell profile. */
async function ensurePersistentCdpPortMacOS(
  options: PersistentCdpOptions,
): Promise<PersistentCdpResult> {
  const { agentId } = options;
  const port = normalizePort(options.preferredPort) ?? DEFAULT_PORT;

  // 1. Detect existing env var.
  const existing = await getEnvDebugPort(agentId);
  if (existing != null) {
    moduleDeps.log(`[persistent-cdp] ${agentId}: env var already set to port ${existing}`);
    return {
      ok: true,
      port: existing,
      alreadyConfigured: true,
      modified: false,
      backupPath: null,
      method: 'env-var',
      message: `Environment variable already sets port ${existing}`,
    };
  }

  // 2. Set it (with backup).
  const backupPath = await setEnvDebugPort(agentId, port);
  moduleDeps.log(`[persistent-cdp] ${agentId}: env var set to port ${port}`);
  return {
    ok: true,
    port,
    alreadyConfigured: false,
    modified: true,
    backupPath,
    method: 'env-var',
    message: `Environment variable set to port ${port} (backup: ${backupPath})`,
  };
}

/**
 * Resolve the CDP port from the per-agent environment variable
 * `AGENTSKIN_CDP_PORT_<AGENT_ID>` (upper-cased). Returns null when unset
 * or when the value is not a valid port number.
 */
export async function getEnvDebugPort(agentId: AgentId): Promise<number | null> {
  const value = process.env[envVarName(agentId)];
  if (value == null) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/**
 * Persist the CDP port into the user's shell profile. Creates the profile
 * file when it does not exist; appends the export line when the variable
 * is not already present, or updates the existing line otherwise.
 *
 * The original profile is backed up to `<backupDir>/<filename>.bak` before
 * modification. Returns the backup path.
 */
export async function setEnvDebugPort(agentId: AgentId, port: number): Promise<string> {
  const profilePath = await resolveShellProfile();
  let content = '';
  try {
    content = await fs.readFile(profilePath, 'utf8');
  } catch {
    // Profile doesn't exist yet — start fresh.
    content = `# AgentSkin persistent CDP port — added ${new Date().toISOString()}\n`;
  }

  const envVar = envVarName(agentId);
  const exportLine = `export ${envVar}=${port}`;
  const linePattern = new RegExp(`^export\\s+${envVar}=.*$`, 'm');

  let newContent: string;
  if (linePattern.test(content)) {
    newContent = content.replace(linePattern, `${exportLine} # updated by AgentSkin`);
  } else {
    newContent = `${content.endsWith('\n') ? content : `${content}\n`}${exportLine} # AgentSkin\n`;
  }

  // Backup the original before writing.
  await backupFile(profilePath, backupDirWithDefault());
  await fs.writeFile(profilePath, newContent, 'utf8');

  // Also set in the current process so immediate reconnects pick it up.
  process.env[envVar] = String(port);

  return computeBackupPath(profilePath, backupDirWithDefault());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a name like `AGENTSKIN_CDP_PORT_TRAEWORK` from an agent id. */
function envVarName(agentId: AgentId): string {
  return `${ENV_VAR_PREFIX}${agentId.toUpperCase()}`;
}

/** Coerce an optional port to a valid integer in [MIN_PORT, MAX_PORT], or null. */
function normalizePort(port: number | undefined): number | null {
  if (port == null) return null;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;
  return port;
}

/** Copy `sourcePath` into `backupDir` with a `.bak` suffix. */
async function backupFile(sourcePath: string, backupDir: string): Promise<string> {
  await fs.mkdir(backupDir, { recursive: true });
  const dest = computeBackupPath(sourcePath, backupDir);
  await fs.copyFile(sourcePath, dest);
  return dest;
}

/** Compute the backup file path for a given source within the backup directory. */
function computeBackupPath(sourcePath: string, backupDir: string): string {
  return path.join(backupDir, `${path.basename(sourcePath)}.bak`);
}

/**
 * Locate the user's preferred shell profile. Checks `~/.zshrc` first (default
 * on modern macOS) and falls back to `~/.bash_profile`.
 */
async function resolveShellProfile(): Promise<string> {
  const home = os.homedir();
  for (const profile of MACOS_SHELL_PROFILES) {
    const candidate = path.join(home, profile);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  // Default to .zshrc when neither exists — setEnvDebugPort will create it.
  return path.join(home, '.zshrc');
}

/** Resolve a sensible default backup directory on macOS. */
function backupDirWithDefault(): string {
  return path.join(os.homedir(), '.agentskin', 'persistent-cdp-backups');
}

/** Resolve Windows well-known folder paths. */
function getWindowsShortcutDirs(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];
  // Standard COM-based folder resolution via PowerShell fallback.
  for (const known of WINDOWS_SHORTCUT_DIRS) {
    const resolved = resolveKnownFolderPath(home, known);
    if (resolved) dirs.push(resolved);
  }
  return dirs;
}

/**
 * Map a well-known folder name to an absolute path without a shell call.
 * Handles the most common layouts; returns null for unrecognised names.
 */
function resolveKnownFolderPath(home: string, known: string): string | null {
  if (known === 'Desktop') return path.join(home, 'Desktop');
  if (known === 'CommonDesktop') {
    const publicDesktop = process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : null;
    return publicDesktop ?? path.join(home, 'Desktop');
  }
  if (known === 'StartMenu') {
    return path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  }
  if (known === 'CommonStartMenu') {
    const progData = process.env.PROGRAMDATA ?? 'C:\\ProgramData';
    return path.join(progData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  }
  return null;
}

/**
 * Build a PowerShell script that searches a directory tree for `.lnk` files
 * whose `TargetPath` matches `exePath`, outputting one match per line.
 */
function buildLnkSearchScript(dir: string, exePath: string): string {
  const escapedDir = dir.replace(/'/g, "''");
  const escapedExe = exePath.replace(/'/g, "''");
  return `
    $exePath = '${escapedExe}'
    $shell = New-Object -ComObject WScript.Shell
    Get-ChildItem -Path '${escapedDir}' -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $sc = $shell.CreateShortcut($_.FullName)
        if ($sc.TargetPath -ieq $exePath) { $_.FullName }
      } catch { }
    }
  `.trim();
}
