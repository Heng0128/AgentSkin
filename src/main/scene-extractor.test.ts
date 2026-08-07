// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SceneObject } from './scene/scene-json-parser';
import {
  deriveWeInstallRoot,
  extractScene,
  findInstallAsset,
  resolveParticleTexture,
  resolveSceneParticle,
} from './scene-pkg-parser';

// ---------------------------------------------------------------------------
// Helpers — fake WE install tree + minimal TEX builder
// ---------------------------------------------------------------------------

let tmpRoot: string;

/** Minimal embedded-PNG TEXV0005 (TEXB0003, FIF_PNG=13) that decodes to a
 *  data URL — mirrors the fixtures used in tex-parser.test.ts. */
function buildPngTex(): Buffer {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const parts: Buffer[] = [];
  const str = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1, 0)]);
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n, 0);
    return b;
  };
  parts.push(
    str('TEXV0005'),
    str('TEXI0001'),
    i32(0),
    i32(0),
    i32(1),
    i32(1),
    i32(1),
    i32(1),
    i32(0),
  );
  // TEXB0003: container, imageCount, imageFormat, then per image: mipmapCount,
  // and per mip: width, height, isLz4, decompressedSize, byteCount, bytes.
  parts.push(
    str('TEXB0003'),
    i32(1),
    i32(13),
    i32(1),
    i32(1),
    i32(1),
    i32(0),
    i32(png.length),
    i32(png.length),
    png,
  );
  return Buffer.concat(parts);
}

/** Create the fake WE install under tmpRoot: assets/<presetCategory>/… */
async function createInstall(): Promise<string> {
  const install = path.join(tmpRoot, 'wallpaper_engine');
  const asset = path.join(install, 'assets');

  // particles/presets/rain.json — preset-category layout
  const rainParticle = {
    material: 'materials/presets/rain.json',
    maxcount: 1000,
    emitter: [
      {
        name: 'sphererandom',
        rate: 40,
        origin: '0 500 0',
        directions: '1 1 0',
        distancemin: 0,
        distancemax: 800,
      },
    ],
    initializer: [
      { name: 'lifetimerandom', min: 2, max: 4 },
      { name: 'sizerandom', min: 2, max: 6 },
      { name: 'velocityrandom', min: '0 -500 0', max: '0 -500 0' },
      { name: 'colorrandom', min: '200 210 255', max: '230 240 255' },
    ],
    operator: [
      { name: 'movement', gravity: '0 0 0' },
      { name: 'alphafade', fadeintime: 0.2 },
    ],
  };

  // materials/presets/rain.json — additive material with a sprite texture
  const rainMaterial = {
    passes: [
      {
        shader: 'genericparticle',
        blending: 'additive',
        textures: ['particle/rain'],
      },
    ],
  };

  await fs.mkdir(path.join(asset, 'presets', 'rainy', 'particles', 'presets'), { recursive: true });
  await fs.mkdir(path.join(asset, 'presets', 'rainy', 'materials', 'presets'), { recursive: true });
  await fs.mkdir(path.join(asset, 'materials', 'particle'), { recursive: true });
  await fs.writeFile(
    path.join(asset, 'presets', 'rainy', 'particles', 'presets', 'rain.json'),
    JSON.stringify(rainParticle),
  );
  await fs.writeFile(
    path.join(asset, 'presets', 'rainy', 'materials', 'presets', 'rain.json'),
    JSON.stringify(rainMaterial),
  );
  await fs.writeFile(path.join(asset, 'materials', 'particle', 'rain.tex'), buildPngTex());

  // A direct-path asset (non-preset): particles/simple.json → assets/particles/simple.json
  await fs.mkdir(path.join(asset, 'particles'), { recursive: true });
  await fs.writeFile(
    path.join(asset, 'particles', 'simple.json'),
    JSON.stringify({ emitter: [{ name: 'sphererandom', rate: 5 }] }),
  );

  // A preview category that must be skipped in favor of the real one
  await fs.mkdir(path.join(asset, 'presets', 'previewrainy', 'particles', 'presets'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(asset, 'presets', 'previewrainy', 'particles', 'presets', 'rain.json'),
    JSON.stringify({ emitter: [] }),
  );

  return install;
}

function objWithParticle(ref: string): SceneObject {
  return {
    id: 1,
    name: 'Rain',
    origin: { x: 960, y: 540, z: 0 },
    angles: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    size: { x: 0, y: 0, z: 0 },
    alignment: null,
    image: null,
    visible: true,
    alpha: 1,
    color: null,
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
    particle: ref,
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
    ledSource: false,
    config: null,
  };
}

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = '';
});

// ---------------------------------------------------------------------------
// findInstallAsset — ref → file mapping
// ---------------------------------------------------------------------------

describe('findInstallAsset', () => {
  it('maps preset refs to per-category preset folders, skipping previews', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    const p = findInstallAsset(install, 'particles/presets/rain.json');
    expect(p).not.toBeNull();
    expect(p!).toContain(path.join('presets', 'rainy', 'particles', 'presets', 'rain.json'));
    // material preset ref resolves the same way
    const m = findInstallAsset(install, 'materials/presets/rain.json');
    expect(m).not.toBeNull();
    expect(m!).toContain(path.join('presets', 'rainy', 'materials', 'presets', 'rain.json'));
  });

  it('resolves direct (non-preset) refs under assets/', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    const p = findInstallAsset(install, 'particles/simple.json');
    expect(p).not.toBeNull();
    expect(p!).toContain(path.join('assets', 'particles', 'simple.json'));
  });

  it('returns null for missing refs', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    expect(findInstallAsset(install, 'particles/presets/nope.json')).toBeNull();
    expect(findInstallAsset(install, 'particles/workshop/123/x.json')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveWeInstallRoot — workshop layout → install root
// ---------------------------------------------------------------------------

describe('deriveWeInstallRoot', () => {
  it('walks up from a workshop pkg to the WE install root', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-layout-'));
    const pkgPath = path.join(
      tmpRoot,
      'steamapps',
      'workshop',
      'content',
      '431960',
      '123456789',
      'scene.pkg',
    );
    await fs.mkdir(path.join(tmpRoot, 'steamapps', 'common', 'wallpaper_engine'), {
      recursive: true,
    });
    const root = deriveWeInstallRoot(pkgPath);
    expect(root).not.toBeNull();
    expect(root!).toBe(path.join(tmpRoot, 'steamapps', 'common', 'wallpaper_engine'));
  });

  it('returns null for non-workshop paths', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-layout-'));
    expect(deriveWeInstallRoot(path.join(tmpRoot, 'downloads', 'scene.pkg'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveSceneParticle / resolveParticleTexture
// ---------------------------------------------------------------------------

describe('resolveSceneParticle', () => {
  it('resolves a full particle chain: JSON → material → texture', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    const p = resolveSceneParticle(
      objWithParticle('particles/presets/rain.json'),
      { particleJsons: new Map(), materials: new Map() },
      install,
    );
    expect(p).not.toBeNull();
    expect(p!.data.maxCount).toBe(1000);
    expect(p!.data.emitters[0].rate).toBe(40);
    // Colors normalized from 0-255
    expect(p!.data.initializers.color.max.r).toBeCloseTo(230 / 255);
    // Texture decoded from the install .tex file
    expect(p!.texture).not.toBeNull();
    expect(p!.texture!.dataUrl).toMatch(/^data:image\/png;base64,/);
    // Additive blending carried through the material
    expect(p!.blending).toBe('additive');
  });

  it('resolves a pkg-embedded particle without any install (custom workshop preset)', async () => {
    // Custom workshop particles are bundled INSIDE scene.pkg — the parser
    // must resolve them from the pkg JSONs even with no WE install.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const particleJson = {
      material: 'materials/workshop/123/presets/rain.json',
      maxcount: 200,
      emitter: [{ name: 'boxrandom', rate: 8 }],
      initializer: [
        { name: 'lifetimerandom', min: 1, max: 3 },
        { name: 'sizerandom', min: 4, max: 12 },
      ],
    };
    const p = resolveSceneParticle(
      objWithParticle('particles/workshop/123/presets/rain.json'),
      {
        particleJsons: new Map([['particles/workshop/123/presets/rain.json', particleJson]]),
        // Custom materials are also pkg-embedded.
        materials: new Map([
          [
            'materials/workshop/123/presets/rain',
            {
              passes: [
                { shader: 'genericparticle', textures: ['particle/rain'], blending: 'additive' },
              ],
            },
          ],
        ]),
      },
      null, // no install → texture stays null, JSON chain still resolves
    );
    expect(p).not.toBeNull();
    expect(p!.data.maxCount).toBe(200);
    expect(p!.data.emitters[0].name).toBe('boxrandom');
    expect(p!.blending).toBe('additive');
    expect(p!.texture).toBeNull();
  });

  it('returns null for missing particle files or malformed JSON', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    expect(
      resolveSceneParticle(
        objWithParticle('particles/presets/nope.json'),
        { particleJsons: new Map(), materials: new Map() },
        install,
      ),
    ).toBeNull();
    await fs.writeFile(path.join(install, 'assets', 'particles', 'broken.json'), '{ not json');
    expect(
      resolveSceneParticle(
        objWithParticle('particles/broken.json'),
        { particleJsons: new Map(), materials: new Map() },
        install,
      ),
    ).toBeNull();
  });

  it('returns null without an install root or without a particle ref', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    expect(
      resolveSceneParticle(
        objWithParticle('particles/presets/rain.json'),
        { particleJsons: new Map(), materials: new Map() },
        null,
      ),
    ).toBeNull();
    const noRef = objWithParticle('particles/presets/rain.json');
    noRef.particle = null;
    expect(
      resolveSceneParticle(noRef, { particleJsons: new Map(), materials: new Map() }, install),
    ).toBeNull();
  });
});

describe('resolveParticleTexture', () => {
  it('decodes the material sprite texture and reports blending', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    const resolved = resolveParticleTexture(install, 'materials/presets/rain.json');
    expect(resolved).not.toBeNull();
    expect(resolved!.blending).toBe('additive');
    expect(resolved!.texture!.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null for a missing material', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'we-install-'));
    const install = await createInstall();
    expect(resolveParticleTexture(install, 'materials/presets/nope.json')).toBeNull();
    expect(resolveParticleTexture(install, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractScene — frames carried through texture extraction
// ---------------------------------------------------------------------------

describe('extractScene frames', () => {
  it('stores animated frame data on GIF textures and leaves static null', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-extract-'));
    // Build a scene.pkg with one static tex + one GIF tex.
    const pkg = path.join(tmpRoot, 'scene.pkg');
    const staticTex = buildPngTex();

    // GIF tex: flags 4, TEXS0001 with 2 frames (TEXB0001, RGBA8888 1x1)
    const gifParts: Buffer[] = [];
    const str = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1, 0)]);
    const i32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeInt32LE(n, 0);
      return b;
    };
    const f32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeFloatLE(n, 0);
      return b;
    };
    gifParts.push(
      str('TEXV0005'),
      str('TEXI0001'),
      i32(0),
      i32(4),
      i32(1),
      i32(1),
      i32(1),
      i32(1),
      i32(0),
    );
    gifParts.push(str('TEXB0001'), i32(2), i32(1), i32(1), i32(1), i32(4), Buffer.alloc(4, 0xff));
    gifParts.push(i32(1), i32(1), i32(1), i32(4), Buffer.alloc(4, 0x00));
    gifParts.push(
      str('TEXS0001'),
      i32(2),
      i32(0),
      f32(0.1),
      i32(0),
      i32(0),
      i32(1),
      i32(1),
      i32(0),
      i32(0),
    );
    gifParts.push(i32(1), f32(0.2), i32(0), i32(0), i32(1), i32(1), i32(0), i32(0));
    const gifTex = Buffer.concat(gifParts);

    // Reuse the pkg builder shape from scene-renderer-html.test.ts
    const entries = [
      {
        name: 'scene.json',
        data: Buffer.from(
          JSON.stringify({
            general: { clearenabled: true },
            objects: [],
          }),
        ),
      },
      { name: 'materials/bg.tex', data: staticTex },
      { name: 'materials/gif.tex', data: gifTex },
    ];
    const parts: Buffer[] = [];
    const magic = Buffer.from('scene.pkg', 'utf8');
    const magicLen = Buffer.alloc(4);
    magicLen.writeInt32LE(magic.length, 0);
    parts.push(magicLen, magic);
    const count = Buffer.alloc(4);
    count.writeInt32LE(entries.length, 0);
    parts.push(count);
    const table: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const nb = Buffer.from(e.name, 'utf8');
      const nbLen = Buffer.alloc(4);
      nbLen.writeInt32LE(nb.length, 0);
      const off = Buffer.alloc(4);
      off.writeInt32LE(offset, 0);
      const len = Buffer.alloc(4);
      len.writeInt32LE(e.data.length, 0);
      table.push(nbLen, nb, off, len);
      offset += e.data.length;
    }
    for (const t of table) parts.push(t);
    for (const e of entries) parts.push(e.data);
    await fs.writeFile(pkg, Buffer.concat(parts));

    const scene = extractScene(pkg);
    expect(scene).not.toBeNull();
    const staticTex2 = scene!.textures.get('materials/bg');
    const gifTex2 = scene!.textures.get('materials/gif');
    expect(staticTex2).not.toBeUndefined();
    expect(staticTex2!.frames).toBeNull();
    expect(gifTex2).not.toBeUndefined();
    expect(gifTex2!.frames).not.toBeNull();
    expect(gifTex2!.frames!).toHaveLength(2);
    expect(gifTex2!.frames![0].frametime).toBeCloseTo(0.1);
    expect(gifTex2!.frames![1].frametime).toBeCloseTo(0.2);
    expect(gifTex2!.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
