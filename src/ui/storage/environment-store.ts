// SPDX-License-Identifier: MPL-2.0

import { api } from '@/api/agentSkinClient';
import type { EnvironmentPreset } from '@/types/environment';
import { ENV_PRESETS_STORAGE_KEY } from '@/types/environment';
import { rWarn } from '@/utils/renderer-log';

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
function isValidPreset(p: unknown): p is EnvironmentPreset {
  if (!p || typeof p !== 'object') return false;
  const rec = p as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.name === 'string' &&
    typeof rec.agentId === 'string' &&
    (typeof rec.themeId === 'string' || rec.themeId === null) &&
    (typeof rec.wallpaperId === 'string' || rec.wallpaperId === null) &&
    typeof rec.createdAt === 'string' &&
    typeof rec.updatedAt === 'string'
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

/** Load presets from the main process. Migrates legacy localStorage data on first run. */
export async function loadPresets(): Promise<EnvironmentPreset[]> {
  try {
    const fromMain = await api.getEnvironmentPresets();
    if (fromMain.length === 0) {
      const legacy = migrateLegacyLocalStorage();
      if (legacy.length > 0) {
        await api.saveEnvironmentPresets(legacy);
        return legacy;
      }
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
 * Upsert: update the existing preset for this agent (preserving its id) or
 * create a new one. Environment presets are keyed by agent — one environment
 * per agent (Agent + Theme + Wallpaper binding).
 */
export function upsertPreset(
  presets: EnvironmentPreset[],
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  wallpaperId: EnvironmentPreset['wallpaperId'] = null,
  name?: string,
): EnvironmentPreset[] {
  const existing = presets.find((p) => p.agentId === agentId);
  if (existing) {
    return updatePreset(presets, existing.id, { name, themeId, wallpaperId });
  }
  const newPreset = createPreset(agentId, themeId, wallpaperId, name);
  return [...presets, newPreset];
}
