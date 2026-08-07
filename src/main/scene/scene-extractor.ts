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

import fs from 'node:fs';
import path from 'node:path';
import type { SceneParticleData } from './particle-parser';
import { parseParticleJson } from './particle-parser';
import type { PkgEntry } from './pkg-parser';
import { findEntry, parsePkg } from './pkg-parser';
import type { SceneCamera, SceneGeneral, SceneObject } from './scene-json-parser';
import { parseSceneJson } from './scene-json-parser';
import type { TexData, TexFrameRendered } from './tex-parser';
import { parseTex, texFramesToDataUrls, texToDataUrl } from './tex-parser';

// ---------------------------------------------------------------------------
// Types — scene asset structures (textures, models, materials)
// ---------------------------------------------------------------------------

export interface SceneTexture {
  name: string;
  dataUrl: string | null;
  /** Animated (GIF) frames: data URL + display duration per frame. Null for
   *  static textures. When present, the renderer animates by switching the
   *  drawn image on each frame's interval instead of drawing `dataUrl`. */
  frames: TexFrameRendered[] | null;
  width: number;
  height: number;
}

/** A resolved particle system + its sprite texture (from the WE install). */
export interface SceneParticle {
  data: SceneParticleData;
  texture: SceneTexture | null;
  /** Material pass blending mode ('additive', 'normal', …) — the renderer
   *  maps 'additive' to canvas 'lighter' compositing. */
  blending: string;
}

export interface SceneModel {
  material: string;
  solidLayer: boolean;
  passthrough: boolean;
}

export interface SceneMaterialPass {
  shader: string;
  textures: string[];
  /** Blending mode ('additive', 'normal', …). Used by the particle renderer
   *  to pick canvas compositing ('lighter' for additive sprites). */
  blending: string;
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
  /** Particle-system JSONs embedded in the pkg, keyed by their normalized
   *  full path (e.g. `particles/workshop/123/presets/rain.json`). Wallpaper
   *  Engine bundles particle presets (and their material JSONs) INSIDE
   *  scene.pkg — only the sprite .tex textures live in the WE install's
   *  shared assets. `resolveSceneParticle` consults this map first, then
   *  falls back to the install assets. */
  particleJsons: Map<string, unknown>;
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
  blending?: unknown;
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

  // Parse particle-system JSONs embedded in the pkg. Wallpaper Engine bundles
  // particle presets (and their material JSONs) inside scene.pkg — only the
  // sprite .tex textures live in the WE install's shared assets. These feed
  // `resolveSceneParticle` so custom workshop particles render too, not just
  // the install's shared presets.
  const particleJsons = extractParticleJsons(pkg.entries);

  const { general, camera, objects, version } = parseSceneJson(sceneObj);

  return { general, camera, objects, textures, models, materials, particleJsons, version };
}

/**
 * Extract all particle-system JSONs from the pkg. Keys are the entries'
 * normalized full paths (`particles/...`), values are the raw JSON values.
 * Malformed entries are skipped — one bad preset must not kill the scene.
 */
function extractParticleJsons(entries: PkgEntry[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const entry of entries) {
    const lower = entry.fullPath.toLowerCase();
    if (!lower.startsWith('particles/') || !lower.endsWith('.json')) continue;
    try {
      const value = JSON.parse(entry.bytes.toString('utf8'));
      map.set(lower, value);
    } catch {
      // Malformed particle JSON — skip so a single bad preset can't break
      // the whole scene extraction.
    }
  }
  return map;
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
    let frames: TexFrameRendered[] | null = null;
    try {
      // Animated GIF textures carry a TEXS0001 frame table — render every
      // frame up front so the scene renderer can animate by image switching
      // without decoding at display time.
      if (tex.isGif) {
        frames = texFramesToDataUrls(tex);
        if (frames && frames.length > 0) dataUrl = frames[0].dataUrl;
      }
      if (dataUrl === null) dataUrl = texToDataUrl(tex);
    } catch {
      // Texture decoding failed — store without dataUrl (layer will be blank)
    }
    textures.set(name.toLowerCase(), {
      name,
      dataUrl,
      frames,
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
          blending: typeof p.blending === 'string' ? p.blending : 'normal',
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

// ---------------------------------------------------------------------------
// Particle resolution (from the Wallpaper Engine install, not the pkg)
// ---------------------------------------------------------------------------

/**
 * Derive the Wallpaper Engine install root from a scene.pkg path.
 *
 * Workshop paths follow `<lib>/steamapps/workshop/content/431960/<id>/scene.pkg`,
 * and WE is installed at `<lib>/steamapps/common/wallpaper_engine`. We walk up
 * from the pkg until we hit a `steamapps` directory, then check for the
 * `common/wallpaper_engine` install underneath. Returns null when the path
 * doesn't match the workshop layout (e.g. tests, custom pkg locations).
 */
export function deriveWeInstallRoot(pkgPath: string): string | null {
  let dir = path.dirname(pkgPath);
  while (true) {
    const parent = path.dirname(dir);
    if (parent === dir) return null; // hit the filesystem root
    if (path.basename(dir) === 'steamapps') {
      const candidate = path.join(dir, 'common', 'wallpaper_engine');
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {
        // not at this library — keep walking up
      }
    }
    dir = parent;
  }
}

/** True when `p` is an existing regular file. */
function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a logical asset ref (e.g. `particles/presets/bubbles2.json` or
 * `materials/presets/light_shafts_0.json`) to a file inside the WE install's
 * `assets/` tree.
 *
 * Most refs map directly to `assets/<ref>` (e.g. `materials/particle/halo.json`
 * → `assets/materials/particle/halo.json`). But preset refs that begin with
 * `<type>/presets/` live in per-category folders on disk instead:
 *
 *   particles/presets/bubbles2.json
 *     → assets/presets/bubbles/particles/presets/bubbles2.json
 *   materials/presets/light_shafts_0.json
 *     → assets/presets/lightshafts/materials/presets/light_shafts_0.json
 *
 * Preview categories (`preview<name>/…`) are skipped in favor of the real
 * presets. Returns null when nothing matches.
 */
export function findInstallAsset(installRoot: string, ref: string): string | null {
  const rel = ref.replace(/\\/g, '/');
  const direct = path.join(installRoot, 'assets', rel);
  if (fileExists(direct)) return direct;

  const m = /^(particles|materials)\/presets\/([^/]+)$/.exec(rel);
  if (m) {
    const kind = m[1];
    const name = m[2];
    const presetsRoot = path.join(installRoot, 'assets', 'presets');
    let categories: string[] = [];
    try {
      categories = fs.readdirSync(presetsRoot);
    } catch {
      return null;
    }
    for (const cat of categories) {
      if (cat.toLowerCase().startsWith('preview')) continue;
      const candidate = path.join(presetsRoot, cat, kind, 'presets', name);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Read a particle-system JSON for a ref: pkg-embedded first, then the WE
 * install assets.
 *
 * Wallpaper Engine bundles particle presets inside scene.pkg — including
 * custom workshop particles (`particles/workshop/<id>/…`), which the
 * install's shared assets never contain. The pkg map is therefore the
 * primary source; the install fallback covers shared presets when a pkg
 * omits its copy.
 */
function readParticleJson(
  ref: string,
  particleJsons: Map<string, unknown>,
  weInstallRoot: string | null,
): unknown {
  // 1. pkg-embedded particle JSON (extractScene → SceneData.particleJsons).
  const lower = ref.replace(/\\/g, '/').toLowerCase();
  const embedded = particleJsons.get(lower);
  if (embedded !== undefined) return embedded;
  // 2. WE install shared assets (assets/particles/, assets/presets/…).
  if (!weInstallRoot) return null;
  const jsonPath = findInstallAsset(weInstallRoot, ref);
  if (!jsonPath) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Look up a particle material pass: pkg-embedded materials map first, then
 * the WE install assets. The pkg bundles material JSONs (even copies of
 * shared presets), so `scene.materials` resolves custom workshop materials
 * that the install never ships.
 */
function resolveParticleMaterialPass(
  materialRef: string | null,
  sceneMaterials: Map<string, SceneMaterial>,
  weInstallRoot: string | null,
): SceneMaterialPass | null {
  if (!materialRef) return null;
  // 1. pkg-embedded material (extractMaterials strips the extension and
  //    lowercases the key — particle material refs carry the .json suffix).
  const key = materialRef
    .replace(/\\/g, '/')
    .replace(/\.(json|material)$/i, '')
    .toLowerCase();
  const fromPkg = sceneMaterials.get(key);
  if (fromPkg && fromPkg.passes.length > 0) return fromPkg.passes[0];

  // 2. WE install assets (shared presets material).
  if (!weInstallRoot) return null;
  const matPath = findInstallAsset(weInstallRoot, materialRef);
  if (!matPath) return null;
  let matJson: unknown;
  try {
    matJson = JSON.parse(fs.readFileSync(matPath, 'utf8'));
  } catch {
    return null;
  }
  const passes =
    matJson && typeof matJson === 'object' ? (matJson as { passes?: unknown }).passes : null;
  if (!Array.isArray(passes) || passes.length === 0) return null;
  const pass = passes[0];
  const passObj =
    pass && typeof pass === 'object' ? (pass as { textures?: unknown; blending?: unknown }) : null;
  return {
    shader: '',
    textures: Array.isArray(passObj?.textures)
      ? passObj.textures.filter((t): t is string => typeof t === 'string')
      : [],
    blending: passObj && typeof passObj.blending === 'string' ? passObj.blending : 'normal',
  };
}

/**
 * Decode the sprite texture named by a material pass from the WE install's
 * shared assets. Texture names are relative to `assets/materials/` and omit
 * the .tex extension (e.g. "particle/light/light_shafts_0"). Textures are
 * never bundled inside scene.pkg — only the JSON assets are.
 */
function decodeParticleTexture(
  weInstallRoot: string | null,
  texName: string | null,
): SceneTexture | null {
  if (!texName || !weInstallRoot) return null;
  const texPath = path.join(
    weInstallRoot,
    'assets',
    'materials',
    `${texName.replace(/\\/g, '/')}.tex`,
  );
  try {
    const tex = parseTex(fs.readFileSync(texPath));
    if (!tex) return null;
    let dataUrl: string | null = null;
    let frames: TexFrameRendered[] | null = null;
    if (tex.isGif) {
      frames = texFramesToDataUrls(tex);
      if (frames && frames.length > 0) dataUrl = frames[0].dataUrl;
    }
    if (dataUrl === null) dataUrl = texToDataUrl(tex);
    if (!dataUrl) return null;
    return {
      name: texName,
      dataUrl,
      frames,
      width: tex.textureWidth,
      height: tex.textureHeight,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the sprite texture for a particle system by following the chain
 * material → passes[0].textures[0] → .tex file under `<install>/assets/`.
 * Install-only — the pkg-aware path is {@link resolveSceneParticle}.
 *
 * Returns null when the material or texture can't be resolved — the renderer
 * draws plain colored circles for texture-less particle layers.
 */
export function resolveParticleTexture(
  installRoot: string,
  materialPath: string | null,
): { texture: SceneTexture | null; blending: string } | null {
  if (!materialPath) return null;
  const pass = resolveParticleMaterialPass(materialPath, new Map(), installRoot);
  if (!pass) return null;
  const texture = decodeParticleTexture(installRoot, pass.textures[0] ?? null);
  return { texture, blending: pass.blending };
}

/**
 * Resolve a scene object's particle system.
 *
 * `obj.particle` names a JSON (e.g. `particles/presets/light_shafts_0.json`
 * or a custom `particles/workshop/<id>/…` preset). The JSON + material are
 * read pkg-first (they are bundled inside scene.pkg), with the WE install
 * assets as fallback; the sprite texture always comes from the install's
 * shared assets. Returns null when the object has no particle reference or
 * the preset is missing/malformed — the renderer then keeps the object's
 * static fallback.
 */
export function resolveSceneParticle(
  obj: SceneObject,
  scene: Pick<SceneData, 'particleJsons' | 'materials'>,
  weInstallRoot: string | null,
): SceneParticle | null {
  if (!obj.particle) return null;
  const particleJson = readParticleJson(obj.particle, scene.particleJsons, weInstallRoot);
  if (particleJson == null) return null;
  const data = parseParticleJson(particleJson);
  if (!data) return null;
  const pass = resolveParticleMaterialPass(data.material, scene.materials, weInstallRoot);
  const texture = pass ? decodeParticleTexture(weInstallRoot, pass.textures[0] ?? null) : null;
  return {
    data,
    texture,
    blending: pass?.blending ?? 'normal',
  };
}
