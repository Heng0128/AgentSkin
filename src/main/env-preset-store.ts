// SPDX-License-Identifier: MPL-2.0

/**
 * # Environment Preset Store (main process)
 *
 * Persists user-defined environment presets (Agent + Theme + Wallpaper
 * bindings) to `<userData>/env-presets.json`. This replaces the old
 * renderer-localStorage backing (v1) — part of the Workspace "做实" work
 * (strategic audit P0-3).
 *
 * The renderer no longer touches localStorage for presets; it calls
 * `api.getEnvironmentPresets()` / `api.saveEnvironmentPresets()` which
 * resolve to the two IPC handlers in `environment-ipc.ts`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EnvironmentPreset } from '../shared/types/environment';
import { PRESET_SCHEMA_VERSION } from '../shared/types/environment';

const FILENAME = 'env-presets.json';

/** Absolute path of the preset file inside the user data directory. */
export function envPresetsPath(userDataRoot: string): string {
  return path.join(userDataRoot, FILENAME);
}

interface PresetEnvelope {
  v: number;
  presets: EnvironmentPreset[];
}

/** Field-level validation — every preset must carry these keys with correct types. */
function isValidPreset(p: unknown): p is EnvironmentPreset {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.agentId === 'string' &&
    (typeof r.themeId === 'string' || r.themeId === null) &&
    // wallpaperId may be absent (legacy v1 entries) — the loader back-fills null.
    (r.wallpaperId === undefined || typeof r.wallpaperId === 'string' || r.wallpaperId === null) &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string'
  );
}

/**
 * Load presets from disk. Returns [] when the file is missing or corrupt.
 * Defensively back-fills `wallpaperId: null` for any legacy (v1-shaped)
 * entry so the rest of the app can rely on the field always being present.
 */
export async function loadEnvPresets(userDataRoot: string): Promise<EnvironmentPreset[]> {
  try {
    const raw = await fs.readFile(envPresetsPath(userDataRoot), 'utf8');
    const env = JSON.parse(raw) as Partial<PresetEnvelope>;
    if (!env || !Array.isArray(env.presets)) return [];
    return env.presets.filter(isValidPreset).map((p) => ({
      ...p,
      // Back-fill the v2 field for any v1-shaped record.
      wallpaperId: (p as { wallpaperId?: string | null }).wallpaperId ?? null,
    }));
  } catch {
    // Missing file, permission error, or parse failure — degrade gracefully.
    return [];
  }
}

/** Persist presets to disk under the current schema version. Returns success. */
export async function saveEnvPresets(
  userDataRoot: string,
  presets: EnvironmentPreset[],
): Promise<boolean> {
  try {
    const envelope: PresetEnvelope = { v: PRESET_SCHEMA_VERSION, presets };
    await fs.writeFile(envPresetsPath(userDataRoot), JSON.stringify(envelope, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}
