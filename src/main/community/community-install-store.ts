// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Install Log Store (main process)
 *
 * Persists the community theme installation history to
 * `<userData>/community-install-log.json`, following the same convention as
 * `env-preset-store.ts` (`<userData>/env-presets.json`). This makes the
 * renderer's in-memory `installationLog` survive app restarts.
 *
 * The renderer never touches the file directly; it calls
 * `api.loadCommunityInstallLog()` / `api.saveCommunityInstallLog()` which
 * resolve to the IPC handlers in `community-theme-ipc.ts`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InstallationRecord } from '../../shared/types/community';
import { atomicWriteJson } from '../fs-utils';

const FILENAME = 'community-install-log.json';
const SCHEMA_VERSION = 1;

/** Absolute path of the install-log file inside the user data directory. */
export function communityInstallLogPath(userDataRoot: string): string {
  return path.join(userDataRoot, FILENAME);
}

/** Field-level validation — every record must carry these keys with correct types. */
export function isValidInstallationRecord(record: unknown): record is InstallationRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.themeId === 'string' &&
    r.themeId.length > 0 &&
    (r.sourceId === 'dreamskin' || r.sourceId === 'codedrobe') &&
    typeof r.installedAt === 'number' &&
    Number.isFinite(r.installedAt) &&
    typeof r.sourceThemeVersion === 'string'
  );
}

/**
 * Load the install history from disk. Returns [] when the file is missing,
 * corrupt, or contains no valid records — graceful degradation only.
 */
export async function loadCommunityInstallLog(userDataRoot: string): Promise<InstallationRecord[]> {
  try {
    const raw = await fs.readFile(communityInstallLogPath(userDataRoot), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const records = (parsed as { records?: unknown }).records;
    if (!Array.isArray(records)) return [];
    return records.filter(isValidInstallationRecord);
  } catch {
    // Missing file, permission error, or parse failure — degrade gracefully.
    return [];
  }
}

/**
 * Persist the install history to disk under the current schema version.
 * Drops any malformed entries before writing so a hostile or buggy renderer
 * cannot write junk. Returns success.
 */
export async function saveCommunityInstallLog(
  userDataRoot: string,
  records: InstallationRecord[],
): Promise<boolean> {
  try {
    const clean = Array.isArray(records) ? records.filter(isValidInstallationRecord) : [];
    const envelope = { v: SCHEMA_VERSION, records: clean };
    // Atomic write (temp → fsync → rename → dir-fsync) — a crash mid-write
    // can never leave the file half-written.
    await atomicWriteJson(communityInstallLogPath(userDataRoot), envelope);
    return true;
  } catch {
    return false;
  }
}
