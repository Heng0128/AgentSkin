// SPDX-License-Identifier: MPL-2.0

/**
 * # Steam Path Resolver
 *
 * Locates the Wallpaper Engine workshop content directory by mirroring the
 * detection strategy used by WEML (WallpaperEngineMediaLibrary):
 *
 * 1. Read Steam's install path from the Windows registry
 *    (HKLM\SOFTWARE\WOW6432Node\Valve\Steam → InstallPath)
 * 2. Parse `libraryfolders.vdf` to discover ALL Steam library locations
 *    (users commonly install games on D:\, E:\, etc.)
 * 3. Find the library that contains app 431960 (Wallpaper Engine)
 * 4. Construct the workshop content path:
 *    `<library>/steamapps/workshop/content/431960`
 *
 * This is dramatically more reliable than hard-coding `C:\Program Files
 * (x86)\Steam\...` because Steam supports multiple library folders across
 * different drives. The VDF file is Steam's own metadata format that tracks
 * which apps are installed in which library.
 *
 * On macOS / Linux the resolver falls back to platform-conventional paths
 * since the registry + VDF approach is Windows-only.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Wallpaper Engine's Steam app id. */
const WE_APP_ID = '431960';

// ---------------------------------------------------------------------------
// VDF Parser (Valve Data Format)
// ---------------------------------------------------------------------------

/**
 * A parsed VDF node — either a string leaf or a nested object.
 * VDF is a simple recursive key-value format where every value is either
 * a quoted string or a `{ ... }` block.
 */
export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

/**
 * Minimal tokenizer for VDF text. Splits the input into quoted strings,
 * `{`, and `}` tokens. Comments (`//` to end-of-line) are stripped.
 *
 * VDF doesn't have a formal spec, but the format is consistently:
 * - `"key"  "value"` — key-value pair
 * - `"key" { ... }`  — nested block
 * - Whitespace between tokens is insignificant
 * - `//` starts a line comment
 */
function tokenizeVdf(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Skip line comments
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Quoted string — read until matching unescaped quote
    if (ch === '"') {
      i++; // skip opening quote
      let str = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          // P3-10: VDF spec supports backslash escapes for " \ \n \t.
          //   * \" — literal double-quote (appears in paths or labels
          //          that embed user strings; without this, the next byte
          //          would be consumed as the closing quote and the
          //          remainder of the block would parse as garbage).
          //   * \\ — literal backslash
          //   * \n / \t — control chars (rare in Steam VDF but reserved)
          // For single non-special backslashes (the overwhelmingly common
          // case: Windows drive paths like C:\Program Files\Steam), keep
          // the backslash verbatim — path resolution can still use them.
          const next = text[i + 1];
          if (next === '"' || next === '\\') {
            str += next;
            i += 2;
          } else if (next === 'n') {
            str += '\n';
            i += 2;
          } else if (next === 't') {
            str += '\t';
            i += 2;
          } else {
            str += text[i];
            str += next;
            i += 2;
          }
        } else {
          str += text[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push(str);
      continue;
    }
    // Brace tokens
    if (ch === '{' || ch === '}') {
      tokens.push(ch);
      i++;
      continue;
    }
    // Unrecognized character — skip (VDF sometimes has stray chars)
    i++;
  }
  return tokens;
}

/**
 * Parse VDF text into a {@link VdfObject}. The parser is a recursive
 * descent over the token stream:
 * - Read a key token, then either a value token or a `{` block.
 * - Repeated keys overwrite (matches VDF semantics where later entries win).
 *
 * Returns an empty object for empty/malformed input rather than throwing,
 * so callers can use optional chaining without try/catch.
 */
export function parseVdf(text: string): VdfObject {
  const tokens = tokenizeVdf(text);
  let pos = 0;

  function parseObject(): VdfObject {
    const obj: VdfObject = {};
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token === '}') {
        pos++;
        return obj;
      }
      if (token === '{') {
        // Unexpected `{` without a preceding key — skip
        pos++;
        continue;
      }
      // token is a key
      const key = token;
      pos++;
      if (pos >= tokens.length) break;
      const next = tokens[pos];
      if (next === '{') {
        pos++; // skip `{`
        obj[key] = parseObject();
      } else if (next === '}') {
        // Key with no value — treat as empty string
        obj[key] = '';
      } else {
        obj[key] = next;
        pos++;
      }
    }
    return obj;
  }

  return parseObject();
}

// ---------------------------------------------------------------------------
// Steam install path detection
// ---------------------------------------------------------------------------

/**
 * Query the Windows registry for Steam's install path.
 *
 * Tries the 64-bit registry path first (WOW6432Node), then falls back to
 * the 32-bit path. Returns null when not found (e.g. Steam not installed
 * or running on macOS/Linux).
 *
 * Uses `reg query` via child_process — the same approach WEML uses with
 * Python's `winreg` module, adapted for Node.js.
 */
function getSteamInstallPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null;

  const registryPaths = ['SOFTWARE\\WOW6432Node\\Valve\\Steam', 'SOFTWARE\\Valve\\Steam'];

  for (const regPath of registryPaths) {
    try {
      const output = execSync(`reg query "HKLM\\${regPath}" /v InstallPath`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Output looks like:
      //   HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam
      //       InstallPath    REG_SZ    C:\Program Files (x86)\Steam
      // P3-9: The old regex anchored on "REG_SZ" which is the English reg.exe
      // token name. On localized Windows the friendly type label varies, but
      // the column format is always:
      //   <whitespace><valueName><whitespace><typeToken><whitespace><data>
      // We first look for the InstallPath line, then either:
      //   1. Split by 2+ whitespace (tab/space run) and take the 3rd column, or
      //   2. Fall back to the English REG_SZ regex if that doesn't work.
      // This keeps parsing robust on Chinese / Japanese / Korean editions
      // where the type token is translated but the column layout still holds.
      const line = output.split(/\r?\n/).find((ln) => /^\s*InstallPath\s+/i.test(ln));
      if (line) {
        const byColumn = line.trim().split(/\s{2,}|\t+/);
        if (byColumn.length >= 3 && byColumn[2]) {
          const installPath = byColumn[2].trim();
          if (installPath) return installPath;
        }
        const matchEn = line.match(/InstallPath\s+REG_SZ\s+(.+)/i);
        if (matchEn) {
          const installPath = matchEn[1].trim();
          if (installPath) return installPath;
        }
      }
    } catch {
      // Registry key not found or reg command failed — try next path
    }
  }
  return null;
}

/**
 * Parse `libraryfolders.vdf` and extract all Steam library paths that
 * contain the Wallpaper Engine app (431960).
 *
 * The VDF structure is:
 * ```
 * "libraryfolders"
 * {
 *   "0" { "path" "C:\\Steam"  "apps" { "431960" "..." } }
 *   "1" { "path" "D:\\Steam"  "apps" { "431960" "..." } }
 * }
 * ```
 *
 * Returns an array of library root paths (e.g. `["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]`).
 * Each path is a Steam library root where `steamapps/workshop/content/431960`
 * may exist.
 */
export function extractLibraryPathsFromVdf(vdfText: string, appId: string = WE_APP_ID): string[] {
  const parsed = parseVdf(vdfText);
  const libraries = parsed.libraryfolders;
  if (!libraries || typeof libraries === 'string') return [];

  const paths: string[] = [];
  for (const value of Object.values(libraries)) {
    if (typeof value === 'string') continue;
    const libPath = value.path;
    const apps = value.apps;
    if (typeof libPath !== 'string' || !libPath) continue;
    if (!apps || typeof apps === 'string') continue;
    // Check if this library has the target app
    if (appId in apps) {
      paths.push(libPath);
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Workshop root resolution
// ---------------------------------------------------------------------------

/**
 * Fallback hard-coded Steam install locations (used when registry query
 * fails or on non-Windows platforms). These mirror the original
 * `candidateWorkshopRoots()` logic from wallpaper-service.ts.
 */
function fallbackSteamPaths(): string[] {
  const paths: string[] = [];
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    paths.push(path.join(pf86, 'Steam'));
    paths.push(path.join(pf, 'Steam'));
  } else if (process.platform === 'darwin') {
    paths.push(path.join(os.homedir(), 'Library', 'Application Support', 'Steam'));
  } else {
    paths.push(path.join(os.homedir(), '.steam', 'steam'));
    paths.push(path.join(os.homedir(), '.local', 'share', 'Steam'));
  }
  return paths;
}

/**
 * Resolve all candidate Steam library paths that might contain the
 * Wallpaper Engine workshop content directory.
 *
 * Strategy (in priority order):
 * 1. Read Steam install path from Windows registry
 * 2. Parse `libraryfolders.vdf` in `<steam>/config/` to find all libraries
 *    containing app 431960
 * 3. Also check the Steam install directory itself (WE might be in the
 *    primary library, not listed in libraryfolders.vdf)
 * 4. Fall back to hard-coded paths if registry/VDF approach fails
 *
 * Returns an array of Steam library root paths. Callers should check
 * `<root>/steamapps/workshop/content/431960` for each.
 */
export async function resolveSteamLibraryPaths(): Promise<string[]> {
  const steamInstallPath = getSteamInstallPathFromRegistry();

  if (steamInstallPath) {
    // Parse libraryfolders.vdf to find all libraries with WE installed
    const vdfPath = path.join(steamInstallPath, 'config', 'libraryfolders.vdf');
    try {
      const vdfText = await fs.readFile(vdfPath, 'utf8');
      const libraryPaths = extractLibraryPathsFromVdf(vdfText);
      if (libraryPaths.length > 0) {
        // Also include the main Steam install path as a fallback
        // (libraryfolders.vdf sometimes omits the primary library)
        const allPaths = [...libraryPaths];
        if (!allPaths.includes(steamInstallPath)) {
          allPaths.push(steamInstallPath);
        }
        return allPaths;
      }
    } catch {
      // VDF file not readable — fall through
    }
    // VDF approach failed, but we have the registry path
    return [steamInstallPath];
  }

  // Registry approach failed (non-Windows or Steam not in registry)
  return fallbackSteamPaths();
}

/**
 * Resolve the Wallpaper Engine workshop content directory.
 *
 * Tries each candidate Steam library path and returns the first one where
 * `steamapps/workshop/content/431960` exists as a directory. Returns null
 * when no workshop directory is found on any library path.
 *
 * This function replaces the original `candidateWorkshopRoots()` in
 * wallpaper-service.ts with a more robust, VDF-aware implementation that
 * finds WE installations on any drive — not just C:\Program Files.
 */
export async function resolveWorkshopRoot(): Promise<string | null> {
  const libraryPaths = await resolveSteamLibraryPaths();
  for (const libPath of libraryPaths) {
    const workshopContent = path.join(libPath, 'steamapps', 'workshop', 'content', WE_APP_ID);
    try {
      const stat = await fs.stat(workshopContent);
      if (stat.isDirectory()) {
        return workshopContent;
      }
    } catch {
      // Not found at this library — try next
    }
  }
  return null;
}
