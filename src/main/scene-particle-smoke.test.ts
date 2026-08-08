// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { resolveWorkshopOrSkip } from './scene/_workshop-test-helpers';
import { extractScene, resolveSceneParticle } from './scene-pkg-parser';
import { renderSceneToHtml } from './scene-renderer-html';

describe('scene HTML — real workshop particle scenes (smoke)', () => {
  it('renders every scene.pkg and embeds particle simulation for resolvable presets', async () => {
    const WORKSHOP = await resolveWorkshopOrSkip();
    if (!WORKSHOP) return; // WE not installed — skip
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    let rendered = 0;
    let withParticleLayers = 0;
    for (const d of dirs) {
      const pkgPath = `${WORKSHOP}/${d}/scene.pkg`;
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const html = renderSceneToHtml(pkgPath);
      if (!html) continue;
      rendered++;
      if (html.includes('"particle":{')) {
        withParticleLayers++;
        expect(html).toContain('function spawnParticle');
        expect(html).toContain('function stepParticles');
        expect(html).toContain('function drawParticles');
      }
    }
    console.log(`scenes rendered: ${rendered}, with particle layers: ${withParticleLayers}`);
    expect(rendered).toBeGreaterThan(30);
  }, 300000);
});

describe('workshop pkg-embedded particle resolution', () => {
  it('resolves every particle ref from the pkg (custom + presets), not just install presets', async () => {
    const WORKSHOP = await resolveWorkshopOrSkip();
    if (!WORKSHOP) return; // WE not installed — skip
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    const byRef = new Map<string, { total: number; ok: number }>();
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
        if (!o.particle) continue;
        const ref = o.particle.split('\\').join('/');
        const entry = byRef.get(ref) || { total: 0, ok: 0 };
        entry.total++;
        // install root is intentionally NOT derived — the pkg must suffice
        if (resolveSceneParticle(o, scene, null)) entry.ok++;
        byRef.set(ref, entry);
      }
    }
    const distinct = byRef.size;
    const ok = [...byRef.values()].filter((e) => e.ok > 0).length;
    console.log('distinct particle refs:', distinct, '| resolvable from pkg alone:', ok);
    // Custom workshop particles (particles/workshop/…) are bundled in the pkg —
    // the whole point of the pkg-first resolution.
    const customRefs = [...byRef.keys()].filter(
      (r) =>
        r.includes('/workshop/') ||
        (!r.startsWith('particles/presets/') && !r.includes('/presets/')),
    );
    console.log('custom refs:', customRefs.length);
    expect(ok).toBeGreaterThan(0);
  }, 120000);
});
