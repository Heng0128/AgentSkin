// SPDX-License-Identifier: MPL-2.0

/**
 * # Render-option → CSS mapping
 *
 * Two surfaces consume `WallpaperRenderOptions`:
 *   1. The CDP injectors (`src/main/cdp/wallpaper/shared.ts`) — applied to
 *      agent windows.
 *   2. The desktop UI background (`src/ui/lib/wallpaperRender.ts`) — the
 *      renderer-side twin.
 *
 * They derive from the same WE spec and MUST stay identical so "同一个壁纸
 * 在桌面 UI 和 agent 窗口效果一致". This suite pins both implementations and
 * asserts parity between them.
 */

import { describe, expect, it } from 'vitest';
import type { WallpaperRenderOptions } from '../../../shared/types';
import {
  buildMediaElementStyle,
  alignmentObjectFit as uiAlignmentObjectFit,
  buildFilter as uiBuildFilter,
  buildFlipTransform as uiBuildFlipTransform,
  buildObjectPosition as uiBuildObjectPosition,
  buildTintFilter as uiBuildTintFilter,
  hexHue as uiHexHue,
} from '../../../ui/lib/wallpaperRender';
import {
  alignmentObjectFit as cdpAlignmentObjectFit,
  buildFilter as cdpBuildFilter,
  buildFlipTransform as cdpBuildFlipTransform,
  buildMediaElementCss as cdpBuildMediaElementCss,
  buildObjectPosition as cdpBuildObjectPosition,
  buildTileContainerCss as cdpBuildTileContainerCss,
  buildTintFilter as cdpBuildTintFilter,
  hexHue as cdpHexHue,
} from './shared';

const RENDER: WallpaperRenderOptions = {
  alignment: 'fit',
  positionX: 10,
  positionY: -5,
  flipH: true,
  flipV: false,
  brightness: 115,
  contrast: 90,
  saturation: 130,
  hueRotate: -20,
  sepia: 15,
  grayscale: 5,
  blur: 3,
  tint: '#c41e2a',
};

describe('alignmentObjectFit (WE StretchMode mapping)', () => {
  it('maps all five alignments', () => {
    expect(cdpAlignmentObjectFit('stretch')).toBe('fill');
    expect(cdpAlignmentObjectFit('fit')).toBe('contain');
    expect(cdpAlignmentObjectFit('fill')).toBe('cover'); // default = history
    expect(cdpAlignmentObjectFit('center')).toBe('none');
    expect(cdpAlignmentObjectFit('tile')).toBe('none'); // tile handled by container bg
    expect(cdpAlignmentObjectFit(undefined)).toBe('cover');
  });
});

describe('buildObjectPosition', () => {
  it('defaults to centered when offsets are absent', () => {
    expect(cdpBuildObjectPosition({})).toBe('calc(50% + 0%) calc(50% + 0%)');
  });

  it('applies signed X/Y offsets', () => {
    expect(cdpBuildObjectPosition({ positionX: 10, positionY: -5 })).toBe(
      'calc(50% + 10%) calc(50% + -5%)',
    );
  });
});

describe('buildFlipTransform', () => {
  it('returns empty when neither axis flips', () => {
    expect(cdpBuildFlipTransform({})).toBe('');
    expect(cdpBuildFlipTransform({ flipH: false, flipV: false })).toBe('');
  });

  it('builds scaleX/scaleY for each flip axis', () => {
    expect(cdpBuildFlipTransform({ flipH: true })).toBe('scaleX(-1) scaleY(1)');
    expect(cdpBuildFlipTransform({ flipV: true })).toBe('scaleX(1) scaleY(-1)');
    expect(cdpBuildFlipTransform({ flipH: true, flipV: true })).toBe('scaleX(-1) scaleY(-1)');
  });
});

describe('buildTintFilter + hexHue', () => {
  it('computes the hue angle of a hex color', () => {
    expect(cdpHexHue('#ff0000')).toBe(0);
    expect(cdpHexHue('#00ff00')).toBe(120);
    expect(cdpHexHue('#0000ff')).toBe(240);
    expect(cdpHexHue('#ff8000')).toBeCloseTo(30, 0);
    expect(cdpHexHue('c41e2a')).toBeCloseTo(356, 0);
  });

  it('returns 0 for malformed hex', () => {
    expect(cdpHexHue('red')).toBe(0);
    expect(cdpHexHue('')).toBe(0);
    expect(cdpHexHue('#12')).toBe(0);
  });

  it('builds a sepia+saturate+hue-rotate tint filter', () => {
    expect(cdpBuildTintFilter('#00ff00')).toBe('sepia(1) saturate(2.5) hue-rotate(120deg)');
  });
});

describe('buildFilter (media element)', () => {
  it('returns empty when all filters are neutral/default', () => {
    expect(
      cdpBuildFilter({
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hueRotate: 0,
        sepia: 0,
        grayscale: 0,
        blur: 0,
      }),
    ).toBe('');
    expect(cdpBuildFilter({})).toBe('');
  });

  it('emits only the filters that differ from neutral', () => {
    const filter = cdpBuildFilter({ brightness: 115, contrast: 90, hueRotate: -20 });
    expect(filter).toContain('brightness(1.15)');
    expect(filter).toContain('contrast(0.90)');
    expect(filter).toContain('hue-rotate(-20deg)');
    expect(filter).not.toContain('saturate(');
    expect(filter).not.toContain('sepia(');
  });

  it('emits a composed filter string for all fields', () => {
    const filter = cdpBuildFilter(RENDER);
    expect(filter).toBe(
      'brightness(1.15) contrast(0.90) saturate(1.30) hue-rotate(-20deg) sepia(0.15) grayscale(0.05) blur(3px) sepia(1) saturate(2.5) hue-rotate(356deg)',
    );
  });
});

describe('buildMediaElementCss (CDP injector element cssText)', () => {
  it('matches the historical default output when no render options', () => {
    const css = cdpBuildMediaElementCss(undefined);
    expect(css).toContain('object-fit:cover!important;');
    expect(css).toContain('object-position:calc(50% + 0%) calc(50% + 0%)!important;');
    expect(css).not.toContain('transform:');
    expect(css).not.toContain('filter:');
  });

  it('applies fit alignment, offsets, flip and filter', () => {
    const css = cdpBuildMediaElementCss(RENDER);
    expect(css).toContain('object-fit:contain!important;');
    expect(css).toContain('object-position:calc(50% + 10%) calc(50% + -5%)!important;');
    expect(css).toContain('transform:scaleX(-1) scaleY(1)!important;');
    expect(css).toContain('filter:brightness(1.15)');
  });

  it('maps tile to object-fit:none (tiling is a container concern — element gets hidden)', () => {
    // The media element itself must NOT tile (a background-image on an <img>
    // is a no-op); the injector hides it and moves the source into the
    // container's background-repeat via buildTileContainerCss.
    const css = cdpBuildMediaElementCss({ alignment: 'tile' });
    expect(css).toContain('object-fit:none!important;');
  });
});

describe('buildTileContainerCss (image-only tiling)', () => {
  it('moves the source into a repeating container background', () => {
    const { containerBackground, hideElement } = cdpBuildTileContainerCss(
      'http://127.0.0.1:1/w?t=abc',
      { positionX: 10, positionY: -5 },
    );
    expect(containerBackground).toBe('url("http://127.0.0.1:1/w?t=abc") 10% -5% / auto repeat');
    expect(hideElement).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Renderer-side twin (ui/lib/wallpaperRender.ts) — parity with the CDP mapping
// ---------------------------------------------------------------------------

describe('renderer-side wallpaperRender (desktop background)', () => {
  it('alignmentObjectFit matches the CDP mapping', () => {
    expect(uiAlignmentObjectFit('stretch')).toBe(cdpAlignmentObjectFit('stretch'));
    expect(uiAlignmentObjectFit('fit')).toBe(cdpAlignmentObjectFit('fit'));
    expect(uiAlignmentObjectFit('fill')).toBe(cdpAlignmentObjectFit('fill'));
    expect(uiAlignmentObjectFit('center')).toBe(cdpAlignmentObjectFit('center'));
    expect(uiAlignmentObjectFit('tile')).toBe(cdpAlignmentObjectFit('tile'));
    expect(uiAlignmentObjectFit(undefined)).toBe(cdpAlignmentObjectFit(undefined));
  });

  it('buildObjectPosition matches the CDP mapping', () => {
    expect(uiBuildObjectPosition({ positionX: 10, positionY: -5 })).toBe(
      cdpBuildObjectPosition({ positionX: 10, positionY: -5 }),
    );
    expect(uiBuildObjectPosition({})).toBe(cdpBuildObjectPosition({}));
  });

  it('buildFlipTransform matches the CDP mapping', () => {
    expect(uiBuildFlipTransform({ flipH: true })).toBe(cdpBuildFlipTransform({ flipH: true }));
    expect(uiBuildFlipTransform({ flipH: true, flipV: true })).toBe(
      cdpBuildFlipTransform({ flipH: true, flipV: true }),
    );
    expect(uiBuildFlipTransform({})).toBe(cdpBuildFlipTransform({}));
  });

  it('hexHue + buildTintFilter match the CDP mapping', () => {
    expect(uiHexHue('#c41e2a')).toBeCloseTo(cdpHexHue('#c41e2a'), 0);
    expect(uiHexHue('garbage')).toBe(cdpHexHue('garbage'));
    expect(uiBuildTintFilter('#00ff00')).toBe(cdpBuildTintFilter('#00ff00'));
  });

  it('buildFilter matches the CDP mapping for identical input', () => {
    expect(uiBuildFilter(RENDER)).toBe(cdpBuildFilter(RENDER));
    expect(uiBuildFilter({})).toBe(cdpBuildFilter({}));
    expect(uiBuildFilter({ brightness: 100, contrast: 100 })).toBe(
      cdpBuildFilter({ brightness: 100, contrast: 100 }),
    );
  });

  it('buildMediaElementStyle maps fit alignment to objectFit contain', () => {
    const style = buildMediaElementStyle(RENDER);
    expect(style.objectFit).toBe('contain');
    expect(style.objectPosition).toBe('calc(50% + 10%) calc(50% + -5%)');
    expect(style.transform).toBe('scaleX(-1) scaleY(1)');
    expect(style.filter).toBe(cdpBuildFilter(RENDER));
  });

  it('buildMediaElementStyle stays neutral (centered position only) when render is empty', () => {
    // object-position is always written (default = centered); no objectFit /
    // transform / filter keys when nothing is configured.
    const style = buildMediaElementStyle(undefined);
    expect(style).toEqual({ objectPosition: 'calc(50% + 0%) calc(50% + 0%)' });
    expect(style.transform).toBeUndefined();
    expect(style.filter).toBeUndefined();
    expect(style.objectFit).toBeUndefined();
  });
});
