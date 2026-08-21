// SPDX-License-Identifier: MPL-2.0

/**
 * # CE Parser
 *
 * Parses Cyclone Engine (CE) projects into the unified {@link SceneData}
 * structure. CE is a binary scene format with limited public documentation.
 *
 * First version scope:
 *   - Format detection via magic bytes (`0xCE 0x01`)
 *   - Minimal legal SceneData (black clearColor, empty objects)
 *   - Metadata fallback: `meta.json` → directory name
 *
 * The renderer detects `objects.length === 0` and degrades to a fullscreen
 * preview image display — so a minimal SceneData is sufficient for listing
 * and preview purposes until full binary parsing is implemented.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneData } from './scene-extractor';
import type { SceneCamera, SceneGeneral } from './scene-json-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cyclone Engine magic bytes — first two bytes of scene.dat. */
const CE_MAGIC = Buffer.from([0xce, 0x01]);

/** Default filename for CE scene data within a project directory. */
const CE_SCENE_FILE = 'scene.dat';

/** Optional metadata filename. */
const CE_META_FILE = 'meta.json';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Flat orthographic camera — CE scenes that lack camera data use this. */
const DEFAULT_CAMERA: SceneCamera = {
  center: { x: 0, y: 0, z: -1 },
  eye: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

/** Minimal general settings — the renderer fills in the rest. */
function makeMinimalGeneral(): SceneGeneral {
  return {
    clearColor: { r: 0, g: 0, b: 0 },
    clearEnabled: true,
    orthogonalProjection: { width: 1920, height: 1080 },
    hdr: false,
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
}

/** Minimal legal SceneData — empty scene, renderer shows preview instead. */
function makeMinimalSceneData(): SceneData {
  return {
    general: makeMinimalGeneral(),
    camera: DEFAULT_CAMERA,
    objects: [],
    textures: new Map(),
    models: new Map(),
    materials: new Map(),
    particleJsons: new Map(),
    version: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether a directory contains a CE project by checking for
 * `scene.dat` with the Cyclone Engine magic bytes.
 */
export async function isCeProject(dir: string): Promise<boolean> {
  try {
    const filePath = path.join(dir, CE_SCENE_FILE);
    const buf = await fs.readFile(filePath);
    return buf.length >= 2 && buf[0] === CE_MAGIC[0] && buf[1] === CE_MAGIC[1];
  } catch {
    return false;
  }
}

/**
 * Parse a CE project directory.
 *
 * First version returns a minimal legal SceneData. The renderer detects
 * `objects.length === 0` and degrades to fullscreen preview image display.
 * Future versions will parse the binary scene.dat header for resolution,
 * layer count, and embedded assets.
 */
export async function parseCe(_dir: string): Promise<SceneData | null> {
  return makeMinimalSceneData();
}

/**
 * Extract CE metadata. Tries `meta.json` first, then falls back to
 * deriving a title from the directory name.
 */
export async function parseCeMetadata(dir: string): Promise<{ title?: string } | null> {
  // 1. Try meta.json
  try {
    const raw = await fs.readFile(path.join(dir, CE_META_FILE), 'utf8');
    const json = JSON.parse(raw) as { title?: string };
    if (json.title) return { title: json.title };
  } catch {
    // not present or malformed — fall through
  }

  // 2. Fall back to directory name
  const baseName = path.basename(dir);
  if (baseName && baseName !== '.' && baseName !== '/') {
    return { title: baseName };
  }

  return null;
}
