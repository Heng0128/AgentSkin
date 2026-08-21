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
 *   - `background.image`    → `textures` entry (as SceneTexture)
 *   - `particles[]`         → `objects[]` (as SceneObject with particle ref)
 *   - `{width, height}`     → `general.orthogonalProjection`
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneData, SceneTexture } from './scene-extractor';
import type { SceneCamera, SceneColor, SceneGeneral, SceneObject } from './scene-json-parser';

// ---------------------------------------------------------------------------
// SCE JSON types
// ---------------------------------------------------------------------------

/** SCE project.json structure. All fields optional — Sucrose wallpapers vary. */
export interface SceProjectJson {
  title?: string;
  author?: string;
  width?: number;
  height?: number;
  background?: { color?: string; image?: string };
  particles?: SceParticleDef[];
  effects?: SceEffectDef[];
}

export interface SceParticleDef {
  count?: number;
  speed?: number | { x: number; y: number };
  size?: number | { min: number; max: number };
  color?: string;
  emitter?: { shape?: 'box' | 'sphere'; width?: number; height?: number };
}

export interface SceEffectDef {
  type?: string;
  intensity?: number;
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
// Object construction
// ---------------------------------------------------------------------------

/**
 * Build a minimal SceneObject from a Sucrose particle definition.
 * Sucrose particles map to WE "particle" objects — the renderer will draw
 * them as a particle system using the count/size/speed fields.
 */
function buildParticleObject(def: SceParticleDef, index: number): SceneObject {
  const size = typeof def.size === 'number' ? def.size : (def.size?.max ?? 4);
  return {
    id: index,
    name: `particle_${index}`,
    origin: { x: 0, y: 0, z: 0 },
    angles: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    size: { x: size, y: size, z: 0 },
    alignment: null,
    image: null,
    visible: true,
    alpha: 1,
    color: def.color ? parseHexColor(def.color) : null,
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
    config: null,
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

  if (!json || typeof json !== 'object') return null;
  const proj = json as SceProjectJson;

  // --- general ---
  const bgColor = proj.background?.color ? parseHexColor(proj.background.color) : null;
  const general: SceneGeneral = {
    clearColor: bgColor ?? { r: 0, g: 0, b: 0 },
    ...DEFAULT_GENERAL_PICK,
    orthogonalProjection: {
      width: typeof proj.width === 'number' ? proj.width : 1920,
      height: typeof proj.height === 'number' ? proj.height : 1080,
    },
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

  // --- objects: particles[] ---
  const particles = proj.particles ?? [];
  const objects: SceneObject[] = particles.map((p, i) => buildParticleObject(p, i));

  // --- textures: background.image ---
  const textures = new Map<string, SceneTexture>();
  if (proj.background?.image) {
    const imagePath = proj.background.image;
    const absPath = path.resolve(dir, imagePath);
    let dataUrl: string | null = null;
    let texWidth = 0;
    let texHeight = 0;
    try {
      const buf = await fs.readFile(absPath);
      const mime = mimeFromExt(path.extname(imagePath).toLowerCase());
      dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
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
