// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const THEMES_DIR = join(process.cwd(), 'themes');

/**
 * 14 个必需颜色令牌（对应 THEME_SPEC.md colors 规范）
 */
const REQUIRED_COLOR_TOKENS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
] as const;

/**
 * targets 中引用的全部 Agent
 */
const EXPECTED_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;

interface Manifest {
  schemaVersion: number;
  id: string;
  name: string;
  displayName: string;
  version: string;
  colors: Record<string, string>;
  targets: Record<string, { css: string }>;
  supportedAgents?: string[];
  mode?: string;
  [key: string]: unknown;
}

/**
 * 安全读取并解析 manifest.json
 */
function readManifest(themeId: string): Manifest {
  const path = join(THEMES_DIR, themeId, 'manifest.json');
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Manifest;
}

/**
 * 递归获取所有子目录中的主题 ID（目录含 manifest.json）
 */
function getAllThemeIds(): string[] {
  if (!existsSync(THEMES_DIR)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(THEMES_DIR)) {
    const full = join(THEMES_DIR, entry);
    if (statSync(full).isDirectory()) {
      if (existsSync(join(full, 'manifest.json'))) {
        ids.push(entry);
      }
    }
  }
  return ids;
}

describe('Theme Pipeline E2E', () => {
  const availableThemes = existsSync(THEMES_DIR) ? getAllThemeIds() : [];

  beforeAll(() => {
    if (availableThemes.length === 0) {
      console.warn(`themes/ directory not found at ${THEMES_DIR}, skipping all assertions`);
    }
  });

  afterAll(() => {
    // 幂等测试：仅读取文件，无清理操作
  });

  // 前置守卫：themes 目录缺失时 skip
  if (availableThemes.length === 0) {
    it('themes directory available — skipped (not found)', () => {
      console.warn('SKIP: themes/ directory does not exist');
    });
    return;
  }

  describe('1. aurora-glass manifest 包含 14 个必需 token', () => {
    it('should contain all 14 required color tokens', () => {
      const manifest = readManifest('aurora-glass');
      for (const token of REQUIRED_COLOR_TOKENS) {
        expect(manifest.colors[token], `Missing color token: ${token}`).toBeDefined();
        expect(typeof manifest.colors[token]).toBe('string');
        expect(manifest.colors[token].length).toBeGreaterThan(0);
      }
    });
  });

  describe('2. aurora-glass CSS 文件存在', () => {
    it('should have CSS files for all 6 agents', () => {
      const manifest = readManifest('aurora-glass');
      for (const agent of EXPECTED_AGENTS) {
        const relPath: string | undefined = manifest.targets[agent]?.css;
        expect(relPath, `targets.${agent}.css missing`).toBeDefined();
        const cssPath = join(THEMES_DIR, 'aurora-glass', relPath!);
        expect(existsSync(cssPath), `CSS file missing: ${cssPath}`).toBe(true);
      }
    });
  });

  describe('3. CSS 文件包含 --agentskin-accent 变量', () => {
    it('should declare --agentskin-accent in traework.css', () => {
      const cssPath = join(THEMES_DIR, 'aurora-glass', 'assets', 'css', 'traework.css');
      const css = readFileSync(cssPath, 'utf-8');
      expect(css).toContain('--agentskin-accent:');
    });

    it('should declare --agentskin-accent for every agent CSS', () => {
      const manifest = readManifest('aurora-glass');
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, 'aurora-glass', relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        expect(css, `Agent ${agent} CSS missing --agentskin-accent`).toContain('--agentskin-accent:');
      }
    });
  });

  describe('4. CSS 文件包含 --agentskin-bg 变量', () => {
    it('should declare --agentskin-bg in traework.css', () => {
      const cssPath = join(THEMES_DIR, 'aurora-glass', 'assets', 'css', 'traework.css');
      const css = readFileSync(cssPath, 'utf-8');
      expect(css).toContain('--agentskin-bg:');
    });

    it('should declare --agentskin-bg for every agent CSS', () => {
      const manifest = readManifest('aurora-glass');
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, 'aurora-glass', relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        expect(css, `Agent ${agent} CSS missing --agentskin-bg`).toContain('--agentskin-bg:');
      }
    });
  });

  describe('5. CSS 文件包含 color-scheme 声明', () => {
    it('should declare color-scheme in aurora-glass/traework.css', () => {
      const cssPath = join(THEMES_DIR, 'aurora-glass', 'assets', 'css', 'traework.css');
      const css = readFileSync(cssPath, 'utf-8');
      expect(css).toMatch(/color-scheme:\s*(dark|light)\s*(!important)?;/);
    });

    it('should declare color-scheme for all agents', () => {
      const manifest = readManifest('aurora-glass');
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, 'aurora-glass', relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        expect(css, `Agent ${agent} CSS missing color-scheme`).toMatch(/color-scheme:\s*(dark|light)\s*(!important)?;/);
      }
    });
  });

  describe('6. 所有主题目录都有 manifest.json', () => {
    it('every subdirectory of themes/ must contain manifest.json', () => {
      for (const dir of readdirSync(THEMES_DIR)) {
        const full = join(THEMES_DIR, dir);
        if (!statSync(full).isDirectory()) continue;
        expect(
          existsSync(join(full, 'manifest.json')),
          `Theme "${dir}" missing manifest.json`,
        ).toBe(true);
      }
    });
  });

  describe('7. manifest.json 符合 v2 schema', () => {
    it('all manifests must have schemaVersion === 2', () => {
      for (const themeId of availableThemes) {
        const manifest = readManifest(themeId);
        expect(manifest.schemaVersion, `"${themeId}" schemaVersion mismatch`).toBe(2);
      }
    });

    it('all manifests must have $schema pointing to v2', () => {
      for (const themeId of availableThemes) {
        const manifest = readManifest(themeId);
        expect(
          manifest.$schema,
          `"${themeId}" $schema missing or incorrect`,
        ).toContain('manifest-v2');
      }
    });
  });

  describe('8. CSS 文件非空且格式正确', () => {
    // 生成器允许两种合法的宿主选择器格式：
    //   - `:root {` / `:root.agentskin-host-<agent> {`（如 codex 用 :root 前缀挂载）
    //   - `html.agentskin-host-<agent> {`（如 traework / doubao 等用 html 前缀挂载）
    const HOST_SELECTOR = /(?::root(?:\.agentskin-host-\w+)?|html\.agentskin-host-\w+)\s*\{/;

    it('traework.css should not be empty and contain a host/:root block', () => {
      const cssPath = join(THEMES_DIR, 'aurora-glass', 'assets', 'css', 'traework.css');
      const css = readFileSync(cssPath, 'utf-8');
      expect(css.length).toBeGreaterThan(0);
      expect(css).toMatch(HOST_SELECTOR);
    });

    it('every agent CSS for aurora-glass should be non-empty with host/:root block', () => {
      const manifest = readManifest('aurora-glass');
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, 'aurora-glass', relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        expect(css.length, `Agent ${agent} CSS is empty`).toBeGreaterThan(0);
        expect(css, `Agent ${agent} CSS missing :root or host selector`).toMatch(HOST_SELECTOR);
      }
    });

    it('every agent CSS for aurora-dusk should be non-empty with host/:root block', () => {
      if (!availableThemes.includes('aurora-dusk')) return;
      const manifest = readManifest('aurora-dusk');
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, 'aurora-dusk', relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        expect(css.length, `Agent ${agent} CSS is empty`).toBeGreaterThan(0);
        expect(css, `Agent ${agent} CSS missing :root or host selector`).toMatch(HOST_SELECTOR);
      }
    });
  });
});
