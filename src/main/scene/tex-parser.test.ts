// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  boxDownscaleRgba,
  cappedTextureDim,
  MAX_SCENE_TEXTURE_DIM,
  pickMipmapForDisplay,
  type TexMipmap,
} from './tex-parser';

function mip(w: number, h: number): TexMipmap {
  return { width: w, height: h, bytes: Buffer.alloc(0) };
}

describe('cappedTextureDim', () => {
  it('clamps oversized textures to the cap and passes smaller ones through', () => {
    expect(cappedTextureDim(4096)).toBe(2048);
    expect(cappedTextureDim(8192)).toBe(2048);
    expect(cappedTextureDim(2048)).toBe(2048);
    expect(cappedTextureDim(1024)).toBe(1024);
    expect(MAX_SCENE_TEXTURE_DIM).toBe(2048);
  });
});

describe('pickMipmapForDisplay', () => {
  it('picks the exact 2048 mip when available (closest ≤ cap)', () => {
    const chain = [mip(4096, 4096), mip(2048, 2048), mip(1024, 1024)];
    expect(pickMipmapForDisplay(chain, 2048).width).toBe(2048);
  });

  it('picks a 16:9 1920x1080 mip for a fullscreen texture (best fit ≤ cap)', () => {
    // Fullscreen chains ship a 1080p mip — identical on a 1080p display at
    // 1/4 the decode memory of the 3840x2160 mip.
    const chain = [mip(3840, 2160), mip(1920, 1080), mip(960, 540)];
    const picked = pickMipmapForDisplay(chain, 2048);
    expect(picked.width).toBe(1920);
    expect(picked.height).toBe(1080);
  });

  it('picks the 2048 mip from an 8192 chain', () => {
    const chain = [mip(8192, 8192), mip(4096, 4096), mip(2048, 2048)];
    expect(pickMipmapForDisplay(chain, 2048).width).toBe(2048);
  });

  it('falls back to the largest mip when every mip is below the cap', () => {
    const chain = [mip(1024, 1024), mip(512, 512)];
    expect(pickMipmapForDisplay(chain, 2048).width).toBe(1024);
  });

  it('uses the full-res mip when the chain has no cap-fitting mip (then downscaled)', () => {
    const chain = [mip(4096, 4096)];
    expect(pickMipmapForDisplay(chain, 2048).width).toBe(4096);
  });
});

describe('boxDownscaleRgba', () => {
  it('averages 2x2 blocks for k=2', () => {
    // 4x4 RGBA with distinct pixel values.
    const rgba = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < 4 * 4; i++) {
      rgba[i * 4] = i % 10; // R: 0..9 row-major
      rgba[i * 4 + 1] = 100;
      rgba[i * 4 + 2] = 200;
      rgba[i * 4 + 3] = 255;
    }
    boxDownscaleRgba(rgba, 4, 4, 2);
    // Output occupies the first 2x2 pixels, each RGBA (4 bytes):
    //   (0,0): R=(0+1+4+5)/4=2.5→2, G=100, B=200, A=255
    //   (1,0): R=(2+3+6+7)/4=4.5→4
    expect(rgba[0]).toBe(Math.floor((0 + 1 + 4 + 5) / 4)); // R of (0,0)
    expect(rgba[1]).toBe(100); // G of (0,0)
    expect(rgba[2]).toBe(200); // B of (0,0)
    expect(rgba[3]).toBe(255); // A of (0,0)
    expect(rgba[4]).toBe(Math.floor((2 + 3 + 6 + 7) / 4)); // R of (1,0)
  });

  it('leaves the buffer length unchanged (in-place, no extra allocation)', () => {
    const rgba = Buffer.alloc(8 * 8 * 4, 7);
    boxDownscaleRgba(rgba, 8, 8, 2);
    expect(rgba.length).toBe(8 * 8 * 4);
    // 4x4 output: first pixel avg of the 2x2 block = 7.
    expect(rgba[0]).toBe(7);
  });
});
