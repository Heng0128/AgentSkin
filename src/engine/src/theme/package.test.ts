// SPDX-License-Identifier: MPL-2.0

/**
 * package.mjs 主题包门禁单测（RFC themes-asset-injection-2a §2.3）
 *
 * 覆盖 B 线引擎对多资产注入的数量/累计体积/类型/id 门禁：
 *   - MAX_THEME_IMAGES = 32       数量上限
 *   - MAX_THEME_IMAGE_BASE64 = 8MB 累计 base64 体积上限
 *   - SAFE_IMAGE_TYPES             支持 png/jpeg/webp/gif
 *   - assets.art 与 assets.images.hero 冲突互斥
 *
 * 纯函数验证——无 DOM / CDP 依赖。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildThemePackage,
  MAX_THEME_IMAGE_BASE64,
  MAX_THEME_IMAGES,
  readThemePackage,
  resolveThemeTarget,
  SAFE_IMAGE_TYPES,
  validateThemePackage,
} from './package.mjs';

/** A valid tiny base64 (1x1 transparent PNG) reused for every asset slot. */
const ONE_PX_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function image(name: string) {
  return { filename: `${name}.png`, mimeType: 'image/png', base64: ONE_PX_PNG };
}

/** A minimal bundle that passes every non-asset rule of validateThemePackage. */
function minimalBundle(assets: Record<string, unknown> = {}) {
  return {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: { id: 'gate-test', displayName: 'Gate Test', version: '1.0.0' },
    targets: { codex: { css: ':root { color: red; }' } },
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}

describe('MAX_THEME_IMAGES = 32 quantity gate', () => {
  it('accepts exactly 32 image entries', () => {
    const images: Record<string, unknown> = {};
    for (let i = 0; i < MAX_THEME_IMAGES; i += 1) images[`img${i}`] = image(`img${i}`);
    expect(() => validateThemePackage(minimalBundle({ images }))).not.toThrow();
  });

  it('rejects more than 32 image entries', () => {
    const images: Record<string, unknown> = {};
    for (let i = 0; i < MAX_THEME_IMAGES + 1; i += 1) images[`img${i}`] = image(`img${i}`);
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      `assets.images exceeds ${MAX_THEME_IMAGES} entries`,
    );
  });

  it('rejects an empty images object', () => {
    expect(() => validateThemePackage(minimalBundle({ images: {} }))).toThrow(
      'assets.images must not be empty when provided',
    );
  });
});

describe('MAX_THEME_IMAGE_BASE64 = 8MB cumulative volume gate', () => {
  it('rejects cumulative base64 beyond the 8MB ceiling', () => {
    // 32 entries whose cumulative base64 clears 8MB must trip the gate.
    // Per-entry size must be a multiple of 4 so the BASE64 shape check passes
    // first and the cumulative volume check is the one that throws.
    const perEntry = Math.ceil((MAX_THEME_IMAGE_BASE64 + 1) / 32 / 4) * 4;
    const chunk = 'A'.repeat(perEntry);
    const images: Record<string, unknown> = {};
    for (let i = 0; i < 32; i += 1) {
      images[`big${i}`] = {
        filename: `big${i}.png`,
        mimeType: 'image/png',
        base64: chunk, // 32 * perEntry >= 8MB + 1
      };
    }
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      `assets.images cumulative base64 exceeds ${MAX_THEME_IMAGE_BASE64} bytes`,
    );
  });

  it('accepts cumulative base64 at or under the 8MB ceiling', () => {
    const perEntry = Math.floor(MAX_THEME_IMAGE_BASE64 / 32);
    const images: Record<string, unknown> = {};
    for (let i = 0; i < 32; i += 1) {
      images[`ok${i}`] = {
        filename: `ok${i}.png`,
        mimeType: 'image/png',
        base64: 'A'.repeat(perEntry),
      };
    }
    expect(() => validateThemePackage(minimalBundle({ images }))).not.toThrow();
  });

  it('enforces the 8MB ceiling on the deprecated assets.art hero too', () => {
    expect(() =>
      validateThemePackage(
        minimalBundle({
          art: {
            filename: 'hero.png',
            mimeType: 'image/png',
            base64: 'A'.repeat(MAX_THEME_IMAGE_BASE64 + 4), // valid multiple-of-4 base64, just past 8MB
          },
        }),
      ),
    ).toThrow(`assets.art base64 exceeds ${MAX_THEME_IMAGE_BASE64} bytes`);
  });
});

describe('per-asset validation', () => {
  it('accepts the three legal base64 padding forms', () => {
    // "==" (core % 4 === 3), "=" (core % 4 === 2), and bare (core % 4 === 0).
    const valid = ['QUJD', 'QUJDRA==', 'QUJDREU='];
    for (const base64 of valid) {
      expect(() =>
        validateThemePackage(
          minimalBundle({ images: { hero: { filename: 'hero.png', mimeType: 'image/png', base64 } } }),
        ),
      ).not.toThrow();
    }
  });

  it('rejects malformed padding', () => {
    // 4k+1 core ("A" + 3 pad is never legal) and a stray middle "=" must fail.
    for (const base64 of ['A===', 'QUJD=', 'QU==JD']) {
      expect(() =>
        validateThemePackage(
          minimalBundle({ images: { hero: { filename: 'hero.png', mimeType: 'image/png', base64 } } }),
        ),
      ).toThrow('must contain valid Base64 data');
    }
  });

  it('rejects an unsafe image id', () => {
    const images = { '../evil': image('evil'), 'with space': image('space'), 'UPPER-OK': image('upper') };
    // ../evil and with space are invalid; UPPER-OK is fine but order matters — first invalid throws.
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      "assets.images contains invalid image id '",
    );
  });

  it('rejects unsupported mime types', () => {
    expect(SAFE_IMAGE_TYPES).toEqual(new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']));
    const images = {
      bad: { filename: 'bad.svg', mimeType: 'image/svg+xml', base64: 'PHN2Zz48L3N2Zz4=' },
    };
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      "assets.images.bad.mimeType 'image/svg+xml' is not supported",
    );
  });

  it('rejects a non-basename filename', () => {
    const images = { hero: { filename: 'dir/hero.png', mimeType: 'image/png', base64: ONE_PX_PNG } };
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      'assets.images.hero.filename must be a safe basename',
    );
  });

  it('rejects invalid base64 payloads', () => {
    const images = { hero: { filename: 'hero.png', mimeType: 'image/png', base64: 'not base64 !!!' } };
    expect(() => validateThemePackage(minimalBundle({ images }))).toThrow(
      'assets.images.hero.base64 must contain valid Base64 data',
    );
  });
});

describe('assets.art vs assets.images.hero mutual exclusion', () => {
  it('rejects a bundle combining both', () => {
    expect(() =>
      validateThemePackage(
        minimalBundle({
          art: image('art'),
          images: { hero: image('hero') },
        }),
      ),
    ).toThrow('assets.art cannot be combined with assets.images.hero');
  });

  it('accepts images.hero alone (2a canonical form)', () => {
    expect(() => validateThemePackage(minimalBundle({ images: { hero: image('hero') } }))).not.toThrow();
  });

  it('accepts assets.art alone (deprecated form)', () => {
    expect(() => validateThemePackage(minimalBundle({ art: image('art') }))).not.toThrow();
  });
});

describe('REMOTE_CSS guard on target css (P-regression: data URIs)', () => {
  it('accepts a quoted inline data: URI in target css', () => {
    expect(() =>
      validateThemePackage({
        ...minimalBundle({}),
        targets: { codex: { css: '--logo: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");' } },
      }),
    ).not.toThrow();
  });

  it('accepts an unquoted inline data: URI in target css', () => {
    expect(() =>
      validateThemePackage({
        ...minimalBundle({}),
        targets: { codex: { css: '--logo: url(data:image/png;base64,abc123);' } },
      }),
    ).not.toThrow();
  });

  it('rejects a relative path url() in target css', () => {
    expect(() =>
      validateThemePackage({
        ...minimalBundle({}),
        targets: { codex: { css: '--art: url("./assets/artwork.jpg");' } },
      }),
    ).toThrow("Target 'codex' contains an external CSS resource.");
  });

  it('rejects an http(s) url() in target css', () => {
    expect(() =>
      validateThemePackage({
        ...minimalBundle({}),
        targets: { codex: { css: 'background: url(https://example.com/bg.png);' } },
      }),
    ).toThrow("Target 'codex' contains an external CSS resource.");
  });

  it('rejects @import in target css', () => {
    expect(() =>
      validateThemePackage({
        ...minimalBundle({}),
        targets: { codex: { css: '@import url("theme.css");' } },
      }),
    ).toThrow("Target 'codex' contains an external CSS resource.");
  });
});

describe('resolveThemeTarget exposes every image as a data URL', () => {
  it('maps hero + creative ids onto --agentskin-asset-<id> consumers', () => {
    const bundle = validateThemePackage(
      minimalBundle({
        images: { hero: image('hero'), sidebar: image('sidebar'), mascot: image('mascot') },
      }),
    );
    const target = resolveThemeTarget(bundle, 'codex');
    expect(target.artDataUrl).toBe(`data:image/png;base64,${ONE_PX_PNG}`);
    expect(target.imageDataUrls).toEqual({
      hero: `data:image/png;base64,${ONE_PX_PNG}`,
      sidebar: `data:image/png;base64,${ONE_PX_PNG}`,
      mascot: `data:image/png;base64,${ONE_PX_PNG}`,
    });
  });

  it('falls back from deprecated assets.art to the hero slot', () => {
    const bundle = validateThemePackage(minimalBundle({ art: image('art') }));
    const target = resolveThemeTarget(bundle, 'codex');
    expect(target.artDataUrl).toBe(`data:image/png;base64,${ONE_PX_PNG}`);
    expect(target.imageDataUrls.hero).toBe(`data:image/png;base64,${ONE_PX_PNG}`);
  });
});

describe('decorations.layouts validation (RFC 2b §2.2)', () => {
  const layout = () => ({
    asset: 'mascot',
    anchor: '.conversation-sidebar',
    anchorPosition: 'topRight',
    offset: { x: 16, y: 16 },
    height: 60,
    zIndex: 10,
  });
  // `decorations` is a TOP-LEVEL bundle field (sibling of `assets`), mirroring
  // the source manifest shape buildThemePackage emits.
  const bundles = () => validateThemePackage({
    ...minimalBundle(),
    assets: { images: { hero: image('hero'), mascot: image('mascot') } },
    decorations: { layouts: [layout()] },
  });

  it('accepts a valid decorations block referencing embedded image ids', () => {
    expect(() => bundles()).not.toThrow();
  });

  it('rejects an asset that is not in assets.images (dangling overlay)', () => {
    const bundle = bundles();
    bundle.decorations.layouts[0].asset = 'ghost';
    expect(() => validateThemePackage(bundle)).toThrow(
      "decorations.layouts[0].asset 'ghost' does not match any assets.images id",
    );
  });

  it('rejects an unknown anchorPosition five-grid enum', () => {
    const bundle = bundles();
    bundle.decorations.layouts[0].anchorPosition = 'rightTop';
    expect(() => validateThemePackage(bundle)).toThrow(
      'decorations.layouts[0].anchorPosition',
    );
  });

  it('rejects a duplicate asset across layouts', () => {
    const bundle = bundles();
    bundle.decorations.layouts.push({ asset: 'mascot', anchor: '.other' });
    expect(() => validateThemePackage(bundle)).toThrow(
      "contains duplicate asset 'mascot'",
    );
  });

  it('rejects more than 16 layouts', () => {
    const bundle = bundles();
    for (let i = 0; i < 16; i += 1) bundle.assets.images[`a${i}`] = image(`a${i}`);
    bundle.decorations = {
      layouts: Array.from({ length: 17 }, (_, i) => ({ asset: `a${i % 16}`, anchor: '.x' })),
    };
    expect(() => validateThemePackage(bundle)).toThrow(`decorations.layouts exceeds 16 entries`);
  });

  it('accepts null and the idle-fade/float motion presets (RFC 2b §2.4)', () => {
    const frozen = bundles();
    frozen.decorations.layouts[0].motion = 'idle-fade';
    expect(() => validateThemePackage(frozen)).not.toThrow();
    const float = bundles();
    float.decorations.layouts[0].motion = 'float';
    expect(() => validateThemePackage(float)).not.toThrow();
    const none = bundles();
    none.decorations.layouts[0].motion = null;
    expect(() => validateThemePackage(none)).not.toThrow();
  });

  it('rejects an unknown motion preset (complex pets defer to 2c)', () => {
    const bundle = bundles();
    bundle.decorations.layouts[0].motion = 'drag';
    expect(() => validateThemePackage(bundle)).toThrow(
      "decorations.layouts[0].motion 'drag' is not a supported preset",
    );
  });
});

describe('resolveThemeTarget exposes decorations (RFC 2b §2.3)', () => {
  it('passes the decorations config through to the injected target', () => {
    const bundle = validateThemePackage({
      ...minimalBundle(),
      assets: { images: { hero: image('hero'), mascot: image('mascot') } },
      decorations: {
        layouts: [{ asset: 'mascot', anchor: '.conversation-sidebar', zIndex: 10 }],
      },
    });
    const target = resolveThemeTarget(bundle, 'codex');
    expect(target.decorations?.layouts[0]).toMatchObject({
      asset: 'mascot',
      anchor: '.conversation-sidebar',
      zIndex: 10,
    });
  });

  it('defaults decorations to null when a bundle declares none', () => {
    const bundle = validateThemePackage(minimalBundle({ images: { hero: image('hero') } }));
    expect(resolveThemeTarget(bundle, 'codex').decorations).toBeNull();
  });
});

describe('buildThemePackage source-manifest gate', () => {
  it('merges art + images into hero + creative and enforces the quantity gate', async () => {
    const dir = path.join(process.cwd(), '.tmp-package-gate-test');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentskin-package-gate-'));
    try {
      const pngPath = path.join(root, 'hero.png');
      await writeFile(pngPath, Buffer.from(ONE_PX_PNG, 'base64'));
      await writeFile(
        path.join(root, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'src-gate',
          displayName: 'Src Gate',
          version: '1.0.0',
          art: 'hero.png',
          images: { sidebar: 'hero.png' },
          targets: { codex: { css: 'a.css' } },
        }),
      );
      await writeFile(path.join(root, 'a.css'), ':root { color: red; }');

      const { bundle } = await buildThemePackage(path.join(root, 'manifest.json'));
      expect(bundle.assets.images.hero.filename).toBe('hero.png');
      expect(bundle.assets.images.sidebar.filename).toBe('hero.png');
      expect(Object.keys(bundle.assets.images).sort()).toEqual(['hero', 'sidebar']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a source manifest with more than 32 images', async () => {
    const os = await import('node:os');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentskin-package-gate-'));
    try {
      await writeFile(path.join(root, 'hero.png'), Buffer.from(ONE_PX_PNG, 'base64'));
      const images: Record<string, string> = {};
      for (let i = 0; i <= MAX_THEME_IMAGES; i += 1) images[`img${i}`] = 'hero.png'; // 33 = 32 + 1
      await writeFile(
        path.join(root, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'src-gate-2',
          displayName: 'Src Gate 2',
          version: '1.0.0',
          images,
          targets: { codex: { css: 'a.css' } },
        }),
      );
      await writeFile(path.join(root, 'a.css'), ':root { color: red; }');
      await expect(buildThemePackage(path.join(root, 'manifest.json'))).rejects.toThrow(
        `Source manifest images exceeds ${MAX_THEME_IMAGES} entries`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('readThemePackage pipeline', () => {
  it('rejects a non-theme extension', async () => {
    await expect(readThemePackage('bundle.json')).rejects.toThrow('must use the .agentskin-theme extension');
  });
});
