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

// R6-11: EnvironmentPreset 字段级校验函数。
// 原实现仅做 `Array.isArray(envelope.presets)` 浅层检查，字段类型错误的 preset
// 会流入消费端。此函数逐条验证关键字段的结构。
function isValidPreset(p: unknown): p is EnvironmentPreset {
  if (!p || typeof p !== 'object') return false;
  const rec = p as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.name === 'string' &&
    typeof rec.agentId === 'string' &&
    typeof rec.themeId === 'string' &&
    typeof rec.createdAt === 'string' &&
    typeof rec.updatedAt === 'string'
  );
}

/** Load presets from localStorage. Returns empty array on failure. */
export function loadPresets(): EnvironmentPreset[] {
  try {
    const raw = window.localStorage.getItem(ENV_PRESETS_STORAGE_KEY);
    if (!raw) return [];

    const envelope: PresetStorageEnvelope = JSON.parse(raw);

    // R6-22: Schema 版本不匹配时跳过加载而非静默降级。
    // 原实现仅打 warn 日志但仍加载数据，未来 schema 迁移时可能出错。
    if (envelope.v !== PRESET_SCHEMA_VERSION) {
      rWarn(
        'EnvironmentStore',
        `Schema version ${envelope.v} != expected ${PRESET_SCHEMA_VERSION}, refusing to load (migration path needed)`,
      );
      return [];
    }

    if (!Array.isArray(envelope.presets)) return [];

    // R6-11: 逐条字段校验，过滤无效 preset。
    const validPresets = envelope.presets.filter(isValidPreset);
    if (validPresets.length !== envelope.presets.length) {
      rWarn(
        'EnvironmentStore',
        `Dropped ${envelope.presets.length - validPresets.length} invalid preset(s) during load`,
      );
    }
    return validPresets;
  } catch {
    // localStorage unavailable, corrupted data, parse error — degrade gracefully
    return [];
  }
}

/**
 * Save all presets to localStorage.
 *
 * R6-12: 保存失败时调用 onFailure 回调通知调用方，而非静默丢弃。
 * 调用方可通过此回调向用户展示错误提示。
 */
export function savePresets(
  presets: EnvironmentPreset[],
  onFailure?: (error: unknown) => void,
): boolean {
  try {
    const envelope: PresetStorageEnvelope = {
      v: PRESET_SCHEMA_VERSION,
      presets,
    };
    window.localStorage.setItem(ENV_PRESETS_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch (error) {
    // localStorage quota exceeded or unavailable
    // R6-12: 调用失败回调通知用户，防止用户以为已保存但重启后消失。
    onFailure?.(error);
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

/** Upsert: create if not exists, update if exists. */
export function upsertPreset(
  presets: EnvironmentPreset[],
  agentId: EnvironmentPreset['agentId'],
  themeId: EnvironmentPreset['themeId'],
  name?: string,
): EnvironmentPreset[] {
  // Check if a preset for this agent+theme already exists
  const existing = presets.find((p) => p.agentId === agentId && p.themeId === themeId);

  if (existing) {
    return updatePreset(presets, existing.id, { name });
  }

  const newPreset = createPreset(agentId, themeId, name);
  return [...presets, newPreset];
}
