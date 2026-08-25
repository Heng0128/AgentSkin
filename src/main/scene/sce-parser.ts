// SPDX-License-Identifier: MPL-2.0

/**
 * # SCE Parser
 *
 * Parses Sucrose Wallpaper Engine (SCE) projects into the unified
 * {@link SceneData} structure. SCE projects are directory-based and contain
 * a `project.json` describing particles, effects, and background.
 *
 * Sucrose format layout:
 *   - `project.json` — scene description (particles/effects/background)
 *   - `index.html`   — entry page
 *   - `assets/`      — resource directory
 *
 * The parser maps SCE concepts to Wallpaper Engine's SceneData model:
 *   - `background.color`    → `general.clearColor`
 *   - `background.image`    → background object + `textures` entry
 *   - `background.gradient` → background `config.gradient` array
 *   - `particles[]`         → `objects[]` (Scene Object with particle config)
 *   - `effects[]`           → background object `effects[]`
 *   - `{width, height}`     → `general.orthogonalProjection`
 *
 * ## Particle parameter mapping
 *
 * | SCE field            | SceneObject field             |
 * |----------------------|-------------------------------|
 * | `count`              | `config.rate`                 |
 * | `velocity`           | `config.velocityMin/Max`      |
 * | `size` (number)      | `config.sizeMin = size * 0.5` |
 * | `size` ({min,max})   | `config.sizeMin/Max`          |
 * | `color`              | `color` (hex→0-1 normalized)  |
 * | `texture`            | `image`                       |
 * | `emitter`            | `config.emitter`              |
 * | `alpha`              | `alpha`                       |
 * | `lifespan`           | `config.lifespan`             |
 * | `speed`              | `config.speed`                |
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneData, SceneTexture } from './scene-extractor';
import type {
  SceneCamera,
  SceneColor,
  SceneEffect,
  SceneGeneral,
  SceneObject,
} from './scene-json-parser';

// ---------------------------------------------------------------------------
// SCE JSON types
// ---------------------------------------------------------------------------

/** Supported SCE background types. */
export type SceBackgroundType = 'color' | 'image' | 'gradient';

/** SCE project.json structure. All fields optional — Sucrose wallpapers vary. */
export interface SceProjectJson {
  title?: string;
  author?: string;
  width?: number;
  height?: number;
  background?: SceBackground;
  particles?: SceParticleDef[];
  effects?: SceEffectDef[];
}

/** SCE background definition — one of color, image, or gradient. */
export interface SceBackground {
  type?: SceBackgroundType;
  /** For "type=color": hex string. */
  color?: string;
  /** For "type=image": relative path to image file. */
  image?: string;
  /** For "type=gradient": array of hex color stops. */
  value?: string[] | string;
  /** Gradient angle in degrees (0 = top-to-bottom). */
  angle?: number;
}

/** SCE emitter definition. */
export interface SceEmitter {
  shape?: 'box' | 'sphere' | 'point';
  width?: number;
  height?: number;
  radius?: number;
}

/** SCE particle definition. */
export interface SceParticleDef {
  /** Particle count (mapped to config.rate). */
  count?: number;
  /** Emission speed — either a scalar or a {x,y} vector. */
  speed?: number | { x: number; y: number };
  /** Particle size — either a uniform scalar or {min,max}. */
  size?: number | { min: number; max: number };
  /** Particle color as hex string. */
  color?: string;
  /** Relative path to particle sprite. */
  texture?: string;
  /** Emitter region definition. */
  emitter?: SceEmitter;
  /** Particle velocity — scalar or {x,y}. */
  velocity?: number | { x: number; y: number };
  /** Particle alpha (0-1). */
  alpha?: number;
  /** Particle lifespan in milliseconds. */
  lifespan?: number;
}

/** SCE effect definition. */
export interface SceEffectDef {
  type: 'bloom' | 'blur' | 'chromatic' | 'scanlines' | 'vignette' | 'noise' | 'colorgrade';
  /** Effect intensity/strength multiplier. */
  intensity?: number;
  /** Blur radius (for type=blur). */
  radius?: number;
  /** Effect tint color (hex string, for type=colorgrade). */
  tint?: string;
  /** Chromatic aberration offset (for type=chromatic). */
  offset?: number;
  /** Scanline density (for type=scanlines). */
  density?: number;
  /** Noise opacity (for type=noise). */
  opacity?: number;
  /** Vignette strength 0-1 (for type=vignette). */
  strength?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default camera — Sucrose scenes are 2D, so we use a flat orthographic setup. */
const DEFAULT_CAMERA: SceneCamera = {
  center: { x: 0, y: 0, z: -1 },
  eye: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

/** Default general settings for SCE — only the required fields are set. */
const DEFAULT_GENERAL_PICK: Pick<SceneGeneral, 'clearEnabled' | 'hdr'> = {
  clearEnabled: true,
  hdr: false,
};

// ---------------------------------------------------------------------------
// Color parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex color string (#rgb, #rrggbb) to a SceneColor {r, g, b}
 * in 0-1 range. Returns null when the string is not a valid hex color.
 */
function parseHexColor(hex: string): SceneColor | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const digits = m[1];
  if (digits.length === 3) {
    return {
      r: parseInt(digits[0] + digits[0], 16) / 255,
      g: parseInt(digits[1] + digits[1], 16) / 255,
      b: parseInt(digits[2] + digits[2], 16) / 255,
    };
  }
  return {
    r: parseInt(digits.slice(0, 2), 16) / 255,
    g: parseInt(digits.slice(2, 4), 16) / 255,
    b: parseInt(digits.slice(4, 6), 16) / 255,
  };
}

// ---------------------------------------------------------------------------
// Velocity / size normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a scalar or {x,y} vector to a {min, max} range.
 * Used for velocity fields.
 */
function normalizeRange(
  v: number | { x: number; y: number } | undefined,
  defaultVal: number,
): { min: number; max: number } {
  if (v == null) return { min: defaultVal, max: defaultVal };
  if (typeof v === 'number') return { min: v, max: v };
  return { min: Math.min(v.x, v.y), max: Math.max(v.x, v.y) };
}

/**
 * Normalize a scalar or {min,max} size definition to a {min, max} range.
 * When given a scalar, the min is half the value (particles vary ±50%).
 */
function normalizeSize(
  v: number | { min: number; max: number } | undefined,
  defaultVal: number,
): { min: number; max: number } {
  if (v == null) return { min: defaultVal, max: defaultVal };
  if (typeof v === 'number') return { min: v * 0.5, max: v };
  return { min: v.min, max: v.max };
}

// ---------------------------------------------------------------------------
// Object construction
// ---------------------------------------------------------------------------

/**
 * Build a SceneObject from a Sucrose particle definition.
 *
 * Maps SCE particle fields to SceneObject fields and stores raw parameters
 * in `config` for the renderer to consume. The particle system is represented
 * as a SceneObject with `config` holding the full SCE particle parameters.
 */
function buildParticleObject(
  def: SceParticleDef,
  index: number,
  sceneWidth: number,
  sceneHeight: number,
): SceneObject {
  const sizeRange = normalizeSize(def.size, 4);
  const velRange = normalizeRange(def.velocity, 0);
  const speedVal =
    typeof def.speed === 'number'
      ? def.speed
      : typeof def.speed === 'object'
        ? Math.hypot(def.speed.x, def.speed.y)
        : 0;

  // Compute emitter size — default to full scene dimensions
  const emitterWidth = def.emitter?.width ?? sceneWidth;
  const emitterHeight = def.emitter?.height ?? sceneHeight;

  const color = def.color ? parseHexColor(def.color) : null;

  return {
    id: index,
    name: `particle_${index}`,
    origin: { x: 0, y: 0, z: 0 },
    angles: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    size: { x: emitterWidth, y: emitterHeight, z: 0 },
    alignment: null,
    image: def.texture ?? null,
    visible: true,
    alpha: typeof def.alpha === 'number' ? def.alpha : 1,
    color,
    parallaxDepth: null,
    parent: null,
    effects: [],
    solid: false,
    colorBlendMode: null,
    copyBackground: false,
    lockTransforms: false,
    perspective: false,
    castShadow: false,
    depthTest: false,
    anchor: null,
    brightness: null,
    backgroundBrightness: null,
    backgroundColor: null,
    opaqueBackground: false,
    padding: null,
    particle: null,
    sound: null,
    volume: null,
    startSilent: false,
    muteInEditor: false,
    playbackMode: null,
    text: null,
    font: null,
    pointSize: null,
    horizontalAlign: null,
    verticalAlign: null,
    maxRows: null,
    maxWidth: null,
    limitRows: false,
    limitWidth: false,
    limitUseEllipsis: false,
    blockAlign: false,
    animationLayers: [],
    minTime: null,
    maxTime: null,
    instanceOverride: null,
    audioResponsive: false,
    audioBand: null,
    audioGain: 1,
    ledSource: false,
    config: {
      rate: def.count ?? 50,
      velocityMin: velRange.min,
      velocityMax: velRange.max,
      sizeMin: sizeRange.min,
      sizeMax: sizeRange.max,
      speed: speedVal,
      emitter: def.emitter ?? { shape: 'box', width: emitterWidth, height: emitterHeight },
      lifespan: typeof def.lifespan === 'number' ? def.lifespan : 5000,
      texture: def.texture ?? null,
    },
  };
}

/**
 * Build a SceneEffect from a Sucrose effect definition.
 * Maps SCE effect types to WE-style effect objects.
 */
function buildEffect(def: SceEffectDef, index: number): SceneEffect {
  const config: Record<string, unknown> = {
    type: def.type,
    intensity: def.intensity ?? 0.5,
  };

  // Add type-specific parameters
  switch (def.type) {
    case 'blur':
      config.radius = def.radius ?? 2;
      break;
    case 'bloom':
      config.intensity = def.intensity ?? 0.5;
      break;
    case 'chromatic':
      config.offset = def.offset ?? 2;
      break;
    case 'scanlines':
      config.density = def.density ?? 100;
      break;
    case 'vignette':
      config.strength = def.strength ?? 0.3;
      break;
    case 'noise':
      config.opacity = def.opacity ?? 0.1;
      break;
    case 'colorgrade':
      config.tint = def.tint ?? '#ffffff';
      break;
  }

  return {
    id: index,
    name: def.type,
    file: '',
    visible: true,
    passes: [
      {
        id: 0,
        combos: {},
        constantShaderValues: config,
        textures: [],
      },
    ],
  };
}

/**
 * Build the background SceneObject that holds background settings and effects.
 * This object represents the scene's background layer in the object hierarchy.
 */
function buildBackgroundObject(
  bg: SceBackground | undefined,
  effects: SceneEffect[],
  index: number,
): SceneObject {
  const config: Record<string, unknown> = {};

  if (bg) {
    config.backgroundType = bg.type ?? 'color';
    if (bg.type === 'gradient' && Array.isArray(bg.value)) {
      config.gradient = {
        stops: bg.value,
        angle: bg.angle ?? 0,
      };
    }
    if (bg.type === 'image') {
      config.backgroundImage = bg.image ?? bg.value ?? null;
    }
    if (bg.type === 'color') {
      config.backgroundColor = bg.color ?? bg.value ?? '#000000';
    }
  }

  return {
    id: index,
    name: 'background',
    origin: { x: 0, y: 0, z: 0 },
    angles: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    size: { x: 1920, y: 1080, z: 0 },
    alignment: null,
    image: bg?.type === 'image' ? (bg.image ?? null) : null,
    visible: true,
    alpha: 1,
    color: null,
    parallaxDepth: null,
    parent: null,
    effects,
    solid: true,
    colorBlendMode: null,
    copyBackground: false,
    lockTransforms: false,
    perspective: false,
    castShadow: false,
    depthTest: false,
    anchor: null,
    brightness: null,
    backgroundBrightness: null,
    backgroundColor: null,
    opaqueBackground: false,
    padding: null,
    particle: null,
    sound: null,
    volume: null,
    startSilent: false,
    muteInEditor: false,
    playbackMode: null,
    text: null,
    font: null,
    pointSize: null,
    horizontalAlign: null,
    verticalAlign: null,
    maxRows: null,
    maxWidth: null,
    limitRows: false,
    limitWidth: false,
    limitUseEllipsis: false,
    blockAlign: false,
    animationLayers: [],
    minTime: null,
    maxTime: null,
    instanceOverride: null,
    audioResponsive: false,
    audioBand: null,
    audioGain: 1,
    ledSource: false,
    config: Object.keys(config).length > 0 ? config : null,
  };
}

// ---------------------------------------------------------------------------
// MIME type inference
// ---------------------------------------------------------------------------

/** Map a file extension to its MIME type, defaulting to image/png. */
function mimeFromExt(ext: string): string {
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect whether a directory contains an SCE project (has project.json). */
export async function isSceProject(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, 'project.json'));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Parse an SCE project directory into SceneData.
 * Returns null when project.json is missing or malformed.
 *
 * Enhanced parsing:
 *   - Full background support (color/image/gradient)
 *   - Complete particle parameter mapping (count, velocity, size, color, alpha, lifespan, emitter)
 *   - Effects array mapped to SceneEffect[] on the background object
 *   - Particle textures loaded into the textures map
 */
export async function parseSce(dir: string): Promise<SceneData | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, 'project.json'), 'utf8');
  } catch {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const proj = json as SceProjectJson;

  // --- dimensions ---
  const sceneWidth = typeof proj.width === 'number' ? proj.width : 1920;
  const sceneHeight = typeof proj.height === 'number' ? proj.height : 1080;

  // --- general ---
  const bgColor =
    proj.background?.type === 'color'
      ? parseHexColor(
          proj.background.color ??
            (typeof proj.background.value === 'string' ? proj.background.value : '') ??
            '',
        )
      : null;
  const general: SceneGeneral = {
    clearColor: bgColor ?? { r: 0, g: 0, b: 0 },
    ...DEFAULT_GENERAL_PICK,
    orthogonalProjection: { width: sceneWidth, height: sceneHeight },
    fov: 50,
    nearZ: 0.01,
    farZ: 10000,
    zoom: 1,
    perspectiveOverrideFov: null,
    cameraFade: false,
    cameraParallax: false,
    cameraParallaxAmount: 0,
    cameraParallaxDelay: 0,
    cameraParallaxMouseInfluence: 0,
    cameraPreview: false,
    cameraShake: false,
    cameraShakeAmplitude: 0.5,
    cameraShakeRoughness: 1,
    cameraShakeSpeed: 3,
    ambientColor: { r: 0.3, g: 0.3, b: 0.3 },
    skylightColor: { r: 0.3, g: 0.3, b: 0.3 },
    bloom: false,
    bloomStrength: 1,
    bloomThreshold: 0.65,
    bloomTint: { r: 1, g: 1, b: 1 },
    bloomHdrStrength: null,
    bloomHdrThreshold: null,
    bloomHdrScatter: null,
    bloomHdrFeather: null,
    bloomHdrIterations: null,
    windEnabled: false,
    windStrength: 1,
    windDirection: { x: 0, y: 0 },
    windTurbulence: 1,
    gravityStrength: 1,
    gravityDirection: { x: 0, y: -1, z: 0 },
  };

  const camera: SceneCamera = DEFAULT_CAMERA;

  // --- effects: map SCE effects[] to SceneEffect[] ---
  const effects = (proj.effects ?? []).map((e, i) => buildEffect(e, i));

  // --- background object (id=0) ---
  const backgroundObject = buildBackgroundObject(proj.background, effects, 0);

  // --- objects: particles[] (id starts at 1) ---
  const particles = proj.particles ?? [];
  const particleObjects: SceneObject[] = particles.map((p, i) =>
    buildParticleObject(p, i + 1, sceneWidth, sceneHeight),
  );

  // --- combine objects: background first, then particles ---
  const objects: SceneObject[] = [backgroundObject, ...particleObjects];

  // --- textures: background.image + particle textures ---
  const textures = new Map<string, SceneTexture>();

  // Background image texture
  if (proj.background?.type === 'image' && proj.background.image) {
    const imagePath = proj.background.image;
    const absPath = path.resolve(dir, imagePath);
    let dataUrl: string | null = null;
    let texWidth = 0;
    let texHeight = 0;
    try {
      const buf = await fs.readFile(absPath);
      const mime = mimeFromExt(path.extname(imagePath).toLowerCase());
      dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      // Width/height are unknown without decoding — renderer will use natural size
      texWidth = 0;
      texHeight = 0;
    } catch {
      // Asset missing — store without dataUrl (renderer shows blank)
    }
    const key = imagePath.replace(/\\/g, '/').toLowerCase();
    textures.set(key, {
      name: imagePath,
      dataUrl,
      frames: null,
      width: texWidth,
      height: texHeight,
    });
  }

  // Particle textures
  for (const p of particles) {
    if (!p.texture) continue;
    const texPath = p.texture;
    const absPath = path.resolve(dir, texPath);
    let dataUrl: string | null = null;
    const texWidth = 0;
    const texHeight = 0;
    try {
      const buf = await fs.readFile(absPath);
      const mime = mimeFromExt(path.extname(texPath).toLowerCase());
      dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // Asset missing — skip
    }
    const key = texPath.replace(/\\/g, '/').toLowerCase();
    if (!textures.has(key)) {
      textures.set(key, {
        name: texPath,
        dataUrl,
        frames: null,
        width: texWidth,
        height: texHeight,
      });
    }
  }

  return {
    general,
    camera,
    objects,
    textures,
    models: new Map(),
    materials: new Map(),
    particleJsons: new Map(),
    version: null,
  };
}

/**
 * Extract SCE metadata (title/author) without parsing the full scene.
 * Fast path for directory listings and workshop browsers.
 */
export async function parseSceMetadata(
  dir: string,
): Promise<{ title?: string; author?: string } | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'project.json'), 'utf8');
    const json = JSON.parse(raw) as SceProjectJson;
    return {
      title: json.title,
      author: json.author,
    };
  } catch {
    return null;
  }
}
