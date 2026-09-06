// SPDX-License-Identifier: MPL-2.0

/**
 * # Pet Types
 *
 * Type definitions for the AgentSkin Desktop Pet system — a floating
 * desktop companion that runs independently of any target AI application.
 *
 * The pet is rendered in a transparent, frameless, always-on-top
 * BrowserWindow managed by the main process. The renderer-side petStore
 * owns the state; IPC bridges position/visibility changes to the main
 * process which moves the window.
 */

/** A single animation sequence for a pet (idle / hover / drag / sleep, etc.). */
export interface PetAnimation {
  /** Animation identifier (e.g. "idle", "hover", "drag", "sleep"). */
  name: string;
  /** Ordered frame image paths (absolute or asset-relative). */
  frames: string[];
  /** Playback rate in frames per second. */
  fps: number;
  /** Whether the animation loops. */
  loop: boolean;
}

/** Static metadata + asset references for a single pet definition. */
export interface PetConfig {
  /** Unique pet id (used as the BrowserWindow key). */
  id: string;
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** Preview/thumbnail image path. */
  thumbnail: string;
  /** Sprite sheet / animation asset base path. */
  spriteSheet: string;
  /** Natural pixel width of the pet. */
  width: number;
  /** Natural pixel height of the pet. */
  height: number;
  /** Available animations. */
  animations: PetAnimation[];
}

/** Persisted per-pet runtime state. */
export interface PetRuntimeState {
  /** Currently active pet id, or null when no pet is shown. */
  activePetId: string | null;
  /** Last known window position. */
  position: { x: number; y: number };
  /** Whether the pet is currently being dragged. */
  isDragging: boolean;
  /** Currently playing animation name. */
  currentAnimation: string;
  /** Whether the pet window is visible. */
  isVisible: boolean;
}

/** Payload sent when the renderer reports a drag-end (new position). */
export interface PetMoveRequest {
  x: number;
  y: number;
}

/** Payload to switch the active pet. */
export interface PetSetRequest {
  petId: string;
}
