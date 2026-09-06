// SPDX-License-Identifier: MPL-2.0
/* biome-ignore-all lint/suspicious/noExplicitAny: test mocks for node:fs require any for partial type assertions */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneData, SceneTexture } from './scene-extractor';
import { StaticFrameExtractor } from './static-frame-extractor';

// Mock the scene-extractor module
vi.mock('./scene-extractor', () => ({
  extractScene: vi.fn(),
}));

// Mock fs/promises for preview file reading
vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
}));

import fs from 'node:fs/promises';
import { extractScene } from './scene-extractor';

const mockedExtractScene = vi.mocked(extractScene);
const mockedFs = vi.mocked(fs);

function createMockScene(overrides: Partial<SceneData> = {}): SceneData {
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
      ...overrides.general,
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
    ...overrides,
  };
}

function createMockTexture(name: string, width: number, height: number): SceneTexture {
  return {
    name,
    dataUrl: `data:image/png;base64,mock-${name}-${width}x${height}`,
    frames: null,
    width,
    height,
  };
}

describe('StaticFrameExtractor', () => {
  let extractor: StaticFrameExtractor;

  beforeEach(() => {
    extractor = new StaticFrameExtractor();
    mockedExtractScene.mockReset();
  });

  it('returns solid color (black) when scene parsing fails', async () => {
    mockedExtractScene.mockReturnValue(null);

    const result = await extractor.extractStaticFrame('/fake/path.pkg');

    // Ultimate fallback: solid black (default fallbackColor)
    expect(result.source).toBe('solid-color');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  it('returns solid color from clearColor when scene has no textures', async () => {
    mockedExtractScene.mockReturnValue(createMockScene());

    const result = await extractor.extractStaticFrame('/fake/path.pkg');

    // Degradation chain: no textures → solid color from scene clearColor
    expect(result.source).toBe('solid-color');
  });

  it('returns solid color when textures have no dataUrl', async () => {
    const scene = createMockScene();
    const tex = createMockTexture('background', 2048, 2048);
    tex.dataUrl = null;
    scene.textures.set('bg', tex);
    mockedExtractScene.mockReturnValue(scene);

    const result = await extractor.extractStaticFrame('/fake/path.pkg');

    // Should fall through to solid color (from clearColor)
    expect(result.source).toBe('solid-color');
  });

  it('returns main texture when available', async () => {
    const scene = createMockScene();
    scene.textures.set('hero', createMockTexture('hero', 4096, 4096));
    scene.textures.set('mask', createMockTexture('mask-effect', 512, 512));
    mockedExtractScene.mockReturnValue(scene);

    const result = await extractor.extractStaticFrame('/fake/path.pkg');

    expect(result.source).toBe('main-texture');
    expect(result.dataUrl).toContain('hero');
  });

  it('caches results for the same path', async () => {
    const scene = createMockScene();
    scene.textures.set('bg', createMockTexture('background', 1920, 1080));
    mockedExtractScene.mockReturnValue(scene);

    const result1 = await extractor.extractStaticFrame('/fake/path.pkg');
    const result2 = await extractor.extractStaticFrame('/fake/path.pkg');

    expect(result1).toBe(result2); // Same reference (from cache)
    expect(mockedExtractScene).toHaveBeenCalledTimes(1);
  });

  it('clears cache on demand', async () => {
    const scene = createMockScene();
    scene.textures.set('bg', createMockTexture('background', 1920, 1080));
    mockedExtractScene.mockReturnValue(scene);

    await extractor.extractStaticFrame('/fake/path.pkg');
    extractor.clearCache();
    await extractor.extractStaticFrame('/fake/path.pkg');

    expect(mockedExtractScene).toHaveBeenCalledTimes(2);
  });

  it('uses fallback color when scene has no clearColor', async () => {
    const scene = createMockScene();
    scene.general!.clearColor = undefined as unknown as { r: number; g: number; b: number };
    mockedExtractScene.mockReturnValue(scene);

    const result = await extractor.extractStaticFrame('/fake/path.pkg', {
      fallbackColor: '#ff0000',
    });

    expect(result.source).toBe('solid-color');
  });

  it('returns preview.jpg when main texture fails and preview exists', async () => {
    const scene = createMockScene();
    // Texture with no dataUrl → main texture extraction fails
    const tex = createMockTexture('background', 2048, 2048);
    tex.dataUrl = null;
    scene.textures.set('bg', tex);
    mockedExtractScene.mockReturnValue(scene);

    // Mock fs.stat to return a file for preview.jpg
    const previewPath = '/fake/preview.jpg';
    mockedFs.stat.mockResolvedValue({ isFile: () => true } as any);
    // Mock fs.readFile to return a fake JPEG buffer
    mockedFs.readFile.mockResolvedValue(Buffer.from('fake-jpeg-data'));

    const result = await extractor.extractStaticFrame('/fake/path.pkg', {
      previewPath,
    });

    expect(result.source).toBe('preview');
    expect(result.dataUrl).toContain('data:image/jpeg;base64,');
  });

  it('derives preview path from pkgPath when not explicitly provided', async () => {
    const scene = createMockScene();
    const tex = createMockTexture('background', 2048, 2048);
    tex.dataUrl = null;
    scene.textures.set('bg', tex);
    mockedExtractScene.mockReturnValue(scene);

    // Mock fs.stat to return a file for preview.jpg in the same directory
    mockedFs.stat.mockResolvedValue({ isFile: () => true } as any);
    mockedFs.readFile.mockResolvedValue(Buffer.from('fake-png-data'));

    const result = await extractor.extractStaticFrame('/fake/scene.pkg');

    expect(result.source).toBe('preview');
    expect(result.dataUrl).toContain('data:image/jpeg;base64,');
  });
});
