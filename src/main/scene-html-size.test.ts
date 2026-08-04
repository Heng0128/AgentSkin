// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { renderSceneToHtml } from './scene-renderer-html';

const WORKSHOP = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';

describe('scene HTML size after texture cap (real workshop data)', () => {
  it('renders every scene and reports HTML + estimated decode memory', async () => {
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(WORKSHOP);
    let totalHtml = 0;
    let scenes = 0;
    const rows: string[] = [];
    for (const d of dirs) {
      const pkgPath = WORKSHOP + '/' + d + '/scene.pkg';
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const html = renderSceneToHtml(pkgPath);
      if (!html) continue;
      scenes++;
      totalHtml += html.length;
      rows.push(d + ': ' + (html.length / 1048576).toFixed(1) + 'MB');
    }
    rows.sort((a, b) => parseFloat(b.split(': ')[1]) - parseFloat(a.split(': ')[1]));
    console.log(
      'scenes rendered: ' + scenes + ', total HTML: ' + (totalHtml / 1048576).toFixed(0) + 'MB',
    );
    console.log('largest: ' + rows.slice(0, 8).join(' | '));
    expect(scenes).toBeGreaterThan(30);
  }, 300000);
});
