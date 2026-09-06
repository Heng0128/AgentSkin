// SPDX-License-Identifier: MPL-2.0

import { api } from '@/api/agentSkinClient';
import { rWarn } from '@/utils/renderer-log';

import type { EnvironmentPreset } from '@shared/types/environment';
import { ENV_PRESETS_STORAGE_KEY } from '@shared/types/environment';

/**
 * # EnvironmentStore
 *
 * Renderer-side bridge for EnvironmentPreset persistence. As of v2 (the
 * Workspace "做实" work, strategic audit P0-3), presets are persisted by the
 * MAIN process at `<userData>/env-presets.json` — no more renderer
 * localStorage. This module talks to that store asynchronously through
 * `api.getEnvironmentPresets()` / `api.saveEnvironmentPresets()`.
 *
 * One-time migration: on first run after the v1→v2 bump, any presets still
 * sitting in the legacy localStorage key are read, back-filled with
 * `wallpaperId: null`, written to the main process, then the legacy key is
 * cleared so it is never consulted again.
 *
 * Pure helpers (createPreset / updatePreset / removePreset / upsertPreset /
 * getPresetById) stay synchronous — they only transform in-memory arrays and
 * do not touch persistence.
 */

interface PresetStorageEnvelope {
  /** Schema version for forward compatibility. */
  v: number;
  /** List of presets. */
  presets: EnvironmentPreset[];
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function now(): string {
  return new Date().toISOString();
}

// Field-level validation — every preset must carry these keys with correct types.
// Mirrors the main-process validation in env-preset-store.ts (same length limits)
// so a preset accepted by the renderer is never silently dropped on write.
function isValidPreset(p: unknown): p is EnvironmentPreset {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length <= 256 &&
    typeof r.name === 'string' &&
    r.name.length <= 512 &&
    typeof r.agentId === 'string' &&
    r.agentId.length <= 128 &&
    (typeof r.themeId === 'string' && r.themeId.length <= 512 ? true : r.themeId === null) &&
    // wallpaperId may be absent (legacy v1 entries) — the loader back-fills null.
    (r.wallpaperId === undefined ||
      (typeof r.wallpaperId === 'string' && r.wallpaperId.length <= 512) ||
      r.wallpaperId === null) &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length <= 64 &&
    typeof r.updatedAt === 'string' &&
    r.updatedAt.length <= 64
  );
}

/**
 * Read any legacy v1 localStorage presets and back-fill `wallpaperId: null`.
 * The legacy key is always cleared, whether or not usable data was found.
 */
function migrateLegacyLocalStorage(): EnvironmentPreset[] {
  try {
    const raw = window.localStorage.getItem(ENV_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const envelope = JSON.parse(raw) as PresetStorageEnvelope;
    const legacy = Array.isArray(envelope?.presets) ? envelope.presets : [];
    const migrated = legacy.filter(isValidPreset).map((p) => ({
      ...p,
      wallpaperId: (p as { wallpaperId?: string | null }).wallpaperId ?? null,
    }));
    window.localStorage.removeItem(ENV_PRESETS_STORAGE_KEY);
    return migrated;
  } catch {
    window.localStorage.removeItem(ENV_PRESETS_STORAGE_KEY);
    return [];
  }
}

// Module-level guard: prevents concurrent migration calls within the same
// renderer process. If two windows race on first-run migration, only the
// first to acquire this flag performs the migration; subsequent callers
// skip it (localStorage.removeItem in migrateLegacyLocalStorage ensures
// the legacy data is gone regardless).
let migrationInFlight: Promise<EnvironmentPreset[]> | null = null;

/** Load presets from the main process. Migrates legacy localStorage data on first run. */
export async function loadPresets(): Promise<EnvironmentPreset[]> {
  try {
    const fromMain = await api.getEnvironmentPresets();
    if (fromMain.length === 0) {
      // Only one migration runs at a time — concurrent loadPresets calls
      // reuse the same in-flight promise.
      if (!migrationInFlight) {
        migrationInFlight = (async () => {
          try {
            const legacy = migrateLegacyLocalStorage();
            if (legacy.length > 0) {
              await api.saveEnvironmentPresets(legacy);
              return legacy;
            }
            return [];
          } finally {
            migrationInFlight = null;
          }
        })();
      }
      const migrated = await migrationInFlight;
      if (migrated.length > 0) return migrated;
    }
    return fromMain.filter(isValidPreset);
  } catch (err) {
    rWarn('EnvironmentStore', `load failed: ${String(err)}`);
    return [];
  }
}

/**
 * Persist all presets to the main process. `onFailure` is invoked on any
 * error so the caller can surface a toast instead of silently losing data.
 */
export async function savePresets(
  presets: EnvironmentPreset[],
  onFailure?: (error: unknown) => void,
): Promise<boolean> {
  try {
    const res = await api.saveEnvironmentPresets(presets);
    if (!res?.ok) {
      onFailure?.(new Error('main process refused to persist environment presets'));
      return false;
    }
    return true;
  } catch (error) {
    onFailure?.(error);
    return false;
  }
}

/** Create a new preset. Generates id and timestamps. */
export function createPreset(
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  wallpaperId: EnvironmentPreset['wallpaperId'] = null,
  name?: string,
): EnvironmentPreset {
  const ts = now();
  return {
    id: generateId(),
    name: name || `Untitled`,
    agentId,
    themeId,
    wallpaperId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Update an existing preset's fields. */
export function updatePreset(
  presets: EnvironmentPreset[],
  presetId: string,
  updates: Partial<Pick<EnvironmentPreset, 'name' | 'agentId' | 'themeId' | 'wallpaperId'>>,
): EnvironmentPreset[] {
  return presets.map((p) => (p.id === presetId ? { ...p, ...updates, updatedAt: now() } : p));
}

/** Remove a preset by id. Returns the filtered list. */
export function removePreset(presets: EnvironmentPreset[], presetId: string): EnvironmentPreset[] {
  return presets.filter((p) => p.id !== presetId);
}

/** Get a preset by id. Returns null if not found. */
export function getPresetById(presets: EnvironmentPreset[], id: string): EnvironmentPreset | null {
  return presets.find((p) => p.id === id) ?? null;
}

/**
 * Upsert: update the existing preset for this agent+theme combo (preserving
 * its id) or create a new one. Environment presets are keyed by agent+theme
 * — one environment per agent per theme (Agent + Theme + Wallpaper binding).
 *
 * This matches the dedup logic in `switchEnvironment` (which uses
 * `agentId + themeId` to detect existing presets), ensuring both manual
 * creation and auto-creation paths share the same uniqueness semantics.
 */
export function upsertPreset(
  presets: EnvironmentPreset[],
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  wallpaperId: EnvironmentPreset['wallpaperId'] = null,
  name?: string,
): EnvironmentPreset[] {
  const existing = presets.find((p) => p.agentId === agentId && p.themeId === themeId);
  if (existing) {
    return updatePreset(presets, existing.id, { name, themeId, wallpaperId });
  }
  const newPreset = createPreset(agentId, themeId, wallpaperId, name);
  return [...presets, newPreset];
}
