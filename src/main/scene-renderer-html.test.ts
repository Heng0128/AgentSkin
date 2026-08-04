// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

const WORKSHOP = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';

describe('scene HTML — real workshop scenes (parallax revival)', () => {
  it('every scene.pkg embeds the postMessage bridge and a working mousemove fallback', async () => {
    const { readdir, access } = await import('node:fs/promises');
    let dirs: string[];
    try {
      dirs = await readdir(WORKSHOP);
    } catch {
      console.log('(Wallpaper Engine workshop not found — skipping real-scene check)');
      return;
    }
    let withBridge = 0;
    let total = 0;
    for (const d of dirs) {
      const pkgPath = WORKSHOP + '/' + d + '/scene.pkg';
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
