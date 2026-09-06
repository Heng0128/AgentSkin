// SPDX-License-Identifier: MPL-2.0

/**
 * # Particle Parser
 *
 * Parses Wallpaper Engine particle system JSON into typed structures for the
 * scene renderer's basic 2D particle simulation.
 *
 * WE particles are defined in the shared install assets
 * (`assets/particles/`, `assets/presets/<name>/particles/presets/`), NOT
 * inside scene.pkg — the scene.json only references them via `object.particle`
 * (e.g. `particles/presets/light_shafts_0.json`). The format has five
 * sections:
 *
 *   - `emitter`:    spawn source (rate, origin, spawn volume)
 *   - `initializer`: per-particle random ranges (lifetime, size, velocity,
 *                    color, rotation, angular velocity)
 *   - `operator`:   per-frame modifiers (movement gravity/drag, alphafade,
 *                    angularmovement)
 *   - `renderer`:   display type (`sprite`, …)
 *   - `material`:   path to the material JSON that names the sprite texture
 *
 * This module parses the common subset the 2D canvas renderer can simulate.
 * Unknown fields are ignored and malformed sections fall back to defaults —
 * the renderer drops particles that fail to parse and keeps the object's
 * static fallback, so complex shader-driven systems degrade gracefully.
 *
 * Structure verified against real Wallpaper Engine install assets
 * (assets/particles/example*.json, assets/presets/lightshafts/particles/presets/).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParticleVec3 {
  x: number;
  y: number;
  z: number;
}

/** RGB color normalized to 0-1 (WE particle JSON stores 0-255). */
export interface ParticleColor {
  r: number;
  g: number;
  b: number;
}

/** Random-range pair used by most initializers. */
export interface ParticleRange<T> {
  min: T;
  max: T;
}

/** Emitter: where and how fast particles spawn. */
export interface ParticleEmitter {
  /** 'sphererandom' | 'boxrandom' | ... — spawn volume type. */
  name: string;
  /** Particles emitted per second (can be fractional, e.g. 0.2). */
  rate: number;
  /** Emitter position in scene space. */
  origin: ParticleVec3;
  /** Spawn direction (1 = full extent). */
  directions: ParticleVec3;
  /** Sphere spawn: min/max radius. */
  distanceMin: number;
  distanceMax: number;
}

export interface ParticleInitializers {
  lifetime: ParticleRange<number>;
  size: ParticleRange<number>;
  velocity: ParticleRange<ParticleVec3>;
  color: ParticleRange<ParticleColor>;
  rotation: ParticleRange<ParticleVec3>;
  angularVelocity: ParticleRange<ParticleVec3>;
}

/** One parsed operator (only fields the 2D sim consumes). */
export interface ParticleOperator {
  name: string;
  gravity: ParticleVec3;
  drag: number;
  fadeInTime: number;
  force: ParticleVec3;
}

/** The parsed particle system. */
export interface SceneParticleData {
  /** Material path relative to the WE `assets/` dir (e.g.
   *  `materials/presets/light_shafts_0.json`). Null when absent. */
  material: string | null;
  /** Particle count cap (WE `maxcount`). */
  maxCount: number;
  /** Time offset before emission starts (WE `starttime`, seconds). */
  startTime: number;
  emitters: ParticleEmitter[];
  initializers: ParticleInitializers;
  operators: ParticleOperator[];
  /** Renderer names ('sprite', ...). */
  renderer: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type JsonObject = { readonly [key: string]: unknown };

function asJsonObject(v: unknown): JsonObject | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as JsonObject;
  return null;
}

function asJsonArray(v: unknown): JsonObject[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is JsonObject => !!asJsonObject(e));
}

function num(v: unknown, defaultVal: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : defaultVal;
}

/** Parse "x y z" strings or {x,y,z} objects; missing components → 0. */
function parseVec3(v: unknown): ParticleVec3 {
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, z: parts[2] || 0 };
  }
  const o = asJsonObject(v);
  if (o) {
    return {
      x: num(o.x, 0),
      y: num(o.y, 0),
      z: num(o.z, 0),
    };
  }
  return { x: 0, y: 0, z: 0 };
}

/** WE particle colors are 0-255 strings; normalize to 0-1 for canvas. */
function parseColor01(v: unknown): ParticleColor {
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number);
    return {
      r: (parts[0] || 0) / 255,
      g: (parts[1] || 0) / 255,
      b: (parts[2] || 0) / 255,
    };
  }
  const o = asJsonObject(v);
  if (o) {
    return {
      r: (num(o.r, 0) || num(o.x, 0)) / 255,
      g: (num(o.g, 0) || num(o.y, 0)) / 255,
      b: (num(o.b, 0) || num(o.z, 0)) / 255,
    };
  }
  return { r: 1, g: 1, b: 1 };
}

function parseRangeNumber(v: unknown): ParticleRange<number> {
  const o = asJsonObject(v);
  return { min: num(o?.min, 0), max: num(o?.max, 0) };
}

function parseRangeVec3(v: unknown): ParticleRange<ParticleVec3> {
  const o = asJsonObject(v);
  return { min: parseVec3(o?.min), max: parseVec3(o?.max) };
}

function parseRangeColor(v: unknown): ParticleRange<ParticleColor> {
  const o = asJsonObject(v);
  return { min: parseColor01(o?.min), max: parseColor01(o?.max) };
}

/** Parse a particle system JSON value. Returns null on non-object input. */
export function parseParticleJson(json: unknown): SceneParticleData | null {
  const root = asJsonObject(json);
  if (!root) return null;

  const emitters = asJsonArray(root.emitter).map((e) => ({
    name: typeof e.name === 'string' ? e.name : 'sphererandom',
    rate: num(e.rate, 1),
    origin: parseVec3(e.origin),
    directions: parseVec3(e.directions),
    distanceMin: num(e.distancemin, 0),
    distanceMax: num(e.distancemax, 0),
  }));

  // Collapse all initializer entries into per-dimension ranges; entries that
  // don't match a known initializer name are ignored.
  const init: ParticleInitializers = {
    lifetime: { min: 1, max: 5 },
    size: { min: 1, max: 1 },
    velocity: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    color: { min: { r: 1, g: 1, b: 1 }, max: { r: 1, g: 1, b: 1 } },
    rotation: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    angularVelocity: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
  };
  for (const e of asJsonArray(root.initializer)) {
    const name = typeof e.name === 'string' ? e.name : '';
    if (name === 'lifetimerandom') init.lifetime = parseRangeNumber(e);
    else if (name === 'sizerandom') init.size = parseRangeNumber(e);
    else if (name === 'velocityrandom') init.velocity = parseRangeVec3(e);
    else if (name === 'colorrandom') init.color = parseRangeColor(e);
    else if (name === 'rotationrandom') init.rotation = parseRangeVec3(e);
    else if (name === 'angularvelocityrandom') init.angularVelocity = parseRangeVec3(e);
  }

  const operators = asJsonArray(root.operator).map((o) => ({
    name: typeof o.name === 'string' ? o.name : '',
    gravity: parseVec3(o.gravity),
    drag: num(o.drag, 0),
    fadeInTime: num(o.fadeintime, 0),
    force: parseVec3(o.force),
  }));

  const renderer = asJsonArray(root.renderer)
    .map((r) => r.name)
    .filter((n): n is string => typeof n === 'string');

  return {
    material: typeof root.material === 'string' ? root.material : null,
    maxCount: num(root.maxcount, 1000),
    startTime: num(root.starttime, 0),
    emitters,
    initializers: init,
    operators,
    renderer,
  };
}

/**
 * Find the first operator by name (e.g. 'movement', 'alphafade'). Used by the
 * renderer to pick the gravity/fade settings for the 2D simulation.
 */
export function findParticleOperator(
  data: SceneParticleData,
  name: string,
): ParticleOperator | null {
  for (const op of data.operators) {
    if (op.name === name) return op;
  }
  return null;
}
