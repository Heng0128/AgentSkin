// SPDX-License-Identifier: MPL-2.0

import type { EnvironmentPreset } from '@/types/environment';
import { ENV_PRESETS_STORAGE_KEY, PRESET_SCHEMA_VERSION } from '@/types/environment';
import { rWarn } from '@/utils/renderer-log';

/**
 * # EnvironmentStore
 *
 * Renderer-only, localStorage-backed persistence for EnvironmentPreset.
 *
 * This is NOT an IPC layer. It reads/writes directly to window.localStorage.
 * No Main Process involvement. No Adapter. No Core.
 *
 * Design:
 *   - All operations are synchronous (localStorage API is sync).
 *   - Errors are caught silently — if localStorage is full/unavailable,
 *     the app degrades gracefully (presets are lost on reload but nothing crashes).
 *   - Schema version is stored alongside data for future migrations.
 *
 * Thread safety:
 *   - Only the renderer tab writes. No cross-tab coordination needed
 *     for v1 (single-user desktop app).
 */

/** Internal storage envelope — wraps presets with metadata. */
interface PresetStorageEnvelope {
  /** Schema version for forward compatibility. */
  v: number;
  /** List of presets. */
  presets: EnvironmentPreset[];
}

function generateId(): string {
  // Simple UUID v4-like id using crypto if available, fallback to Date+random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function now(): string {
  return new Date().toISOString();
}

/** Load presets from localStorage. Returns empty array on failure. */
export function loadPresets(): EnvironmentPreset[] {
  try {
    const raw = window.localStorage.getItem(ENV_PRESETS_STORAGE_KEY);
    if (!raw) return [];

    const envelope: PresetStorageEnvelope = JSON.parse(raw);

    // Schema migration: if version doesn't match, try to adapt
    if (envelope.v !== PRESET_SCHEMA_VERSION) {
      // v1 migration: just accept the data as-is
      rWarn('EnvironmentStore', `Schema version ${envelope.v} != expected ${PRESET_SCHEMA_VERSION}, accepting anyway`);
    }

    return Array.isArray(envelope.presets) ? envelope.presets : [];
  } catch {
    // localStorage unavailable, corrupted data, parse error — degrade gracefully
    return [];
  }
}

/** Save all presets to localStorage. Returns false on failure. */
export function savePresets(presets: EnvironmentPreset[]): boolean {
  try {
    const envelope: PresetStorageEnvelope = {
      v: PRESET_SCHEMA_VERSION,
      presets,
    };
    window.localStorage.setItem(ENV_PRESETS_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    // localStorage quota exceeded or unavailable
    return false;
  }
}

/** Create a new preset. Generates id and timestamps. */
export function createPreset(
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  name?: string,
): EnvironmentPreset {
  const ts = now();
  return {
    id: generateId(),
    name: name || `Untitled`,
    agentId,
    themeId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Update an existing preset's fields. */
export function updatePreset(
  presets: EnvironmentPreset[],
  presetId: string,
  updates: Partial<Pick<EnvironmentPreset, 'name' | 'agentId' | 'themeId'>>,
): EnvironmentPreset[] {
  return presets.map((p) =>
    p.id === presetId
      ? { ...p, ...updates, updatedAt: now() }
      : p,
  );
}

/** Remove a preset by id. Returns the filtered list. */
export function removePreset(presets: EnvironmentPreset[], presetId: string): EnvironmentPreset[] {
  return presets.filter((p) => p.id !== presetId);
}

/** Get a preset by id. Returns null if not found. */
export function getPresetById(presets: EnvironmentPreset[], id: string): EnvironmentPreset | null {
  return presets.find((p) => p.id === id) ?? null;
}

/** Upsert: create if not exists, update if exists. */
export function upsertPreset(
  presets: EnvironmentPreset[],
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  name?: string,
): EnvironmentPreset[] {
  // Check if a preset for this agent+theme already exists
  const existing = presets.find(
    (p) => p.agentId === agentId && p.themeId === themeId,
  );

  if (existing) {
    return updatePreset(presets, existing.id, { name });
  }

  const newPreset = createPreset(agentId, themeId, name);
  return [...presets, newPreset];
}
