// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from '@shared/types';

/**
 * # EnvironmentModel
 *
 * An Environment = Agent + Theme combination.
 * It represents a "visual state" of an AI coding tool.
 *
 * This is the core UI concept that replaces the old
 * "Agent + Theme" separation on the Workspace page.
 *
 * In v2 (P2.5+P2.6), EnvironmentModel is derived from:
 *   1. EnvironmentPreset (persistent, user-defined)
 *   2. Runtime status (live, from AppController)
 *
 * The Model is the composition; the Preset is the source of truth
 * for user-defined names and preferences.
 *
 * presetId links this runtime model to its persistent preset.
 * null means this environment has no saved preset yet.
 */

export type EnvironmentStatus = 'active' | 'available' | 'offline' | 'detecting';

export interface EnvironmentModel {
  /** Unique id: `${agentId}-${themeId}` or `${agentId}-default` */
  id: string;
  /** Human-readable name (from preset or runtime-derived) */
  name: string;
  /** The AI agent this environment belongs to */
  agent: {
    id: AgentId;
    name: string;
    displayName: string;
  };
  /** The theme applied, or null for default/native */
  theme: {
    id: string;
    name: string;
    preview: string | null;
    icon: string | null;
  } | null;
  /** Current status of this environment */
  status: EnvironmentStatus;
  /** Whether the agent app is currently running */
  agentRunning: boolean;
  /** Whether the agent app is installed (detected) */
  agentInstalled: boolean;
  /** Detected install version (AgentSkin-side), when installed. */
  detectedVersion?: string | null;
  /** Detected install path (AgentSkin-side), when installed. */
  detectedPath?: string | null;
  /** Linked preset id (null if no preset exists for this env). P2.6+. */
  presetId?: string | null;
}

// ------------------------------------------------------------------
// EnvironmentPreset — persistent user definition (P2.5)
// ------------------------------------------------------------------

/**
 * # EnvironmentPreset
 *
 * A user-defined, persistable environment definition.
 *
 * An EnvironmentPreset is the "what" — the desired combination of
 * Agent + Theme that the user wants to work with.
 *
 * Runtime status (isRunning, themeApplied, etc.) is derived separately
 * from the live AppController status. Presets are static; environments
 * are dynamic compositions of Preset + runtime state.
 *
 * Fields:
 *   id          — stable unique key (UUID-like)
 *   name        — human label ("Frontend Studio")
 *   agentId     — which AI agent this preset targets
 *   themeId     — which theme to apply (null = default/native)
 *   createdAt   — when the preset was created (ISO string)
 *   updatedAt   — last modification time (ISO string)
 *
 * Storage:
 *   localStorage key: "agentskin:environment-presets"
 *   Format: JSON array of EnvironmentPreset objects.
 */
export interface EnvironmentPreset {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable label shown in the UI. */
  name: string;
  /** Target AI agent. */
  agentId: AgentId;
  /** Theme to apply. null = native/default. */
  themeId: string | null;
  /** Creation timestamp (ISO 8601). */
  createdAt: string;
  /** Last updated timestamp (ISO 8601). */
  updatedAt: string;
}

/** Schema version for future migration safety. */
export const PRESET_SCHEMA_VERSION = 1;

/** localStorage key for environment presets. */
export const ENV_PRESETS_STORAGE_KEY = 'agentskin:environment-presets';
