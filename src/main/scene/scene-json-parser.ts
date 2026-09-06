// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene JSON Parser
 *
 * Parses Wallpaper Engine's `scene.json` into typed structures. This module
 * is standalone — it has no dependency on the PKG container or TEX texture
 * parsers, so it can be unit-tested with plain JSON fixtures and reused if
 * scene.json is ever loaded outside the PKG container.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 *
 * Wallpaper Engine's scene.json has three top-level keys:
 *   - `general`: ~33 fields covering rendering, camera, lighting, bloom, wind
 *   - `objects`: array of layer/particle/text/sound objects (~47 possible fields each)
 *   - `camera`: { center, eye, up } — all space-separated string vectors
 *   - `version` (optional): scene format version number
 *
 * Many general fields and some object fields can be "animated properties" —
 * either a plain scalar or `{ script, value, user? }` for audio/time-of-day
 * reactivity. We normalize these to the scalar `.value` via {@link unwrapNumber}.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Camera definition. All fields are WE space-separated string vectors. */
export interface SceneCamera {
  center: { x: number; y: number; z: number };
  eye: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
}

/**
 * Wallpaper Engine "animated property" — a value that can be either a plain
 * number/boolean or a `{ script, value, user? }` object when audio-reactive
 * or time-of-day driven. We normalize to the scalar value for the `.value`
 * field and preserve the script string separately.
 */
export interface AnimatedProperty<T> {
  value: T;
  script: string | null;
  /** WE "user" tag — names the user-exposed property for the UI. */
  userTag: string | null;
}

/** A 3-component color string like "0.3 0.3 0.3" → { r, g, b }. */
export interface SceneColor {
  r: number;
  g: number;
  b: number;
}

/** A 2-component vector string like "1.0 1.0" → { x, y }. */
export interface SceneVec2 {
  x: number;
  y: number;
}

/** A structured scene effect pass (from object.effects[].passes[]). */
export interface SceneEffectPass {
  id: number;
  combos: Record<string, number>;
  constantShaderValues: Record<string, unknown>;
  textures: (string | null)[];
}

/** A structured scene effect (from object.effects[]). */
export interface SceneEffect {
  id: number;
  name: string;
  file: string;
  visible: boolean | AnimatedProperty<boolean>;
  passes: SceneEffectPass[];
}

/** Instance override for particle/light objects. */
export interface SceneInstanceOverride {
  id: number;
  [key: string]: unknown;
}

/**
 * A scene object. Wallpaper Engine scene.json objects have ~47 possible
 * fields depending on the object type (image layer, particle, text, sound).
 * Only `id` and `name` are guaranteed; all others are optional.
 */
export interface SceneObject {
  id: number;
  name: string;
  origin: { x: number; y: number; z: number };
  angles: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  alignment: string | null;
  image: string | null;
  visible: boolean;
  alpha: number;
  color: { r: number; g: number; b: number } | null;
  parallaxDepth: number | null;
  parent: number | null;
  effects: SceneEffect[];
  solid: boolean;
  // --- Fields previously missing ---
  colorBlendMode: number | null;
  copyBackground: boolean;
  lockTransforms: boolean;
  perspective: boolean;
  castShadow: boolean;
  depthTest: boolean;
  anchor: { x: number; y: number; z: number } | null;
  brightness: number | null;
  backgroundBrightness: number | null;
  backgroundColor: SceneColor | null;
  opaqueBackground: boolean;
  padding: number | null;
  // Particle system
  particle: string | null;
  // Sound
  sound: string | null;
  volume: number | null;
  startSilent: boolean;
  muteInEditor: boolean;
  playbackMode: string | null;
  // Text
  text: string | null;
  font: string | null;
  pointSize: number | null;
  horizontalAlign: string | null;
  verticalAlign: string | null;
  maxRows: number | null;
  maxWidth: number | null;
  limitRows: boolean;
  limitWidth: boolean;
  limitUseEllipsis: boolean;
  blockAlign: boolean;
  // Animation
  animationLayers: unknown[];
  // Timing
  minTime: number | null;
  maxTime: number | null;
  // Instance override (for particles/lights)
  instanceOverride: SceneInstanceOverride | null;
  // Audio reactivity
  audioResponsive: boolean;
  /** Audio frequency band: 0 = bass, 1 = mid, 2 = treble; null = unset. */
  audioBand: number | null;
  /** Audio reactivity gain multiplier (1 = default). */
  audioGain: number;
  // LED source (for LED-compatible wallpapers)
  ledSource: boolean;
  // Config (arbitrary object for custom properties)
  config: Record<string, unknown> | null;
}

/**
 * Scene general settings. Wallpaper Engine's general object has ~33 fields
 * covering rendering, camera, lighting, and physics. All fields except
 * `clearColor`, `clearEnabled`, and `orthogonalProjection` are optional.
 */
export interface SceneGeneral {
  // Rendering
  clearColor: SceneColor;
  clearEnabled: boolean;
  orthogonalProjection: { width: number; height: number };
  hdr: boolean;
  // Camera
  fov: number;
  nearZ: number;
  farZ: number;
  zoom: number;
  perspectiveOverrideFov: number | null;
  cameraFade: boolean;
  cameraParallax: boolean;
  cameraParallaxAmount: number;
  cameraParallaxDelay: number;
  cameraParallaxMouseInfluence: number;
  cameraPreview: boolean;
  cameraShake: boolean;
  cameraShakeAmplitude: number;
  cameraShakeRoughness: number;
  cameraShakeSpeed: number;
  // Lighting
  ambientColor: SceneColor;
  skylightColor: SceneColor;
  // Bloom
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomTint: SceneColor;
  bloomHdrStrength: number | null;
  bloomHdrThreshold: number | null;
  bloomHdrScatter: number | null;
  bloomHdrFeather: number | null;
  bloomHdrIterations: number | null;
  // Wind
  windEnabled: boolean;
  windStrength: number;
  windDirection: SceneVec2;
  windTurbulence: number;
  // Gravity
  gravityStrength: number;
  gravityDirection: { x: number; y: number; z: number };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Opaque JSON record type used by parseSceneJson and its helpers.
 * Wallpaper Engine scene.json is semi-structured and has ~47 optional
 * fields depending on the object type; keeping the boundary at `unknown`
 * + a local structural narrowing helper lets each helper read exactly the
 * fields it needs without importing a giant schema.
 */
type JsonObject = { readonly [key: string]: unknown };

/**
 * Narrow an `unknown` JSON value to a plain object (record).
 * Returns `null` if the input is null/undefined or not a plain object
 * (arrays, numbers, strings, etc.).
 */
function asJsonObject(v: unknown): JsonObject | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as JsonObject;
  return null;
}

/**
 * Narrow an `unknown` JSON value to an array.  Returns `[]` if the value
 * is not actually an array — preserves the previous `json.field || []`
 * behavior for malformed wallpapers while still keeping the strict type.
 */
function asJsonArray<T>(v: unknown, guard: (elem: unknown) => elem is T): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter(guard);
}

/**
 * Parse a scene.json object (already JSON-parsed) into typed structures.
 * Exported separately so it can be unit-tested without a real .pkg file, and
 * reused if scene.json is ever loaded outside the PKG container.
 */
/** Extracts {width,height} from the raw orthogonalProjection JSON or falls back. */
function parseOrthogonalProjection(v: unknown): { width: number; height: number } {
  const o = asJsonObject(v);
  if (!o) return { width: 1920, height: 1080 };
  const w = typeof o.width === 'number' ? o.width : 1920;
  const h = typeof o.height === 'number' ? o.height : 1080;
  return { width: w, height: h };
}

/** Extracts a SceneInstanceOverride from the raw instanceoverride JSON blob. */
function parseInstanceOverride(v: unknown): SceneInstanceOverride | null {
  const o = asJsonObject(v);
  if (!o) return null;
  const id = typeof o.id === 'number' ? o.id : 0;
  return { id, ...o } as SceneInstanceOverride;
}

/** Extracts a WE "animated boolean" or falls back to defaultVal. */
function parseAnimatedBoolean(
  v: unknown,
  defaultVal: boolean,
): boolean | AnimatedProperty<boolean> {
  if (typeof v === 'boolean') return v;
  const o = asJsonObject(v);
  if (!o) return defaultVal;
  const value = o.value !== false;
  const script = typeof o.script === 'string' ? o.script : null;
  const userTag = typeof o.user === 'string' ? o.user : null;
  return { value, script, userTag };
}

export function parseSceneJson(json: unknown): {
  general: SceneGeneral;
  camera: SceneCamera;
  objects: SceneObject[];
  version: number | null;
} {
  const root = asJsonObject(json) ?? {};
  const g = asJsonObject(root.general) ?? {};
  const general: SceneGeneral = {
    // Rendering
    clearColor: parseColor3(g.clearcolor ?? g.clearColor) ?? { r: 0, g: 0, b: 0 },
    clearEnabled: unwrapBoolean(g.clearenabled ?? g.clearEnabled, true),
    orthogonalProjection: parseOrthogonalProjection(
      g.orthogonalprojection ?? g.orthogonalProjection,
    ),
    hdr: unwrapBoolean(g.hdr, false),
    // Camera
    fov: unwrapNumber(g.fov, 50),
    nearZ: unwrapNumber(g.nearz ?? g.nearZ, 0.01),
    farZ: unwrapNumber(g.farz ?? g.farZ, 10000),
    zoom: unwrapNumber(g.zoom, 1),
    perspectiveOverrideFov:
      g.perspectiveoverridefov != null ? unwrapNumber(g.perspectiveoverridefov, null) : null,
    cameraFade: unwrapBoolean(g.camerafade, false),
    cameraParallax: unwrapBoolean(g.cameraparallax, false),
    cameraParallaxAmount: unwrapNumber(g.cameraparallaxamount ?? g.cameraParallaxAmount, 0),
    cameraParallaxDelay: unwrapNumber(g.cameraparallaxdelay ?? g.cameraParallaxDelay, 0),
    cameraParallaxMouseInfluence: unwrapNumber(g.cameraparallaxmouseinfluence, 0),
    cameraPreview: unwrapBoolean(g.camerapreview, false),
    cameraShake: unwrapBoolean(g.camerashake, false),
    cameraShakeAmplitude: unwrapNumber(g.camerashakeamplitude, 0.5),
    cameraShakeRoughness: unwrapNumber(g.camerashakeroughness, 1),
    cameraShakeSpeed: unwrapNumber(g.camerashakespeed, 3),
    // Lighting
    ambientColor: parseColor3(g.ambientcolor) ?? { r: 0.3, g: 0.3, b: 0.3 },
    skylightColor: parseColor3(g.skylightcolor) ?? { r: 0.3, g: 0.3, b: 0.3 },
    // Bloom
    bloom: unwrapBoolean(g.bloom, false),
    bloomStrength: unwrapNumber(g.bloomstrength, 1),
    bloomThreshold: unwrapNumber(g.bloomthreshold, 0.65),
    bloomTint: parseColor3(g.bloomtint) ?? { r: 1, g: 1, b: 1 },
    bloomHdrStrength: g.bloomhdrstrength != null ? unwrapNumber(g.bloomhdrstrength, null) : null,
    bloomHdrThreshold: g.bloomhdrthreshold != null ? unwrapNumber(g.bloomhdrthreshold, null) : null,
    bloomHdrScatter: g.bloomhdrscatter != null ? unwrapNumber(g.bloomhdrscatter, null) : null,
    bloomHdrFeather: g.bloomhdrfeather != null ? unwrapNumber(g.bloomhdrfeather, null) : null,
    bloomHdrIterations:
      g.bloomhdriterations != null ? unwrapNumber(g.bloomhdriterations, null) : null,
    // Wind
    windEnabled: unwrapBoolean(g.windenabled, false),
    windStrength: unwrapNumber(g.windstrength, 1),
    windDirection: parseVec2(g.winddirection) ?? { x: 0, y: 0 },
    windTurbulence: unwrapNumber(g.windturbulence, 1),
    // Gravity
    gravityStrength: unwrapNumber(g.gravitystrength, 1),
    gravityDirection: parseVec3(g.gravitydirection, 0, { x: 0, y: -1, z: 0 }),
  };

  const cam = asJsonObject(root.camera) ?? {};
  const camera: SceneCamera = {
    center: parseVec3(cam.center, 0, { x: 0, y: 0, z: -1 }),
    eye: parseVec3(cam.eye, 0, { x: 0, y: 0, z: 0 }),
    up: parseVec3(cam.up, 0, { x: 0, y: 1, z: 0 }),
  };

  const objects: SceneObject[] = asJsonArray(
    root.objects,
    (elem): elem is JsonObject => !!asJsonObject(elem),
  ).map((o) => parseSceneObject(o));

  const version = typeof root.version === 'number' ? root.version : null;

  return { general, camera, objects, version };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Wallpaper Engine "animated property" — either a plain scalar or
 * `{ script, value, user? }`. Returns the scalar value.
 */
function unwrapNumber<T extends number | null>(v: unknown, defaultVal: T): T {
  if (v == null) return defaultVal;
  if (typeof v === 'number') return v as T;
  const obj = asJsonObject(v);
  if (obj && typeof obj.value === 'number') return obj.value as T;
  return defaultVal;
}

/** Boolean counterpart of {@link unwrapNumber}: animated boolean or plain. */
function unwrapBoolean(v: unknown, defaultVal: boolean): boolean {
  if (v == null) return defaultVal;
  if (typeof v === 'boolean') return v;
  const obj = asJsonObject(v);
  if (obj && typeof obj.value === 'boolean') return obj.value;
  return defaultVal;
}

/** Parse a 3-component color string "r g b" or object {r,g,b}. */
function parseColor3(v: unknown): SceneColor | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number);
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
  }
  const o = asJsonObject(v);
  if (o) {
    const r = typeof o.r === 'number' ? o.r : typeof o.x === 'number' ? o.x : 0;
    const g = typeof o.g === 'number' ? o.g : typeof o.y === 'number' ? o.y : 0;
    const b = typeof o.b === 'number' ? o.b : typeof o.z === 'number' ? o.z : 0;
    return { r, g, b };
  }
  return null;
}

/** Return `v` if it is a finite number, otherwise the fallback (default 0). */
function numOr(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Parse a 2-component vector string "x y" or object {x,y}. */
function parseVec2(v: unknown): SceneVec2 | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0 };
  }
  const o = asJsonObject(v);
  if (o) {
    return {
      x: numOr(o.x, 0),
      y: numOr(o.y, 0),
    };
  }
  return null;
}

function parseVec3(
  v: unknown,
  defaultVal = 0,
  defaultObj?: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (v == null) return defaultObj ?? { x: defaultVal, y: defaultVal, z: defaultVal };
  if (typeof v === 'number') return { x: v, y: v, z: v };
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, z: parts[2] || 0 };
  }
  const o = asJsonObject(v);
  if (o) {
    const x = typeof o.x === 'number' ? o.x : defaultVal;
    const y = typeof o.y === 'number' ? o.y : defaultVal;
    const z = typeof o.z === 'number' ? o.z : defaultVal;
    return { x, y, z };
  }
  return defaultObj ?? { x: defaultVal, y: defaultVal, z: defaultVal };
}

function parseParallaxDepth(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  const o = asJsonObject(v);
  if (o) {
    // Some wallpapers use {x, y, z} — take z as depth
    if (typeof o.z === 'number') return o.z;
    if (typeof o.x === 'number') return o.x;
  }
  return null;
}

/** Parse a single scene object from raw JSON. */
function parseSceneObject(o: JsonObject): SceneObject {
  return {
    id: typeof o.id === 'number' ? o.id : 0,
    name: typeof o.name === 'string' ? o.name : '',
    origin: parseVec3(o.origin, 0, { x: 0, y: 0, z: 0 }),
    angles: parseVec3(o.angles, 0, { x: 0, y: 0, z: 0 }),
    scale: parseVec3(o.scale, 1, { x: 1, y: 1, z: 1 }),
    size: parseVec3(o.size, 0, { x: 0, y: 0, z: 0 }),
    alignment: typeof o.alignment === 'string' ? o.alignment : null,
    image: typeof o.image === 'string' ? o.image : null,
    visible: o.visible !== false,
    alpha: typeof o.alpha === 'number' ? o.alpha : 1,
    color: o.color ? parseColor3(o.color) : null,
    parallaxDepth: parseParallaxDepth(o.parallaxDepth),
    parent: typeof o.parent === 'number' ? o.parent : null,
    effects: asJsonArray(o.effects, (elem): elem is JsonObject => !!asJsonObject(elem)).map(
      parseEffect,
    ),
    solid: !!o.solid,
    // --- Previously missing fields ---
    colorBlendMode: typeof o.colorBlendMode === 'number' ? o.colorBlendMode : null,
    copyBackground: !!o.copybackground,
    lockTransforms: !!o.locktransforms,
    perspective: !!o.perspective,
    castShadow: !!o.castshadow,
    depthTest: !!o.depthtest,
    anchor: o.anchor != null ? parseVec3(o.anchor, 0, { x: 0, y: 0, z: 0 }) : null,
    brightness: typeof o.brightness === 'number' ? o.brightness : null,
    backgroundBrightness:
      typeof o.backgroundbrightness === 'number' ? o.backgroundbrightness : null,
    backgroundColor: o.backgroundcolor ? parseColor3(o.backgroundcolor) : null,
    opaqueBackground: !!o.opaquebackground,
    padding: typeof o.padding === 'number' ? o.padding : null,
    // Particle
    particle: typeof o.particle === 'string' ? o.particle : null,
    // Sound
    sound: typeof o.sound === 'string' ? o.sound : null,
    volume: typeof o.volume === 'number' ? o.volume : null,
    startSilent: !!o.startsilent,
    muteInEditor: !!o.muteineditor,
    playbackMode: typeof o.playbackmode === 'string' ? o.playbackmode : null,
    // Text
    text: typeof o.text === 'string' ? o.text : null,
    font: typeof o.font === 'string' ? o.font : null,
    pointSize: typeof o.pointsize === 'number' ? o.pointsize : null,
    horizontalAlign: typeof o.horizontalalign === 'string' ? o.horizontalalign : null,
    verticalAlign: typeof o.verticalalign === 'string' ? o.verticalalign : null,
    maxRows: typeof o.maxrows === 'number' ? o.maxrows : null,
    maxWidth: typeof o.maxwidth === 'number' ? o.maxwidth : null,
    limitRows: !!o.limitrows,
    limitWidth: !!o.limitwidth,
    limitUseEllipsis: !!o.limituseellipsis,
    blockAlign: !!o.blockalign,
    // Animation
    animationLayers: Array.isArray(o.animationlayers) ? o.animationlayers : [],
    // Timing
    minTime: typeof o.mintime === 'number' ? o.mintime : null,
    maxTime: typeof o.maxtime === 'number' ? o.maxtime : null,
    // Instance override
    instanceOverride: parseInstanceOverride(o.instanceoverride),
    // Audio reactivity
    audioResponsive: !!o.audioreactive,
    audioBand: typeof o.audioband === 'number' ? o.audioband : null,
    audioGain: typeof o.audiogain === 'number' ? o.audiogain : 1,
    // LED
    ledSource: !!o.ledsource,
    // Config
    config: asJsonObject(o.config) ?? null,
  };
}

/** Parse a scene effect from raw JSON. */
function parseEffect(e: JsonObject): SceneEffect {
  const visible = e.visible;
  return {
    id: typeof e.id === 'number' ? e.id : 0,
    name: typeof e.name === 'string' ? e.name : '',
    file: typeof e.file === 'string' ? e.file : '',
    visible: parseAnimatedBoolean(visible, true),
    passes: asJsonArray(e.passes, (p): p is JsonObject => !!asJsonObject(p)).map((p) => ({
      id: typeof p.id === 'number' ? p.id : 0,
      combos: asJsonObject(p.combos)
        ? (Object.fromEntries(
            Object.entries(asJsonObject(p.combos)!).filter(([, v]) => typeof v === 'number'),
          ) as Record<string, number>)
        : {},
      constantShaderValues: asJsonObject(p.constantshadervalues) ?? {},
      textures: Array.isArray(p.textures) ? (p.textures as (string | null)[]) : [],
    })),
  };
}
