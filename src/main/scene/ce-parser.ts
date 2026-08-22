// SPDX-License-Identifier: MPL-2.0

/**
 * # CE Parser
 *
 * Parses Cyclone Engine (CE) projects into the unified {@link SceneData}
 * structure. CE is a binary scene format with limited public documentation.
 *
 * CE `scene.dat` layout (little-endian):
 *   - Offset 0x00: Magic bytes (0xCE, 0x01)
 *   - Offset 0x02: Width (uint16)
 *   - Offset 0x04: Height (uint16)
 *   - Offset 0x06: Background color type (uint8, 0=none, 1=solid, 2=embedded)
 *   - Offset 0x07: Background R (uint8)
 *   - Offset 0x08: Background G (uint8)
 *   - Offset 0x09: Background B (uint8)
 *   - Offset 0x0A: Flags (uint8) — bit 0: has embedded preview
 *   - Offset 0x0B: Preview image length (uint32), 0 if none
 *   - Offset 0x0F: Preview image data (if present, typically PNG)
 *   - Remaining: Layer/object table (future parsing)
 *
 * First version scope:
 *   - Parse file header for scene dimensions and background color
 *   - Extract embedded preview image (if present)
 *   - Build SceneData with proper clearColor and preview texture
 *
 * The renderer detects `objects.length === 0` and degrades to a fullscreen
 * preview image display — so a minimal SceneData is sufficient for listing
 * and preview purposes until full binary parsing is implemented.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BinaryReader } from './binary-reader';
import type { SceneData, SceneTexture } from './scene-extractor';
import type { SceneCamera, SceneColor, SceneGeneral } from './scene-json-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cyclone Engine magic bytes — first two bytes of scene.dat. */
const CE_MAGIC_0 = 0xce;
const CE_MAGIC_1 = 0x01;

/** Minimum header size: magic (2) + width/height (4) + bg type+rgb (4) + flags (1) + preview len (4) = 15 bytes. */
const CE_MIN_HEADER_SIZE = 15;

/** Default filename for CE scene data within a project directory. */
const CE_SCENE_FILE = 'scene.dat';

/** Optional metadata filename. */
const CE_META_FILE = 'meta.json';

// ---------------------------------------------------------------------------
// CE binary header type
// ---------------------------------------------------------------------------

/** Parsed CE scene.dat header. */
interface CeHeader {
  width: number;
  height: number;
  bgType: number;
  bgColor: SceneColor;
  hasPreview: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Flat orthographic camera — CE scenes that lack camera data use this. */
const DEFAULT_CAMERA: SceneCamera = {
  center: { x: 0, y: 0, z: -1 },
  eye: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

// ---------------------------------------------------------------------------
// General settings builder
// ---------------------------------------------------------------------------

/**
 * Build SceneGeneral with the given dimensions and background color.
 * Fills in CE-appropriate defaults for all other fields.
 */
function makeGeneral(width: number, height: number, bgColor: SceneColor): SceneGeneral {
  return {
    clearColor: bgColor,
    clearEnabled: true,
    orthogonalProjection: { width, height },
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

// ---------------------------------------------------------------------------
// Binary header parsing
// ---------------------------------------------------------------------------

/**
 * Parse the CE scene.dat header using BinaryReader.
 * Returns null if the header is malformed or truncated.
 *
 * Uses BinaryReader's public API (seek/readBytes) to stay encapsulated.
 */
function parseCeHeader(reader: BinaryReader): CeHeader | null {
  try {
    // --- magic bytes (2 bytes) ---
    if (reader.remaining < 2) return null;
    const magicBytes = reader.readBytes(2);
    if (magicBytes[0] !== CE_MAGIC_0 || magicBytes[1] !== CE_MAGIC_1) return null;

    // --- width / height (uint16 LE each = 4 bytes) ---
    if (reader.remaining < 4) return null;
    const wh = reader.readBytes(4);
    const width = wh.readUInt16LE(0);
    const height = wh.readUInt16LE(2);

    // --- background color: type (1) + RGB (3) = 4 bytes ---
    if (reader.remaining < 4) return null;
    const bg = reader.readBytes(4);
    const bgType = bg[0];
    const bgR = bg[1];
    const bgG = bg[2];
    const bgB = bg[3];

    // --- flags byte (1 byte) ---
    if (reader.remaining < 1) return null;
    const flagsByte = reader.readBytes(1);
    const flags = flagsByte[0];
    const hasPreview = (flags & 1) !== 0;

    const bgColor: SceneColor = {
      r: bgR / 255,
      g: bgG / 255,
      b: bgB / 255,
    };

    return {
      width: width > 0 ? width : 1920,
      height: height > 0 ? height : 1080,
      bgType,
      bgColor,
      hasPreview,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the embedded preview image from CE scene.dat after the header.
 * Returns a SceneTexture with the preview as a data URL, or null.
 */
function extractPreviewImage(reader: BinaryReader, hasPreview: boolean): SceneTexture | null {
  if (!hasPreview) return null;
  try {
    // --- preview length (uint32 LE, 4 bytes) ---
    if (reader.remaining < 4) return null;
    const lenBytes = reader.readBytes(4);
    const previewLen = lenBytes.readUInt32LE(0);

    if (previewLen === 0 || previewLen > reader.remaining) return null;

    // --- preview data ---
    const previewData = reader.readBytes(previewLen);

    // Detect image type from magic bytes
    let mime = 'image/png';
    if (
      previewData.length >= 3 &&
      previewData[0] === 0xff &&
      previewData[1] === 0xd8 &&
      previewData[2] === 0xff
    ) {
      mime = 'image/jpeg';
    } else if (
      previewData.length >= 4 &&
      previewData[0] === 0x47 &&
      previewData[1] === 0x49 &&
      previewData[2] === 0x46
    ) {
      mime = 'image/gif';
    } else if (previewData.length >= 4 && previewData[0] === 0x52 && previewData[1] === 0x49) {
      mime = 'image/webp';
    }

    const dataUrl = `data:${mime};base64,${previewData.toString('base64')}`;

    return {
      name: 'preview',
      dataUrl,
      frames: null,
      width: 0,
      height: 0,
    };
  } catch {
    return null;
  }
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
    return buf.length >= 2 && buf[0] === CE_MAGIC_0 && buf[1] === CE_MAGIC_1;
  } catch {
    return false;
  }
}

/**
 * Parse a CE project directory.
 *
 * Enhanced first version:
 *   - Parses scene.dat header for dimensions and background color
 *   - Extracts embedded preview image into textures map
 *   - Returns SceneData with proper clearColor and preview
 *
 * Future versions will parse the binary layer/object table for full
 * scene reconstruction.
 */
export async function parseCe(dir: string): Promise<SceneData | null> {
  try {
    const filePath = path.join(dir, CE_SCENE_FILE);
    const buf = await fs.readFile(filePath);

    if (buf.length < CE_MIN_HEADER_SIZE) {
      return makeMinimalSceneData();
    }

    const reader = new BinaryReader(buf);
    const header = parseCeHeader(reader);

    if (!header) {
      // Fallback: magic ok but header parse failed — still return minimal
      return makeMinimalSceneData();
    }

    // --- build general with parsed dimensions and bg color ---
    const general = makeGeneral(header.width, header.height, header.bgColor);
    const camera: SceneCamera = DEFAULT_CAMERA;

    // --- extract preview image ---
    const textures = new Map<string, SceneTexture>();
    if (header.hasPreview) {
      const previewTex = extractPreviewImage(reader, true);
      if (previewTex) {
        textures.set('preview', previewTex);
      }
    }

    return {
      general,
      camera,
      objects: [],
      textures,
      models: new Map(),
      materials: new Map(),
      particleJsons: new Map(),
      version: null,
    };
  } catch {
    return makeMinimalSceneData();
  }
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

// ---------------------------------------------------------------------------
// Legacy minimal fallback
// ---------------------------------------------------------------------------

/**
 * Minimal legal SceneData — empty scene, renderer shows preview instead.
 * Kept as a fallback when binary parsing fails.
 */
function makeMinimalSceneData(): SceneData {
  return {
    general: makeGeneral(1920, 1080, { r: 0, g: 0, b: 0 }),
    camera: DEFAULT_CAMERA,
    objects: [],
    textures: new Map(),
    models: new Map(),
    materials: new Map(),
    particleJsons: new Map(),
    version: null,
  };
}
