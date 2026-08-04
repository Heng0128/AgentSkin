// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene Extractor
 *
 * Orchestrates the extraction of a complete scene from a Wallpaper Engine
 * `scene.pkg` file. Coordinates the PKG container parser, TEX texture parser,
 * and scene.json parser to produce a unified {@link SceneData} structure used
 * by the scene renderer.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 */

import type { PkgEntry } from './pkg-parser';
import { findEntry, parsePkg } from './pkg-parser';
import type { SceneCamera, SceneGeneral, SceneObject } from './scene-json-parser';
import { parseSceneJson } from './scene-json-parser';
import type { TexData } from './tex-parser';
import { parseTex, texToDataUrl } from './tex-parser';

// ---------------------------------------------------------------------------
// Types — scene asset structures (textures, models, materials)
// ---------------------------------------------------------------------------

export interface SceneTexture {
  name: string;
  dataUrl: string | null;
  width: number;
  height: number;
}

export interface SceneModel {
  material: string;
  solidLayer: boolean;
  passthrough: boolean;
}

export interface SceneMaterialPass {
  shader: string;
  textures: string[];
}

export interface SceneMaterial {
  passes: SceneMaterialPass[];
}

export interface SceneData {
  general: SceneGeneral;
  camera: SceneCamera;
  objects: SceneObject[];
  textures: Map<string, SceneTexture>;
  models: Map<string, SceneModel>;
  materials: Map<string, SceneMaterial>;
  /** Scene format version (from the optional top-level "version" field). */
  version: number | null;
}

// ---------------------------------------------------------------------------
// Loose JSON-file probe helpers.
//
// scene.pkg bundles many untyped JSON files (scene.json / model / material)
// from Wallpaper Engine's authoring tool.  Their shape varies heavily across
// versions, and most fields are optional — validating a strict schema here
// would throw away dozens of valid legacy wallpapers.  Instead we parse them
// as `unknown` and narrow via small structural helpers; the helper types
// below describe the small subset of fields we actually read so casts don't
// leak `any` across the file.
// ---------------------------------------------------------------------------

type SceneRootJson = {
  general?: unknown;
  camera?: unknown;
  objects?: unknown;
  version?: unknown;
};

type MaterialPassJson = {
  shader?: unknown;
  textures?: unknown;
};

type MaterialRootJson = {
  passes?: MaterialPassJson[];
};

type ModelRootJson = {
  material?: unknown;
  solidLayer?: unknown;
  passthrough?: unknown;
};

/**
 * Type-only JSON narrowing helper.  Returns the same object as the input
 * typed as `T`, but only if it's a plain object (the expected JSON shape).
 * Callers still own the responsibility of accessing individual fields with
 * fallbacks — this is purely a way to banish `as any` from parser sites.
 */
function asJsonRecord<T extends object>(value: unknown): T | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  return null;
}

/** Extract a complete scene from a scene.pkg file. Returns null on failure. */
export function extractScene(pkgPath: string): SceneData | null {
  const pkg = parsePkg(pkgPath);
  if (!pkg) return null;

  // Find scene.json
  const sceneEntry = findEntry(pkg, 'scene.json');
  if (!sceneEntry) return null;

  let sceneJson: unknown;
  try {
    sceneJson = JSON.parse(sceneEntry.bytes.toString('utf8'));
  } catch {
    return null;
  }
  const sceneObj = asJsonRecord<SceneRootJson>(sceneJson);
  if (!sceneObj) return null;

  // Parse textures (.tex files)
  const textures = extractTextures(pkg.entries);

  // Parse model JSON files. Wallpaper Engine uses .json extension for model
  // files (e.g. "models/background.json"), NOT .model. The file contains a
  // "material" field pointing to a material JSON. Some older wallpapers may
  // use .model extension, so we check both.
  const models = extractModels(pkg.entries);

  // Parse material JSON files. Wallpaper Engine uses .json extension for
  // material files (e.g. "materials/background.json"), NOT .material. The
  // file contains a "passes" array with shader and texture references.
  const materials = extractMaterials(pkg.entries);

  const { general, camera, objects, version } = parseSceneJson(sceneObj);

  return { general, camera, objects, textures, models, materials, version };
}

/** Parse all .tex entries from the PKG into SceneTexture records. */
function extractTextures(entries: PkgEntry[]): Map<string, SceneTexture> {
  const textures = new Map<string, SceneTexture>();
  for (const entry of entries) {
    if (!entry.fullPath.toLowerCase().endsWith('.tex')) continue;
    let tex: TexData | null;
    try {
      tex = parseTex(entry.bytes);
    } catch {
      // Malformed TEX file (truncated, unsupported version, or corrupted) —
      // skip it so one bad texture doesn't crash the entire scene.
      continue;
    }
    if (!tex) continue;
    const name = entry.fullPath.replace(/\.tex$/i, '').replace(/\\/g, '/');
    let dataUrl: string | null = null;
    try {
      dataUrl = texToDataUrl(tex);
    } catch {
      // Texture decoding failed — store without dataUrl (layer will be blank)
    }
    textures.set(name.toLowerCase(), {
      name,
      dataUrl,
      width: tex.textureWidth,
      height: tex.textureHeight,
    });
  }
  return textures;
}

/** Parse all model JSON entries from the PKG into SceneModel records. */
function extractModels(entries: PkgEntry[]): Map<string, SceneModel> {
  const models = new Map<string, SceneModel>();
  for (const entry of entries) {
    const lower = entry.fullPath.toLowerCase();
    if (!lower.endsWith('.json') && !lower.endsWith('.model')) continue;
    if (!lower.includes('models/')) continue;
    try {
      const modelJson = asJsonRecord<ModelRootJson>(JSON.parse(entry.bytes.toString('utf8')));
      // Only treat as model if it has a "material" field
      if (!modelJson || !modelJson.material) continue;
      const name = entry.fullPath.replace(/\.(json|model)$/i, '').replace(/\\/g, '/');
      models.set(name.toLowerCase(), {
        material: typeof modelJson.material === 'string' ? modelJson.material : '',
        solidLayer: !!modelJson.solidLayer,
        passthrough: !!modelJson.passthrough,
      });
    } catch {
      // skip malformed
    }
  }
  return models;
}

/** Parse all material JSON entries from the PKG into SceneMaterial records. */
function extractMaterials(entries: PkgEntry[]): Map<string, SceneMaterial> {
  const materials = new Map<string, SceneMaterial>();
  for (const entry of entries) {
    const lower = entry.fullPath.toLowerCase();
    if (!lower.endsWith('.json') && !lower.endsWith('.material')) continue;
    if (!lower.includes('materials/')) continue;
    try {
      const matJson = asJsonRecord<MaterialRootJson>(JSON.parse(entry.bytes.toString('utf8')));
      // Only treat as material if it has a "passes" field
      if (!matJson?.passes) continue;
      const name = entry.fullPath.replace(/\.(json|material)$/i, '').replace(/\\/g, '/');
      const passes: SceneMaterialPass[] = (matJson.passes || [])
        .filter((p): p is MaterialPassJson => !!p && typeof p === 'object')
        .map((p) => ({
          shader: typeof p.shader === 'string' ? p.shader : '',
          textures: Array.isArray(p.textures)
            ? p.textures.filter((t): t is string => typeof t === 'string')
            : [],
        }));
      materials.set(name.toLowerCase(), { passes });
    } catch {
      // skip malformed
    }
  }
  return materials;
}

// ---------------------------------------------------------------------------
// Texture resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the texture for a scene object by following the chain:
 *   object.image → model JSON → material JSON → pass.textures[0] → texture
 */
export function resolveObjectTexture(obj: SceneObject, scene: SceneData): SceneTexture | null {
  if (!obj.image) return null;

  // image is like "models/background.json" (Wallpaper Engine uses .json, not
  // .model). Strip any known extension and normalize the path for lookup.
  const modelKey = obj.image
    .replace(/\.(json|model)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const model = scene.models.get(modelKey);
  if (!model) return null;

  if (model.passthrough) return null; // Skip passthrough layers
  if (model.solidLayer) return null; // Solid color handled separately

  // material path is like "materials/background.json" — strip .json/.material
  const materialKey = model.material
    .replace(/\.(json|material)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const material = scene.materials.get(materialKey);
  if (!material || material.passes.length === 0) return null;

  const pass = material.passes[0];
  if (pass.textures.length === 0) return null;

  // Texture names in material JSON are relative to the materials/ directory
  // and do NOT include the .tex extension (e.g. "background" → look up
  // "materials/background" in the textures map, which was stored without
  // the .tex extension by extractScene).
  const texName = pass.textures[0].replace(/\.tex$/i, '').replace(/\\/g, '/');
  const texKey = `materials/${texName}`.toLowerCase();
  return scene.textures.get(texKey) || null;
}
