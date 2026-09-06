// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package — Preview / icon raster (palette-driven)
 */

import { hexToRgb } from '../../src/shared/theme/utils/color-utils.mjs';
import { makePng } from './png-encoder.mjs';

/** Build a palette-driven preview PNG (480×300). */
export function buildPreview(palette) {
  const bg = hexToRgb(palette.tokens['--agentskin-bg']) || [32, 26, 64];
  const surface = hexToRgb(palette.tokens['--agentskin-surface']) || [43, 37, 74];
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 480;
  const H = 300;
  return makePng(W, H, (x, y) => {
    const t = y / H;
    const r = Math.round(bg[0] + (surface[0] - bg[0]) * t);
    const g = Math.round(bg[1] + (surface[1] - bg[1]) * t);
    const b = Math.round(bg[2] + (surface[2] - bg[2]) * t);
    // accent rounded bar near bottom
    const inBar = y > H - 70 && x > 40 && x < W - 40 && y - (H - 70) < 36;
    if (inBar) return accent;
    return [r, g, b];
  });
}

/** Build a palette-driven icon PNG (128×128). */
export function buildIcon(palette) {
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 128;
  const H = 128;
  const rad = 28;
  return makePng(W, H, (x, y) => {
    const dx = Math.min(x, W - 1 - x);
    const dy = Math.min(y, H - 1 - y);
    const corner = Math.min(dx, dy);
    if (corner < rad - 6) {
      const edge = rad - corner;
      if (edge > 6) return [0, 0, 0]; // transparent-ish (will be clipped by rounded corner)
    }
    return accent;
  });
}
