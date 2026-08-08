// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene Renderer Types
 *
 * Shared type definitions for the scene renderer layer pipeline.
 * Consumed by scene-renderer-layers.ts (layer extraction) and
 * scene-renderer-html.ts (layer → HTML document generation).
 */

import type { SceneColor } from './scene-pkg-parser';

// ---------------------------------------------------------------------------
// Particle state
// ---------------------------------------------------------------------------

/**
 * Runtime state for a single particle in the 2D particle simulator.
 * Mutable — the simulator updates each field every frame.
 */
export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// Particle layer config
// ---------------------------------------------------------------------------

/**
 * Serialized config for a 2D particle-simulation layer. Built from a Wallpaper
 * Engine particle JSON (resolved from the WE install `assets/`), flattened so
 * the inline HTML script only needs this compact object.
 */
export interface ParticleLayer {
  /** Particles emitted per second. */
  rate: number;
  /** Particle count cap (WE `maxcount`). */
  maxCount: number;
  /** Spawn volume: 'sphere' (radius distanceMin..distanceMax) or 'box'. */
  spawn: 'sphere' | 'box';
  /** Absolute emitter position in scene space (bottom-left origin, +y up). */
  origin: { x: number; y: number; z: number };
  /** Spawn direction / box half-extent. */
  directions: { x: number; y: number; z: number };
  distanceMin: number;
  distanceMax: number;
  lifetimeMin: number;
  lifetimeMax: number;
  sizeMin: number;
  sizeMax: number;
  velocityMin: { x: number; y: number; z: number };
  velocityMax: { x: number; y: number; z: number };
  /** Particle color range, normalized 0-1. */
  colorMin: { r: number; g: number; b: number };
  colorMax: { r: number; g: number; b: number };
  /** Object tint (from instanceoverride.colorn), 0-1, or null. */
  tint: { r: number; g: number; b: number } | null;
  gravity: { x: number; y: number; z: number };
  /** Drag coefficient (0 = none). */
  drag: number;
  /** Fade-in duration in seconds (0 = instant). */
  fadeInTime: number;
  /** True for additive-blended materials → canvas 'lighter' composite. */
  additive: boolean;
  /** Sprite data URL (null → draw plain colored circles). */
  image: string | null;
  /** Sprite aspect ratio (width/height), for undistorted drawing. */
  aspect: number;
  /** Object transform applied to every particle. */
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  parallaxDepth: number;
}

// ---------------------------------------------------------------------------
// Render layer
// ---------------------------------------------------------------------------

/**
 * A single renderable layer in the scene renderer. Every visible object
 * (with a texture, solid color, text, or particle system) becomes one layer,
 * sorted by parallax depth so further-back layers render first.
 */
export interface RenderLayer {
  /** Texture data URL (null for solid-color / text / particle layers). */
  dataUrl: string | null;
  /** Animated (GIF) frames for this layer: { dataUrl, frametime } per frame.
   *  When present the renderer switches the drawn image on each frame's
   *  interval; the still image at index 0 is the fallback until loaded. */
  frames: Array<{ dataUrl: string; frametime: number }> | null;
  /** Origin x in scene space (centered at canvas center). */
  x: number;
  /** Origin y in scene space. */
  y: number;
  /** Scale factor (1 = native texture size). */
  scaleX: number;
  scaleY: number;
  /** Rotation in radians. */
  rotation: number;
  /** Opacity (0-1). */
  alpha: number;
  /** Solid fill color (for solidLayer objects). */
  solidColor: { r: number; g: number; b: number } | null;
  /** Parallax depth (negative = further back, positive = closer). */
  parallaxDepth: number;
  /** Display quad size in scene units. */
  width: number;
  height: number;
  /** Anchor point (0-1 normalized) computed from the object's alignment.
   *  Used by the renderer to offset the layer from its origin. */
  anchorX: number;
  anchorY: number;
  /** Texture aspect ratio (width/height) for textured layers; null for solid
   *  layers. The texture is drawn PRESERVING this ratio (cover-fit into the
   *  quad area), never stretched. */
  texAspect: number | null;
  /** Particle-simulation config (null for static/solid/text layers). */
  particle: ParticleLayer | null;
  /** Audio-reactivity flag — when true the layer breathes with the audio level. */
  audioResponsive: boolean;
  /** Audio frequency band this layer responds to: 0 = bass, 1 = mid, 2 = treble,
   *  -1 = all bands (default). */
  audioBand: 0 | 1 | 2 | -1;
  /** Audio-reactivity gain multiplier (1 = default). */
  audioGain: number;
  /** Wind displacement amount (0 = no wind). Computed from parallax depth and
   *  scene-level wind settings. */
  windAmount: number;
  /** Text content (for text layers); null for non-text layers. */
  text: string | null;
  /** Font family string (for text layers). */
  font: string | null;
  /** Point size in px (for text layers). */
  pointSize: number | null;
  /** Horizontal text alignment. */
  horizontalAlign: 'left' | 'center' | 'right' | null;
  /** Vertical text alignment. */
  verticalAlign: 'top' | 'center' | 'bottom' | null;
  /** Brightness multiplier (null = default/1). */
  brightness: number | null;
  /** Background color for text layers (null = transparent). */
  backgroundColor: SceneColor | null;
}
