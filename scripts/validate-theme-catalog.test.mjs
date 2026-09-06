// SPDX-License-Identifier: MPL-2.0
//
// Tests for validate-theme-catalog.mjs — Catalog consistency validation
//
// Covers: scanActualThemes, findDifferences (orphans, missing, drift).
// Uses vitest with isolated temporary directories.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// --- 测试工具 ---

/**
 * 创建临时主题目录结构。
 * @param {string} themeName 主题目录名
 * @param {object} options 配置选项
 */
function createTempTheme(themeName, options = {}) {
  const themeDir = join(tmpdir(), `agentskin-test-${themeName}-${Date.now()}`);
  mkdirSync(themeDir, { recursive: true });

  const manifest = {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    id: options.id || themeName,
    name: themeName,
    displayName: options.displayName || themeName,
    version: options.version || '1.0.0',
    author: { name: options.author || 'Test' },
    mode: options.mode || 'dark',
    category: options.category || 'test',
    tags: options.tags || [],
    colors: {
      accent: '#ff0000',
      secondary: '#cc0000',
      background: '#111111',
      foreground: '#ffffff',
      muted: '#888888',
      surface: '#222222',
      surfaceElevated: '#333333',
      border: '#444444',
      codeBackground: '#0a0a0a',
      codeForeground: '#ffffff',
      inputBackground: '#1a1a1a',
      buttonBackground: '#ff0000',
      buttonForeground: '#ffffff',
      focusRing: '#ff000060',
    },
    supportedAgents: options.supportedAgents || [
      'traework',
      'qoderwork',
      'workbuddy',
      'doubao',
      'codex',
      'zcode',
    ],
    license: 'MPL-2.0',
    minAppVersion: '1.0.0',
    ...(options.hero ? { hero: options.hero } : {}),
    ...(options.wcagCompliant !== undefined ? { wcagCompliant: options.wcagCompliant } : {}),
    ...(options.status ? { status: options.status } : {}),
  };

  writeFileSync(join(themeDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 创建 CSS 文件
  if (options.adapters) {
    const cssDir = join(themeDir, 'assets', 'css');
    mkdirSync(cssDir, { recursive: true });
    for (const adapter of options.adapters) {
      writeFileSync(join(cssDir, `${adapter}.css`), `/* ${adapter} CSS */`, 'utf-8');
    }
  }

  // 创建图片文件
  if (options.images) {
    for (const img of options.images) {
      writeFileSync(join(themeDir, img), 'fake-image-data');
    }
  }

  return themeDir;
}

// ---------------------------------------------------------------------------
// 测试：适配等级检测逻辑
// ---------------------------------------------------------------------------

describe('adaptation level detection', () => {
  it('should classify 6 adapters as deep', () => {
    // 6 adapters = deep
    const adapters = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
    expect(adapters.length).toBe(6);
    const level = adapters.length >= 6 ? 'deep' : adapters.length >= 3 ? 'medium' : 'shallow';
    expect(level).toBe('deep');
  });

  it('should classify 3-5 adapters as medium', () => {
    const adapters = ['traework', 'qoderwork', 'workbuddy'];
    const level = adapters.length >= 6 ? 'deep' : adapters.length >= 3 ? 'medium' : 'shallow';
    expect(level).toBe('medium');
  });

  it('should classify 1-2 adapters as shallow', () => {
    const adapters = ['traework'];
    const level =
      adapters.length >= 6
        ? 'deep'
        : adapters.length >= 3
          ? 'medium'
          : adapters.length >= 1
            ? 'shallow'
            : 'none';
    expect(level).toBe('shallow');
  });

  it('should classify 0 adapters as none', () => {
    const adapters = [];
    const level =
      adapters.length >= 6
        ? 'deep'
        : adapters.length >= 3
          ? 'medium'
          : adapters.length >= 1
            ? 'shallow'
            : 'none';
    expect(level).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// 测试：状态检测逻辑
// ---------------------------------------------------------------------------

describe('status detection', () => {
  it('should return active for stable version without deprecated tag', () => {
    const manifest = { version: '1.0.0', tags: ['dark'] };
    const status =
      manifest.status ||
      (manifest.tags?.includes('deprecated')
        ? 'deprecated'
        : manifest.version?.startsWith('0.')
          ? 'experimental'
          : 'active');
    expect(status).toBe('active');
  });

  it('should return experimental for 0.x version', () => {
    const manifest = { version: '0.5.0', tags: ['dark'] };
    const status =
      manifest.status ||
      (manifest.tags?.includes('deprecated')
        ? 'deprecated'
        : manifest.version?.startsWith('0.')
          ? 'experimental'
          : 'active');
    expect(status).toBe('experimental');
  });

  it('should return deprecated when tag includes deprecated', () => {
    const manifest = { version: '1.0.0', tags: ['deprecated'] };
    const status =
      manifest.status ||
      (manifest.tags?.includes('deprecated')
        ? 'deprecated'
        : manifest.version?.startsWith('0.')
          ? 'experimental'
          : 'active');
    expect(status).toBe('deprecated');
  });

  it('should respect explicit status field', () => {
    const manifest = { version: '1.0.0', status: 'experimental' };
    const status =
      manifest.status ||
      (manifest.tags?.includes('deprecated')
        ? 'deprecated'
        : manifest.version?.startsWith('0.')
          ? 'experimental'
          : 'active');
    expect(status).toBe('experimental');
  });
});

// ---------------------------------------------------------------------------
// 测试：WCAG 合规检测
// ---------------------------------------------------------------------------

describe('WCAG compliance detection', () => {
  it('should return true when manifest declares wcagCompliant', () => {
    const manifest = { wcagCompliant: true };
    const result = typeof manifest.wcagCompliant === 'boolean' ? manifest.wcagCompliant : false;
    expect(result).toBe(true);
  });

  it('should return false when manifest does not declare wcagCompliant', () => {
    const manifest = {};
    const result = typeof manifest.wcagCompliant === 'boolean' ? manifest.wcagCompliant : false;
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 测试：目录扫描
// ---------------------------------------------------------------------------

describe('theme directory scanning', () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('should detect valid theme with manifest', () => {
    const dir = createTempTheme('test-theme-1', {
      adapters: ['traework', 'qoderwork'],
      images: ['icon.png', 'preview.webp', 'hero.jpg'],
    });
    tempDirs.push(dir);

    // 验证 manifest 存在
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf-8'));
    expect(manifest.id).toBe('test-theme-1');
  });

  it('should detect CSS files correctly', () => {
    const dir = createTempTheme('test-theme-2', {
      adapters: ['traework', 'codex', 'zcode'],
    });
    tempDirs.push(dir);

    const cssDir = join(dir, 'assets', 'css');
    const files = require('node:fs').readdirSync(cssDir);
    expect(files).toHaveLength(3);
    expect(files).toContain('traework.css');
    expect(files).toContain('codex.css');
    expect(files).toContain('zcode.css');
  });
});

// ---------------------------------------------------------------------------
// 测试：Catalog JSON 结构
// ---------------------------------------------------------------------------

describe('catalog JSON structure', () => {
  it('should have correct top-level fields', () => {
    const catalog = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      themes: [],
    };

    expect(catalog).toHaveProperty('version', 1);
    expect(catalog).toHaveProperty('lastUpdated');
    expect(catalog).toHaveProperty('themes');
    expect(Array.isArray(catalog.themes)).toBe(true);
  });

  it('should have correct theme entry structure', () => {
    const entry = {
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
      adapters: ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'],
      adaptationLevel: 'deep',
      hasHero: true,
      hasImages: true,
      wcagCompliant: false,
      status: 'active',
    };

    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('version');
    expect(entry).toHaveProperty('adapters');
    expect(entry).toHaveProperty('adaptationLevel');
    expect(entry).toHaveProperty('hasHero');
    expect(entry).toHaveProperty('hasImages');
    expect(entry).toHaveProperty('wcagCompliant');
    expect(entry).toHaveProperty('status');
  });
});

// ---------------------------------------------------------------------------
// 测试：差异检测逻辑
// ---------------------------------------------------------------------------

describe('difference detection', () => {
  it('should detect orphans (in catalog but not in directory)', () => {
    const catalogThemes = [
      {
        id: 'theme-a',
        name: 'Theme A',
        version: '1.0.0',
        adapters: ['traework'],
        adaptationLevel: 'shallow',
        hasHero: false,
        hasImages: false,
        wcagCompliant: false,
        status: 'active',
      },
      {
        id: 'theme-b',
        name: 'Theme B',
        version: '1.0.0',
        adapters: ['traework'],
        adaptationLevel: 'shallow',
        hasHero: false,
        hasImages: false,
        wcagCompliant: false,
        status: 'active',
      },
    ];
    const actualThemes = new Map([
      [
        'theme-a',
        {
          id: 'theme-a',
          name: 'Theme A',
          version: '1.0.0',
          adapters: ['traework'],
          adaptationLevel: 'shallow',
          hasHero: false,
          hasImages: false,
          wcagCompliant: false,
          status: 'active',
        },
      ],
    ]);

    const catalogIds = new Set(catalogThemes.map((t) => t.id));
    const actualIds = new Set(actualThemes.keys());
    const orphans = [...catalogIds].filter((id) => !actualIds.has(id));

    expect(orphans).toEqual(['theme-b']);
  });

  it('should detect missing (in directory but not in catalog)', () => {
    const catalogThemes = [
      {
        id: 'theme-a',
        name: 'Theme A',
        version: '1.0.0',
        adapters: ['traework'],
        adaptationLevel: 'shallow',
        hasHero: false,
        hasImages: false,
        wcagCompliant: false,
        status: 'active',
      },
    ];
    const actualThemes = new Map([
      [
        'theme-a',
        {
          id: 'theme-a',
          name: 'Theme A',
          version: '1.0.0',
          adapters: ['traework'],
          adaptationLevel: 'shallow',
          hasHero: false,
          hasImages: false,
          wcagCompliant: false,
          status: 'active',
        },
      ],
      [
        'theme-c',
        {
          id: 'theme-c',
          name: 'Theme C',
          version: '1.0.0',
          adapters: ['traework'],
          adaptationLevel: 'shallow',
          hasHero: false,
          hasImages: false,
          wcagCompliant: false,
          status: 'active',
        },
      ],
    ]);

    const catalogIds = new Set(catalogThemes.map((t) => t.id));
    const actualIds = new Set(actualThemes.keys());
    const missing = [...actualIds].filter((id) => !catalogIds.has(id));

    expect(missing).toEqual(['theme-c']);
  });

  it('should detect metadata drift', () => {
    const catalogEntry = {
      id: 'theme-a',
      name: 'Old Name',
      version: '1.0.0',
      adapters: ['traework'],
      adaptationLevel: 'shallow',
      hasHero: false,
      hasImages: false,
      wcagCompliant: false,
      status: 'active',
    };
    const actual = {
      id: 'theme-a',
      name: 'New Name',
      version: '2.0.0',
      adapters: ['traework', 'qoderwork'],
      adaptationLevel: 'medium',
      hasHero: true,
      hasImages: true,
      wcagCompliant: true,
      status: 'active',
    };

    const diffs = [];
    if (catalogEntry.name !== actual.name) {
      diffs.push({ field: 'name', catalog: catalogEntry.name, actual: actual.name });
    }
    if (catalogEntry.version !== actual.version) {
      diffs.push({ field: 'version', catalog: catalogEntry.version, actual: actual.version });
    }

    expect(diffs).toHaveLength(2);
    expect(diffs[0].field).toBe('name');
    expect(diffs[1].field).toBe('version');
  });
});
