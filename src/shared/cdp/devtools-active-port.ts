// SPDX-License-Identifier: MPL-2.0

/**
 * DevToolsActivePort file reader — standalone utility for locating a
 * Chromium-based app's live CDP port from its on-disk port file.
 *
 * Some Electron hosts (notably OpenAI Codex / ChatGPT and QoderWork) force
 * `--remote-debugging-port=0` in their main process, so a caller-chosen port
 * never binds and the real CDP port is only published through Chromium's
 * `DevToolsActivePort` file in the user-data directory. When the engine's
 * configured `devToolsActivePortFile` paths are stale or incomplete, this
 * module provides a broader candidate scan as a fallback.
 *
 * Design notes:
 *   - `readDevToolsActivePort` reads a single app-data dir's port file and
 *     parses the port number. Returns null on any failure (missing file,
 *     unreadable, invalid content).
 *   - `getDevToolsActivePortCandidates` returns the known user-data
 *     directory list for the six supported agents, with platform-specific
 *     path templates (Windows %APPDATA% / macOS ~/Library/Application Support).
 *   - `expandPath` normalises `~` and `%VAR%` tokens using the live process
 *     environment, mirroring the engine's launcher.mjs expandPath.
 *   - No network I/O — callers must TCP-probe the returned port to confirm
 *     liveness (the files survive the process that wrote them).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Expand `~` (home dir) and `%VAR%` (Windows environment variable) tokens in
 * a path template. Unresolved tokens are left as-is so callers can detect
 * misconfiguration instead of silently getting a wrong path.
 *
 * Mirrors the engine's `expandPath` (src/engine/src/runtime/launcher.mjs)
 * so candidate paths resolve identically whether produced here or by core.
 *
 * @param value  Path template possibly containing `~` or `%VAR%` tokens.
 * @returns      The expanded path string.
 */
export function expandPath(value: string): string {
  return value
    .replace(/^~(?=\/|$)/, os.homedir())
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

/**
 * Read and parse the DevToolsActivePort file in a single app-data directory.
 *
 * The file format is two lines: `<port>\n<websocket-path>\n`. We only care
 * about the first line — an integer in [1024, 65535]. Any other content
 * (empty file, non-numeric, out-of-range) yields null.
 *
 * @param appDataPath  Absolute or expanded path to the app's user-data dir
 *                     (parent of the `DevToolsActivePort` file).
 * @returns            The port number, or null if the file is missing,
 *                     unreadable, or contains an invalid port.
 */
export async function readDevToolsActivePort(appDataPath: string): Promise<number | null> {
  const filePath = path.join(appDataPath, 'DevToolsActivePort');
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const firstLine = raw.split(/\r?\n/, 1)[0].trim();
    const port = Number(firstLine);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
    return port;
  } catch {
    // File missing, permission denied, or I/O error — treat uniformly as
    // "no port file here" so callers can try the next candidate.
    return null;
  }
}

/**
 * Known user-data directory templates for the six supported agents.
 *
 * Each entry is a path template (possibly containing `~` or `%VAR%` tokens)
 * that resolves to the app's user-data directory — the parent of the
 * `DevToolsActivePort` file. The list is intentionally broader than the
 * engine's `devToolsActivePortFile` config: it covers alternative install
 * locations, edition variants, and legacy directory names so the fallback
 * scan can discover ports the engine's static config misses.
 *
 * Windows templates use `%APPDATA%` (roaming) and `%LOCALAPPDATA%` (local).
 * macOS templates use `~/Library/Application Support/`.
 */
interface CandidateTemplate {
  /** Agent id this candidate belongs to (for diagnostics / filtering). */
  agentId: string;
  /** Path template; expand with {@link expandPath} before use. */
  template: string;
}

const CANDIDATE_TEMPLATES: readonly CandidateTemplate[] = [
  // --- codex (OpenAI ChatGPT / Codex) ---
  { agentId: 'codex', template: '%APPDATA%\\ChatGPT' },
  { agentId: 'codex', template: '%APPDATA%\\Codex' },
  { agentId: 'codex', template: '%LOCALAPPDATA%\\ChatGPT' },
  { agentId: 'codex', template: '%LOCALAPPDATA%\\Programs\\ChatGPT' },
  { agentId: 'codex', template: '%LOCALAPPDATA%\\Programs\\Codex' },
  { agentId: 'codex', template: '~/Library/Application Support/ChatGPT' },
  { agentId: 'codex', template: '~/Library/Application Support/Codex' },

  // --- qoderwork (QoderWork CN / global) ---
  { agentId: 'qoderwork', template: '%APPDATA%\\QoderWork' },
  { agentId: 'qoderwork', template: '%APPDATA%\\QoderWork CN' },
  { agentId: 'qoderwork', template: '%LOCALAPPDATA%\\QoderWork' },
  { agentId: 'qoderwork', template: '%LOCALAPPDATA%\\QoderWork CN' },
  { agentId: 'qoderwork', template: '~/Library/Application Support/QoderWork CN' },
  { agentId: 'qoderwork', template: '~/Library/Application Support/QoderWork' },

  // --- traework (TRAE / TRAE SOLO) ---
  { agentId: 'traework', template: '%APPDATA%\\trae' },
  { agentId: 'traework', template: '%APPDATA%\\trae-solo' },
  { agentId: 'traework', template: '%APPDATA%\\TRAE' },
  { agentId: 'traework', template: '%LOCALAPPDATA%\\trae' },
  { agentId: 'traework', template: '~/Library/Application Support/trae' },
  { agentId: 'traework', template: '~/Library/Application Support/TRAE' },

  // --- workbuddy ---
  { agentId: 'workbuddy', template: '%USERPROFILE%\\.workbuddy\\app' },
  { agentId: 'workbuddy', template: '%APPDATA%\\.workbuddy\\app' },
  { agentId: 'workbuddy', template: '~/Library/Application Support/workbuddy' },

  // --- doubao ---
  { agentId: 'doubao', template: '%APPDATA%\\Doubao' },
  { agentId: 'doubao', template: '%LOCALAPPDATA%\\Doubao' },
  { agentId: 'doubao', template: '~/Library/Application Support/Doubao' },

  // --- zcode ---
  { agentId: 'zcode', template: '%APPDATA%\\zcode' },
  { agentId: 'zcode', template: '%LOCALAPPDATA%\\zcode' },
  { agentId: 'zcode', template: '~/Library/Application Support/zcode' },
];

/**
 * Return the list of known user-data directory templates for a given platform.
 *
 * Filters the full template list to entries that are plausible on the
 * current platform: Windows templates contain `%VAR%` or backslashes;
 * macOS templates start with `~`. This avoids expanding Windows-only
 * paths on macOS (where `%APPDATA%` would remain as a literal token).
 *
 * @param platform  Node.js `process.platform` value ('win32', 'darwin', 'linux').
 * @returns         Array of { agentId, template } objects for the platform.
 */
export function getDevToolsActivePortCandidates(platform: string): CandidateTemplate[] {
  if (platform === 'win32') {
    return CANDIDATE_TEMPLATES.filter((c) => c.template.includes('%') || c.template.includes('\\'));
  }
  if (platform === 'darwin') {
    return CANDIDATE_TEMPLATES.filter((c) => c.template.startsWith('~/'));
  }
  // linux: no supported agents currently ship a Linux build; return [].
  return [];
}

/**
 * Convenience: expand all candidate templates for the current platform into
 * absolute directory paths, appending dynamically-discovered MSIX user-data
 * dirs (which cannot be static templates because the package path embeds a
 * per-version hash). Useful for diagnostics and for callers that want to
 * pre-resolve before scanning.
 *
 * @param platform  Node.js `process.platform` value.
 * @returns         Array of { agentId, dirPath } with expanded directories.
 */
export function expandCandidatesForPlatform(
  platform: string,
  homeDir?: string,
): { agentId: string; dirPath: string }[] {
  const expanded = getDevToolsActivePortCandidates(platform).map((c) => ({
    agentId: c.agentId,
    dirPath: expandPath(c.template),
  }));
  if (platform === 'win32') {
    for (const dirPath of getMsixUserDataDirsSync(homeDir)) {
      if (!expanded.some((c) => c.dirPath === dirPath)) {
        expanded.push({ agentId: 'codex', dirPath });
      }
    }
  }
  return expanded;
}

/**
 * MSIX (Windows Store) apps virtualize their `%APPDATA%` into the per-package
 * data dir, so the DevToolsActivePort file lands somewhere like
 * `%LOCALAPPDATA%\Packages\OpenAI.Codex_<hash>\LocalCache\Roaming\Codex\web\Codex`
 * — a path that embeds the package version hash and cannot be expressed as a
 * static template. Scan the Packages root for known MSIX package prefixes and
 * return their resolved user-data dirs. Best-effort and synchronous (runs once
 * per port discovery); returns [] when the Packages root is missing, locked
 * down, or no matching package is installed.
 *
 * @param homeDir  Optional home directory override (tests). Defaults to
 *                 `os.homedir()`.
 */
export function getMsixUserDataDirsSync(homeDir: string = os.homedir()): string[] {
  const packagesRoot = path.join(homeDir, 'AppData', 'Local', 'Packages');
  const dirs: string[] = [];
  try {
    for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // OpenAI Codex (ChatGPT desktop) ships as an MSIX package; its user-data
      // dir is `LocalCache\Roaming\Codex\web\Codex` inside the package data.
      if (!/^OpenAI\.Codex_/i.test(entry.name)) continue;
      const candidate = path.join(
        packagesRoot,
        entry.name,
        'LocalCache',
        'Roaming',
        'Codex',
        'web',
        'Codex',
      );
      if (fs.existsSync(candidate)) dirs.push(candidate);
    }
  } catch {
    // Non-Windows or locked-down Packages root — no dynamic candidates.
  }
  return dirs;
}

/**
 * Scan all candidate directories for a live DevToolsActivePort file and
 * return the first valid port found. Best-effort: reads files sequentially,
 * stops at the first success. Callers must still TCP-probe the port.
 *
 * @param platform  Node.js `process.platform` value.
 * @returns         The first valid port number, or null if none found.
 */
export async function scanDevToolsActivePort(platform: string): Promise<number | null> {
  const candidates = getDevToolsActivePortCandidates(platform);
  for (const { template } of candidates) {
    const dirPath = expandPath(template);
    const port = await readDevToolsActivePort(dirPath);
    if (port !== null) return port;
  }
  return null;
}
