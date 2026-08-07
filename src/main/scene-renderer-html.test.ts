// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkshopOrSkip } from './scene/_workshop-test-helpers';
import { layerDrawSize, renderSceneToHtml, sceneLayerCenter } from './scene-renderer-html';

// ---------------------------------------------------------------------------
// Deterministic PKG builder — lets renderSceneToHtml run without a real
// Wallpaper Engine installation (binary format: magic string, entry table,
// flat data section; see scene/pkg-parser.ts).
// ---------------------------------------------------------------------------

let tmpDir: string;

function buildPkg(entries: Array<{ name: string; data: Buffer }>): Buffer {
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
  return Buffer.concat(parts);
}

async function renderPkgJson(sceneJson: unknown): Promise<string | null> {
  const pkgPath = path.join(tmpDir, 'scene.pkg');
  const pkg = buildPkg([
    { name: 'scene.json', data: Buffer.from(JSON.stringify(sceneJson), 'utf8') },
  ]);
  await fs.writeFile(pkgPath, pkg);
  return renderSceneToHtml(pkgPath);
}

/** Minimal TEXV0005 container (RGBA8888 mips, optional TEXS0001 GIF frames). */
function buildTex(options: {
  images: Array<Buffer>;
  flags?: number;
  frames?: Array<{ imageId: number; frametime: number }>;
}): Buffer {
  const parts: Buffer[] = [];
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
  const flags = options.flags ?? 0;
  parts.push(
    str('TEXV0005'),
    str('TEXI0001'),
    i32(0),
    i32(flags),
    i32(1),
    i32(1),
    i32(1),
    i32(1),
    i32(0),
  );
  parts.push(str('TEXB0001'), i32(options.images.length));
  for (const px of options.images) {
    parts.push(i32(1), i32(1), i32(1), i32(px.length), px);
  }
  if (options.frames && options.frames.length > 0) {
    parts.push(str('TEXS0001'), i32(options.frames.length));
    for (const f of options.frames) {
      parts.push(i32(f.imageId), f32(f.frametime), i32(0), i32(0), i32(1), i32(1), i32(0), i32(0));
    }
  }
  return Buffer.concat(parts);
}

/**
 * Build a scene.pkg with a textured layer resolved through the full chain
 * object.image → model JSON → material JSON → .tex entry.
 */
async function renderPkgWithTexture(
  texBytes: Buffer,
  sceneOverrides: Record<string, unknown> = {},
): Promise<string | null> {
  const pkgPath = path.join(tmpDir, 'scene.pkg');
  const sceneJson = {
    general: { clearenabled: true, orthogonalprojection: { width: 1920, height: 1080 } },
    camera: {},
    objects: [
      {
        id: 1,
        name: 'Background',
        image: 'models/bg.json',
        origin: '960.0 540.0 0.0',
        angles: '0.0 0.0 0.0',
        scale: '1.0 1.0 1.0',
        visible: true,
        ...sceneOverrides,
      },
    ],
  };
  const pkg = buildPkg([
    { name: 'scene.json', data: Buffer.from(JSON.stringify(sceneJson), 'utf8') },
    {
      name: 'models/bg.json',
      data: Buffer.from(JSON.stringify({ material: 'materials/bg.json' }), 'utf8'),
    },
    {
      name: 'materials/bg.json',
      data: Buffer.from(JSON.stringify({ passes: [{ textures: ['bg'] }] }), 'utf8'),
    },
    { name: 'materials/bg.tex', data: texBytes },
  ]);
  await fs.writeFile(pkgPath, pkg);
  return renderSceneToHtml(pkgPath);
}

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = '';
});

// ---------------------------------------------------------------------------
// Cross-origin signal bridge + parallax/audio in the generated HTML
// ---------------------------------------------------------------------------

describe('scene HTML — agent signal bridge (pointer/audio forwarding)', () => {
  it('renders HTML for a clear-enabled scene with no layers', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const html = await renderPkgJson({
      general: { clearenabled: true, orthogonalprojection: { width: 1920, height: 1080 } },
      camera: {},
      objects: [],
    });
    expect(html).not.toBeNull();
    expect(html!).toContain('<canvas');
  });

  it('returns null when a scene has no layers and clears are disabled', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const html = await renderPkgJson({
      general: { clearenabled: false, orthogonalprojection: { width: 1920, height: 1080 } },
      camera: {},
      objects: [],
    });
    expect(html).toBeNull();
  });

  it('embeds the postMessage bridge that resurrects parallax in agent windows', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const html = (await renderPkgJson({
      general: {
        clearenabled: true,
        cameraparallax: true,
        cameraparallaxamount: 0.5,
        orthogonalprojection: { width: 1920, height: 1080 },
      },
      camera: {},
      objects: [],
    }))!;
    // The iframe is pointer-events:none inside agent pages, so pointer coords
    // must arrive via postMessage — the bridge pattern shared with
    // buildWpSignalBridgeJs (cdp/wallpaper/shared.ts).
    expect(html).toContain("window.addEventListener('message'");
    expect(html).toContain('__agentskin');
    expect(html).toContain("d.type === 'pointer'");
    expect(html).toContain('targetMouseX');
    expect(html).toContain("d.type === 'audio'");
    expect(html).toContain('audioTarget');
    // Parallax must ALSO work standalone via direct mousemove (desktop UI
    // background iframes get pointer forwards too, but never rely on it).
    expect(html).toContain("window.addEventListener('mousemove'");
    expect(html).toContain('var PARALLAX = true');
  });

  it('smooths audio levels with an attack/decay envelope', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const html = (await renderPkgJson({
      general: { clearenabled: true, orthogonalprojection: { width: 1920, height: 1080 } },
      camera: {},
      objects: [],
    }))!;
    expect(html).toContain('audioLevel += (audioTarget - audioLevel) * 0.2');
  });
});

describe('scene HTML — animated (GIF) texture frame rendering', () => {
  it('carries animated frames into the layer JSON with frametimes preserved', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    // 2-frame animated texture: flags 4 (IS_GIF), TEXS0001 with per-frame durations.
    const tex = buildTex({
      images: [Buffer.alloc(4, 0xff), Buffer.alloc(4, 0x00)],
      flags: 4, // IS_GIF
      frames: [
        { imageId: 0, frametime: 0.1 },
        { imageId: 1, frametime: 0.05 },
      ],
    });
    const html = (await renderPkgWithTexture(tex))!;
    // The layer must serialize BOTH frames with their durations.
    expect(html).toContain('"frames":[{');
    expect(html).toMatch(/"frames":\[\{"dataUrl":"data:image\/png;base64,/);
    expect(html).toContain('"frametime":0.1');
    expect(html).toContain('"frametime":0.05');
  });

  it('embeds the frame-advance loop and per-frame preload', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const tex = buildTex({
      images: [Buffer.alloc(4, 0xff), Buffer.alloc(4, 0x00)],
      flags: 4, // IS_GIF
      frames: [
        { imageId: 0, frametime: 0.1 },
        { imageId: 1, frametime: 0.05 },
      ],
    });
    const html = (await renderPkgWithTexture(tex))!;
    // Preload every frame image...
    expect(html).toContain('for (var f = 0; f < LAYERS[i].frames.length; f++)');
    // ...and switch the drawn image on each frame's accumulated timing.
    expect(html).toContain('advanceFrames(t)');
    expect(html).toContain('current[i] = (idx + 1) % fr.length');
  });

  it('renders static textures with frames:null (no animation data)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const tex = buildTex({ images: [Buffer.alloc(4, 0xff)] });
    const html = (await renderPkgWithTexture(tex))!;
    expect(html).toContain('"frames":null');
    // No frame timing data leaks into static scenes.
    expect(html).not.toContain('"frametime":');
  });
});

// ---------------------------------------------------------------------------
// Particle layers (basic 2D simulation from WE particle presets)
// ---------------------------------------------------------------------------

/** Minimal embedded-PNG TEXV0005 (TEXB0003, FIF_PNG=13). */
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

/** Fake WE install: particles/presets/rain.json → additive material + sprite. */
async function createFakeInstall(): Promise<string> {
  const install = path.join(tmpDir, 'wallpaper_engine');
  const asset = path.join(install, 'assets');
  await fs.mkdir(path.join(asset, 'presets', 'rainy', 'particles', 'presets'), { recursive: true });
  await fs.mkdir(path.join(asset, 'presets', 'rainy', 'materials', 'presets'), { recursive: true });
  await fs.mkdir(path.join(asset, 'materials', 'particle'), { recursive: true });
  await fs.writeFile(
    path.join(asset, 'presets', 'rainy', 'particles', 'presets', 'rain.json'),
    JSON.stringify({
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
    }),
  );
  await fs.writeFile(
    path.join(asset, 'presets', 'rainy', 'materials', 'presets', 'rain.json'),
    JSON.stringify({
      passes: [{ shader: 'genericparticle', blending: 'additive', textures: ['particle/rain'] }],
    }),
  );
  await fs.writeFile(path.join(asset, 'materials', 'particle', 'rain.tex'), buildPngTex());
  return install;
}

/** scene.pkg with a single particle object, resolved against `installRoot`. */
async function renderPkgWithParticle(installRoot: string): Promise<string> {
  const pkgPath = path.join(tmpDir, 'scene.pkg');
  const sceneJson = {
    general: { clearenabled: true, orthogonalprojection: { width: 1920, height: 1080 } },
    camera: {},
    objects: [
      {
        id: 13,
        name: 'Light shafts',
        image: null,
        origin: '831.773 999.849 0.0',
        angles: '0.0 -0.0 1.376',
        scale: '-2.646 2.254 1.977',
        visible: true,
        particle: 'particles/presets/rain.json',
        instanceoverride: { colorn: '0.69 0.52 0.22', id: 14 },
        locktransforms: false,
      },
    ],
  };
  const pkg = buildPkg([
    { name: 'scene.json', data: Buffer.from(JSON.stringify(sceneJson), 'utf8') },
  ]);
  await fs.writeFile(pkgPath, pkg);
  return renderSceneToHtml(pkgPath, { weInstallRoot: installRoot })!;
}

describe('scene HTML — particle layers', () => {
  it('emits a particle config when the preset resolves from the install', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const install = await createFakeInstall();
    const html = await renderPkgWithParticle(install);
    expect(html).toContain('"particle":{');
    // Flattened emitter + initializer + operator fields
    expect(html).toContain('"rate":40');
    expect(html).toContain('"maxCount":1000');
    expect(html).toContain('"spawn":"sphere"');
    expect(html).toContain('"lifetimeMax":4');
    expect(html).toContain('"gravity":{"x":0,"y":0,"z":0}');
    // instanceoverride.colorn tint normalized
    expect(html).toContain('"tint":{"r":0.69,"g":0.52,"b":0.22}');
    // Additive blending from the material + decoded sprite
    expect(html).toContain('"additive":true');
    expect(html).toContain('"image":"data:image/png;base64,');
  });

  it('embeds the particle simulation loop (emit/integrate/draw)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const install = await createFakeInstall();
    const html = await renderPkgWithParticle(install);
    expect(html).toContain('function spawnParticle');
    expect(html).toContain('function stepParticles');
    expect(html).toContain('function drawParticles');
    expect(html).toContain('ps.emitAcc += cfg.rate * dt');
    expect(html).toContain('ps.parts.length < cfg.maxCount');
    expect(html).toContain(
      "ctx.globalCompositeOperation = cfg.additive ? 'lighter' : 'source-over'",
    );
  });

  it('keeps particle layers off non-particle objects (particle:null)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const install = await createFakeInstall();
    const tex = buildTex({ images: [Buffer.alloc(4, 0xff)] });
    const html = (await renderPkgWithTexture(tex))!;
    expect(html).toContain('"particle":null');
    expect(install).toBeTruthy(); // silence unused warning — install not used here
  });

  it('falls back to static when the particle preset is missing', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-html-'));
    const install = await createFakeInstall();
    // Scene references a preset that doesn't exist in the fake install.
    const pkgPath = path.join(tmpDir, 'scene.pkg');
    const sceneJson = {
      general: { clearenabled: true, orthogonalprojection: { width: 1920, height: 1080 } },
      camera: {},
      objects: [
        {
          id: 1,
          name: 'Missing',
          image: null,
          origin: '960 540 0',
          visible: true,
          particle: 'particles/presets/not_there.json',
        },
      ],
    };
    const pkg = buildPkg([
      { name: 'scene.json', data: Buffer.from(JSON.stringify(sceneJson), 'utf8') },
    ]);
    await fs.writeFile(pkgPath, pkg);
    const html = renderSceneToHtml(pkgPath, { weInstallRoot: install });
    // No particle config, no simulation code path (static scene still renders).
    expect(html).not.toBeNull();
    expect(html!).not.toContain('"particle":{');
    expect(html!).toContain('<canvas');
  });
});

describe('layerDrawSize (texture cover-fit into the quad, aspect preserved)', () => {
  it('draws a square texture on a 16:9 quad width-driven, cropping top/bottom', () => {
    // Square 2048² source on a 1920x1080 quad: width-driven, height = 1920
    // (the texture is NOT stretched to 1080 — that flattening was the
    // "壁纸被压扁/压缩" symptom).
    const s = layerDrawSize(1920, 1080, 1);
    expect(s.width).toBeCloseTo(1920);
    expect(s.height).toBeCloseTo(1920);
  });

  it('draws a 16:9 texture on a square quad height-driven, cropping left/right', () => {
    const s = layerDrawSize(1000, 1000, 16 / 9);
    expect(s.height).toBeCloseTo(1000);
    expect(s.width).toBeCloseTo(1000 * (16 / 9));
  });

  it('draws a matching-aspect texture exactly at the quad size (no crop)', () => {
    const s = layerDrawSize(1920, 1080, 16 / 9);
    expect(s.width).toBeCloseTo(1920);
    expect(s.height).toBeCloseTo(1080);
  });

  it('falls back to the quad size for degenerate inputs', () => {
    expect(layerDrawSize(0, 0, 1)).toEqual({ width: 0, height: 0 });
    expect(layerDrawSize(100, 100, 0)).toEqual({ width: 100, height: 100 });
  });
});

describe('sceneLayerCenter (scene → canvas coordinate mapping)', () => {
  it('maps the projection-center fullscreen layer to the viewport center', () => {
    // A fullscreen image in a 1920x1080 scene sits at origin (960, 540) —
    // the projection center (verified against real workshop items). On an
    // identical viewport it must land exactly at the viewport center.
    const pos = sceneLayerCenter(960, 540, 1920, 1080, 1920, 1080);
    expect(pos.x).toBeCloseTo(960);
    expect(pos.y).toBeCloseTo(540);
    expect(pos.scale).toBeCloseTo(1);
  });

  it('scales a 4K projection down to a 1080p viewport and keeps the center', () => {
    // 3840x2160 scene, fullscreen layer at (1920, 1080), 1920x1080 viewport:
    // scale = max(1920/3840, 1080/2160) = 0.5, and the fullscreen layer still
    // lands dead-center (cover-fit crops the edges evenly).
    const pos = sceneLayerCenter(1920, 1080, 3840, 2160, 1920, 1080);
    expect(pos.x).toBeCloseTo(960);
    expect(pos.y).toBeCloseTo(540);
    expect(pos.scale).toBeCloseTo(0.5);
  });

  it('maps the projection bottom-left corner to the viewport bottom-left', () => {
    // Scene origin (0,0) is the bottom-left corner (WE convention, +y up).
    // It must map to the viewport's bottom-left, NOT the center — the old
    // formula (centerX + x, centerY - y) drew it at the center, which was the
    // "壁纸显示位置不正确" root cause.
    const pos = sceneLayerCenter(0, 0, 1920, 1080, 1920, 1080);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(1080);
  });

  it('maps the projection top-right corner to the viewport top-right', () => {
    const pos = sceneLayerCenter(1920, 1080, 1920, 1080, 1920, 1080);
    expect(pos.x).toBeCloseTo(1920);
    expect(pos.y).toBeCloseTo(0);
  });

  it('is center-correct on a wider viewport (cover fit crops vertically)', () => {
    // 16:9 scene in a 21:9 viewport: scale is driven by width.
    const pos = sceneLayerCenter(960, 540, 1920, 1080, 2560, 1080);
    expect(pos.x).toBeCloseTo(1280);
    expect(pos.y).toBeCloseTo(540);
    expect(pos.scale).toBeCloseTo(2560 / 1920);
  });

  it('is center-correct on a taller viewport (cover fit crops horizontally)', () => {
    const pos = sceneLayerCenter(960, 540, 1920, 1080, 1600, 1200);
    expect(pos.x).toBeCloseTo(800);
    expect(pos.y).toBeCloseTo(600);
    expect(pos.scale).toBeCloseTo(1200 / 1080);
  });

  it('keeps non-center layers offset from the projection center by scale', () => {
    // A layer 100px left of the projection center (+x right) lands 100*scale
    // left of the viewport center, and 100px above-center lands above (scene
    // +y is up).
    const pos = sceneLayerCenter(860, 640, 1920, 1080, 1920, 1080);
    expect(pos.x).toBeCloseTo(860); // 960 - 100
    expect(pos.y).toBeCloseTo(440); // 540 - 100 (scene up → canvas up)
  });
});

// ---------------------------------------------------------------------------
// Real workshop verification (skipped when Wallpaper Engine isn't installed)
// ---------------------------------------------------------------------------

describe('scene HTML — real workshop scenes (parallax revival)', () => {
  it('every scene.pkg embeds the postMessage bridge and a working mousemove fallback', async () => {
    const WORKSHOP = await resolveWorkshopOrSkip();
    if (!WORKSHOP) return; // WE not installed — skip
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    let withBridge = 0;
    let total = 0;
    for (const d of dirs) {
      const pkgPath = `${WORKSHOP}/${d}/scene.pkg`;
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const html = renderSceneToHtml(pkgPath);
      if (!html) continue;
      total++;
      if (html.includes("window.addEventListener('message'") && html.includes('__agentskin')) {
        withBridge++;
      }
    }
    expect(withBridge).toBe(total);
  }, 120000);
});
