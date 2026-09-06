// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { compositeScene } from './composite-renderer';
import type { SceneData } from './scene-extractor';

function createMockScene(): SceneData {
  return {
    general: {
      clearColor: { r: 0.1, g: 0.2, b: 0.3 },
      clearEnabled: true,
      orthogonalProjection: { width: 1920, height: 1080 },
      hdr: false,
      fov: 90,
      nearZ: 0.1,
      farZ: 1000,
      zoom: 1,
      perspectiveOverrideFov: null,
      cameraFade: false,
      cameraParallax: false,
      cameraParallaxAmount: 0,
      cameraParallaxDelay: 0,
      cameraParallaxMouseInfluence: 0,
      cameraPreview: false,
      cameraShake: false,
      cameraShakeAmplitude: 0,
      cameraShakeRoughness: 0,
      cameraShakeSpeed: 0,
      ambientColor: { r: 1, g: 1, b: 1 },
      skylightColor: { r: 1, g: 1, b: 1 },
      bloom: false,
      bloomStrength: 0,
      bloomThreshold: 0,
      bloomTint: { r: 1, g: 1, b: 1 },
      bloomHdrStrength: null,
      bloomHdrThreshold: null,
      bloomHdrScatter: null,
      bloomHdrFeather: null,
      bloomHdrIterations: null,
      windEnabled: false,
      windStrength: 0,
      windDirection: { x: 0, y: 0 },
      windTurbulence: 0,
      gravityStrength: 0,
      gravityDirection: { x: 0, y: 0, z: 0 },
    },
    camera: {
      center: { x: 0, y: 0, z: 0 },
      eye: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    },
    objects: [],
    textures: new Map(),
    models: new Map(),
    materials: new Map(),
    particleJsons: new Map(),
    version: null,
  };
}

describe('compositeScene', () => {
  it('returns null for scene with no objects (empty layers from buildRenderLayers)', () => {
    const scene = createMockScene();
    // buildRenderLayers returns [] for empty objects → compositeScene returns null
    const result = compositeScene(scene, { width: 100, height: 100 });
    expect(result).toBeNull();
  });

  it('returns null for empty dimensions', () => {
    const scene = createMockScene();
    const result = compositeScene(scene, { width: 0, height: 0 });
    expect(result).toBeNull();
  });

  it('uses scene projection size when available but still returns null for no objects', () => {
    const scene = createMockScene();
    // Even with a valid projection size, no objects means no layers
    const result = compositeScene(scene, { width: 100, height: 100 });
    expect(result).toBeNull();
  });
});
