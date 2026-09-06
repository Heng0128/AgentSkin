// SPDX-License-Identifier: MPL-2.0
/**
 * V3 主题库存完整性测试（2026-09-03 V3 cutover 建立）。
 *
 * 加载仓库内 themes/ 的全部主题包并断言：
 *   - 每个 manifest.json 目录都能通过 ThemePackageLoader（零校验错误）
 *   - 每个包都是 V3 形态
 *   - apps 中每个 agent 都有 overrides/<app>.css 且非空（16 个迁移主题的 CSS 落点）
 *
 * 守护目标：任何未来新增主题若非 V3 / overrides 缺失 / CSS 为空 → 立即红灯。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isV3ManifestShape } from './theme-manifest';
import { ThemePackageLoader } from './theme-package-loader';

const THEMES_DIR = path.resolve(__dirname, '../../../themes');

describe('v3 theme inventory integrity', () => {
  it('loads every theme package with zero validation errors, all v3, css intact', async () => {
    const manifestDirs = fs
      .readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => fs.existsSync(path.join(THEMES_DIR, n, 'manifest.json')));

    expect(manifestDirs.length).toBeGreaterThan(0);

    // 逐个 load，暴露 scan() 以 warn 吞掉的校验失败。
    const loader = new ThemePackageLoader(THEMES_DIR);
    const failures: string[] = [];
    const loaded = [];
    for (const id of manifestDirs) {
      try {
        loaded.push(await loader.load(id));
      } catch (e) {
        failures.push(`${id}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);

    for (const pkg of loaded) {
      expect(isV3ManifestShape(pkg.manifest)).toBe(true);
      const overrides = pkg.manifest.overrides;
      if (overrides && Object.keys(overrides).length > 0) {
        // 迁移主题：apps 的每个 agent 都必须有非空 overrides CSS
        for (const app of Array.isArray(pkg.manifest.apps) ? pkg.manifest.apps : []) {
          const rel = overrides[app];
          expect(rel, `${pkg.manifest.id}/overrides.${app}`).toBeTruthy();
          const f = fs.readFileSync(path.join(pkg.packagePath, rel), 'utf8');
          expect(f.length).toBeGreaterThan(50);
        }
      } else {
        // 纯语义主题（sakura 型）：theme.css 必须存在
        const rel = pkg.manifest.themeCss || 'theme.css';
        expect(fs.existsSync(path.join(pkg.packagePath, rel))).toBe(true);
      }
    }
  }, 30000);
});
