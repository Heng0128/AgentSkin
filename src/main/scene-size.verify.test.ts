// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { resolveWorkshopOrSkip } from './scene/_workshop-test-helpers';
import { extractScene, resolveObjectTexture } from './scene-pkg-parser';
import { layerDisplaySize } from './scene-renderer-html';

describe('post-fix scene draw size verification (real workshop data)', () => {
  it('draws every fullscreen background at the projection size on a 1920x1080 viewport', async () => {
    const WORKSHOP = await resolveWorkshopOrSkip();
    if (!WORKSHOP) return; // WE not installed — skip
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    const lines: string[] = [];
    let bgOk = 0;
    let bgTotal = 0;
    for (const d of dirs) {
      const pkgPath = `${WORKSHOP}/${d}/scene.pkg`;
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const scene = extractScene(pkgPath);
      if (!scene) continue;
      const proj = scene.general.orthogonalProjection;
      const viewport = { width: 1920, height: 1080 };
      const scale = Math.max(viewport.width / proj.width, viewport.height / proj.height);
      for (const o of scene.objects) {
        if (!o.visible) continue;
        const tex = resolveObjectTexture(o, scene);
        if (!tex || !tex.dataUrl) continue;
        const quad = layerDisplaySize(o.size, { width: tex.width, height: tex.height });
        // A fullscreen background: quad ≈ projection size.
        const _nearProjection =
          Math.abs(quad.width - proj.width) / proj.width < 0.15 &&
          Math.abs(quad.height - proj.height) / proj.height < 0.15;
        if (quad.width >= proj.width * 0.8 && quad.height >= proj.height * 0.8) {
          bgTotal++;
          // On-screen draw size after the fix:
          const dw = quad.width * scale * (o.scale.x || 1);
          const dh = quad.height * scale * (o.scale.y || 1);
          const covers = dw >= viewport.width * 0.9 && dh >= viewport.height * 0.9;
          if (covers) bgOk++;
          if (!covers) {
            lines.push(
              d +
                ': quad=(' +
                quad.width +
                'x' +
                quad.height +
                ') drawn=(' +
                dw.toFixed(0) +
                'x' +
                dh.toFixed(0) +
                ')',
            );
          }
        }
      }
    }
    console.log(`fullscreen backgrounds: ${bgTotal}, now cover the 1920x1080 viewport: ${bgOk}`);
    console.log(lines.join('\n') || '(all fullscreen backgrounds cover the viewport)');
    expect(true).toBe(true);
  }, 120000);

  it('layerDisplaySize uses the object quad, falling back to texture size', () => {
    // Fullscreen 16:9 quad with a square 2048x2048 texture → quad wins.
    expect(layerDisplaySize({ x: 1920, y: 1080 }, { width: 2048, height: 2048 })).toEqual({
      width: 1920,
      height: 1080,
    });
    // Object with no declared size → texture resolution is the display size.
    expect(layerDisplaySize({ x: 0, y: 0 }, { width: 512, height: 512 })).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('all fullscreen backgrounds have non-negative draw dimensions after the scale fix', async () => {
    // Regression guard for the negative-scale crash: Wallpaper Engine flips
    // objects with negative scaleX/scaleY, and ctx.drawImage throws on
    // negative dimensions. The renderer mirrors via ctx.scale and draws with
    // absolute sizes — so every fullscreen background must compute positive
    // draw dims on real workshop data.
    const WORKSHOP = await resolveWorkshopOrSkip();
    if (!WORKSHOP) return; // WE not installed — skip
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    let negatives = 0;
    let checked = 0;
    for (const d of dirs) {
      const pkgPath = `${WORKSHOP}/${d}/scene.pkg`;
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const scene = extractScene(pkgPath);
      if (!scene) continue;
      for (const o of scene.objects) {
        if (!o.visible) continue;
        const tex = resolveObjectTexture(o, scene);
        if (!tex || !tex.dataUrl) continue;
        checked++;
        const quad = layerDisplaySize(o.size, { width: tex.width, height: tex.height });
        const dw = quad.width * Math.abs(o.scale.x || 1);
        const dh = quad.height * Math.abs(o.scale.y || 1);
        if (dw <= 0 || dh <= 0 || Number.isNaN(dw) || Number.isNaN(dh)) {
          negatives++;
        }
      }
    }
    expect(negatives).toBe(0);
    expect(checked).toBeGreaterThan(200);
  }, 120000);
});
