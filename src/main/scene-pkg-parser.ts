// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene PKG Parser (barrel)
 *
 * Parses Wallpaper Engine's proprietary `scene.pkg` binary container and the
 * `.tex` texture format embedded inside it. Extracted data is used by the
 * scene renderer to produce a self-contained HTML wallpaper.
 *
 * This file is now a **barrel** that re-exports the public API of focused
 * sub-modules under `./scene/`. The original 1248-line monolith was split
 * as part of the SRP refactor (P0-3):
 *
 *   - {@link ./scene/binary-reader}     — low-level binary I/O (BinaryReader)
 *   - {@link ./scene/pkg-parser}        — PKG container format parsing
 *   - {@link ./scene/tex-parser}        — TEX texture parsing, DXT decompression, PNG conversion
 *   - {@link ./scene/scene-json-parser} — scene.json schema parsing + Scene* type definitions
 *   - {@link ./scene/scene-extractor}   — scene data extraction orchestration + texture resolution
 *
 * Existing consumers (`scene-renderer-html.ts`, `scene-pkg-parser.test.ts`)
 * can keep importing from `'./scene-pkg-parser'` without changes.
 */

// ---------------------------------------------------------------------------
// PKG Container
// ---------------------------------------------------------------------------

export type { PkgEntry, PkgPackage } from './scene/pkg-parser';
export {
  findEntries,
  findEntry,
  parsePkg,
  parsePkgAsync,
  parsePkgBuffer,
} from './scene/pkg-parser';

// ---------------------------------------------------------------------------
// TEX Texture Parser
// ---------------------------------------------------------------------------

export type {
  TexData,
  TexFrameInfo,
  TexImage,
  TexMipmap,
} from './scene/tex-parser';
export {
  decompressDxt,
  parseTex,
  rgbaToPngDataUrl,
  TEX_FLAGS,
  TEX_FORMAT,
  texToDataUrl,
} from './scene/tex-parser';

// ---------------------------------------------------------------------------
// Scene JSON Parser — types
// ---------------------------------------------------------------------------

export type {
  AnimatedProperty,
  SceneCamera,
  SceneColor,
  SceneEffect,
  SceneEffectPass,
  SceneGeneral,
  SceneInstanceOverride,
  SceneObject,
  SceneVec2,
} from './scene/scene-json-parser';

// ---------------------------------------------------------------------------
// Scene JSON Parser — functions
// ---------------------------------------------------------------------------

export { parseSceneJson } from './scene/scene-json-parser';

// ---------------------------------------------------------------------------
// Scene Extractor — types
// ---------------------------------------------------------------------------

export type {
  SceneData,
  SceneMaterial,
  SceneMaterialPass,
  SceneModel,
  SceneParticle,
  SceneTexture,
} from './scene/scene-extractor';

// ---------------------------------------------------------------------------
// Scene Extractor — functions
// ---------------------------------------------------------------------------

export {
  clearSceneCache,
  deriveWeInstallRoot,
  extractScene,
  extractSceneAsync,
  findInstallAsset,
  resolveObjectTexture,
  resolveParticleTexture,
  resolveSceneParticle,
} from './scene/scene-extractor';

// ---------------------------------------------------------------------------
// Particle Parser
// ---------------------------------------------------------------------------

export type {
  ParticleColor,
  ParticleEmitter,
  ParticleInitializers,
  ParticleOperator,
  ParticleRange,
  ParticleVec3,
  SceneParticleData,
} from './scene/particle-parser';
export { findParticleOperator, parseParticleJson } from './scene/particle-parser';
