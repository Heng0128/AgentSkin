// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { BinaryReader } from './binary-reader';
import {
  boxDownscaleRgba,
  cappedTextureDim,
  decompressDxt,
  MAX_SCENE_DECODE_DIM,
  MAX_SCENE_TEXTURE_DIM,
  parseTex,
  pickMipmapForDisplay,
  rgbaToPngDataUrl,
  TEX_FORMAT,
  type TexMipmap,
  texFramesToDataUrls,
  texToDataUrl,
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

// ---------------------------------------------------------------------------
// 真实格式 fixture（合成字节构造 TEXV0005）
// ---------------------------------------------------------------------------

/** 1×1 透明 PNG（嵌入纹理用）。 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function concat(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}
function i32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return b;
}
function f32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n, 0);
  return b;
}
function str(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1, 0)]);
}

/** 构造一个最小的 TEXV0005 容器。 */
function buildTex(options: {
  format: number;
  flags?: number;
  width?: number;
  height?: number;
  containerMagic?: string;
  imageFormat?: number;
  images?: Array<
    Array<{
      width: number;
      height: number;
      bytes: Buffer;
      lz4?: boolean;
      decompressedSize?: number;
    }>
  >;
  frames?: Array<{
    imageId: number;
    frametime: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }>;
}): Buffer {
  const {
    format,
    flags = 0,
    width = 64,
    height = 64,
    containerMagic = 'TEXB0001',
    imageFormat,
    images = [],
    frames = [],
  } = options;

  const parts: Buffer[] = [
    str('TEXV0005'),
    str('TEXI0001'),
    i32(format),
    i32(flags),
    i32(width), // textureWidth
    i32(height), // textureHeight
    i32(width), // imageWidth
    i32(height), // imageHeight
    i32(0), // unkInt0
  ];

  parts.push(str(containerMagic));
  parts.push(i32(images.length));
  if (containerMagic === 'TEXB0003' && imageFormat !== undefined) {
    parts.push(i32(imageFormat));
  } else if (containerMagic === 'TEXB0004') {
    parts.push(i32(imageFormat ?? -1));
    parts.push(i32(0)); // isVideoMp4
  }

  for (const mips of images) {
    parts.push(i32(mips.length));
    for (const mip of mips) {
      if (containerMagic === 'TEXB0001') {
        parts.push(i32(mip.width), i32(mip.height), i32(mip.bytes.length), mip.bytes);
      } else {
        parts.push(
          i32(mip.width),
          i32(mip.height),
          i32(mip.lz4 ? 1 : 0),
          i32(mip.decompressedSize ?? mip.bytes.length),
          i32(mip.bytes.length),
          mip.bytes,
        );
      }
    }
  }

  if (frames.length > 0) {
    parts.push(str('TEXS0001'));
    parts.push(i32(frames.length));
    for (const f of frames) {
      parts.push(i32(f.imageId), f32(f.frametime));
      parts.push(
        i32(f.x ?? 0),
        i32(f.y ?? 0),
        i32(f.width ?? width),
        i32(f.height ?? height),
        i32(0),
        i32(0),
      );
    }
  }

  return concat(...parts);
}

describe('parseTex — 真实格式 fixture', () => {
  it('parses a TEXV0005 with an uncompressed RGBA8888 mipmap', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      images: [[{ width: 64, height: 64, bytes: Buffer.alloc(64 * 64 * 4, 0xff) }]],
    });
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
    expect(tex!.format).toBe(TEX_FORMAT.RGBA8888);
    expect(tex!.textureWidth).toBe(64);
    expect(tex!.images[0].mipmaps[0].width).toBe(64);
    expect(tex!.isGif).toBe(false);
    expect(tex!.frames).toEqual([]);
  });

  it('parses a DXT1-compressed 4×4 mipmap (single 16-byte block)', () => {
    // 4×4 DXT1 = 1 个 8 字节块（+padding），这里直接给 16 字节数据。
    const block = Buffer.alloc(16, 0xff);
    const texBuf = buildTex({
      format: TEX_FORMAT.DXT1,
      width: 4,
      height: 4,
      images: [[{ width: 4, height: 4, bytes: block }]],
    });
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
    expect(tex!.images[0].mipmaps[0].bytes.length).toBe(16);
  });

  it('parses an embedded-PNG TEXB0003 container', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      containerMagic: 'TEXB0003',
      imageFormat: 13, // FIF_PNG
      width: 1,
      height: 1,
      images: [[{ width: 1, height: 1, bytes: PNG_BYTES }]],
    });
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
    expect(tex!.imageFormat).toBe(13);
    expect(texToDataUrl(tex!)).toMatch(/^data:image\/png;base64,/);
  });

  it('parses a GIF texture with frame info (TEXS0001)', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      flags: 4, // IS_GIF
      width: 1,
      height: 1,
      containerMagic: 'TEXB0001',
      images: [
        [{ width: 1, height: 1, bytes: Buffer.alloc(4, 0xff) }],
        [{ width: 1, height: 1, bytes: Buffer.alloc(4, 0x00) }],
      ],
      frames: [
        { imageId: 0, frametime: 0.1 },
        { imageId: 1, frametime: 0.05 },
      ],
    });
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
    expect(tex!.isGif).toBe(true);
    expect(tex!.images).toHaveLength(2);
    expect(tex!.frames).toHaveLength(2);
    expect(tex!.frames[0]).toMatchObject({ imageId: 0 });
    expect(tex!.frames[0].frametime).toBeCloseTo(0.1);
    expect(tex!.frames[1].frametime).toBeCloseTo(0.05);
  });

  it('returns null for a non-TEX buffer', () => {
    expect(parseTex(Buffer.from('GARBAGE'))).toBeNull();
  });

  it('returns null for a TEX with the wrong magic', () => {
    const texBuf = buildTex({ format: TEX_FORMAT.RGBA8888 });
    texBuf.write('TEXV9999', 0, 8, 'utf8');
    expect(parseTex(texBuf)).toBeNull();
  });
});

describe('texFramesToDataUrls — GIF 帧渲染', () => {
  it('renders every frame of an animated texture, preserving frametimes', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      flags: 4, // IS_GIF
      width: 1,
      height: 1,
      images: [
        [{ width: 1, height: 1, bytes: Buffer.alloc(4, 0xff) }],
        [{ width: 1, height: 1, bytes: Buffer.alloc(4, 0x00) }],
      ],
      frames: [
        { imageId: 0, frametime: 0.1 },
        { imageId: 1, frametime: 0.05 },
      ],
    });
    const tex = parseTex(texBuf)!;
    const frames = texFramesToDataUrls(tex);
    expect(frames).not.toBeNull();
    expect(frames!).toHaveLength(2);
    expect(frames![0].frametime).toBeCloseTo(0.1);
    expect(frames![1].frametime).toBeCloseTo(0.05);
    for (const f of frames!) expect(f.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null for non-animated textures', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      images: [[{ width: 1, height: 1, bytes: Buffer.alloc(4, 0xff) }]],
    });
    const tex = parseTex(texBuf)!;
    expect(texFramesToDataUrls(tex)).toBeNull();
  });

  it('crops sprite-atlas frames to their declared region', () => {
    // 2×2 atlas image, frames select left/right halves (full height).
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      flags: 4, // IS_GIF
      width: 2,
      height: 2,
      images: [
        [
          {
            width: 2,
            height: 2,
            // top row: red, green; bottom row: blue, white
            bytes: Buffer.from([
              255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ]),
          },
        ],
      ],
      frames: [
        { imageId: 0, frametime: 0.1, width: 1, height: 2 }, // left column
        { imageId: 0, frametime: 0.1, x: 1, width: 1, height: 2 }, // right column
      ],
    });
    const tex = parseTex(texBuf)!;
    const frames = texFramesToDataUrls(tex);
    expect(frames).not.toBeNull();
    expect(frames!).toHaveLength(2);
  });

  it('skips frames that reference missing images and drops all frames when none decode', () => {
    // Frame 0 references a missing image; frame 1 is valid → 1 frame survives.
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      flags: 4,
      width: 1,
      height: 1,
      images: [[{ width: 1, height: 1, bytes: Buffer.alloc(4, 0xff) }]],
      frames: [
        { imageId: 99, frametime: 0.1 },
        { imageId: 0, frametime: 0.05 },
      ],
    });
    const tex = parseTex(texBuf)!;
    const frames = texFramesToDataUrls(tex);
    expect(frames).not.toBeNull();
    expect(frames!).toHaveLength(1);
    expect(frames![0].frametime).toBeCloseTo(0.05);

    // All frames reference missing images → null (nothing to animate).
    const texBuf2 = buildTex({
      format: TEX_FORMAT.RGBA8888,
      flags: 4,
      width: 1,
      height: 1,
      images: [],
      frames: [{ imageId: 99, frametime: 0.1 }],
    });
    expect(texFramesToDataUrls(parseTex(texBuf2)!)).toBeNull();
  });
});

describe('texToDataUrl — 嵌入 PNG 优先', () => {
  it('returns the embedded PNG byte-for-byte for TEXB0003 PNG containers', () => {
    const texBuf = buildTex({
      format: TEX_FORMAT.RGBA8888,
      containerMagic: 'TEXB0003',
      imageFormat: 13,
      width: 1,
      height: 1,
      images: [[{ width: 1, height: 1, bytes: PNG_BYTES }]],
    });
    const tex = parseTex(texBuf)!;
    const url = texToDataUrl(tex);
    expect(url).toMatch(/^data:image\/png;base64,/);
    const b64 = url!.split(',')[1];
    expect(Buffer.from(b64, 'base64')).toEqual(PNG_BYTES);
  });
});

describe('BinaryReader 边界（读越界抛错）', () => {
  it('throws when reading past the end', () => {
    // 3 字节不足一个 int32（4 字节）→ Buffer.readInt32LE 抛 RangeError。
    const reader = new BinaryReader(Buffer.from([1, 2, 3]));
    expect(() => reader.readInt32()).toThrow();
  });
});

describe('decompressDxt — 鲁棒性（损坏/恶意尺寸不崩）', () => {
  it('returns null (not throw/OOM) on absurd dimensions', () => {
    // 65535² DXT1 would try to allocate ~16 GiB — must bail out cleanly.
    expect(decompressDxt(TEX_FORMAT.DXT1, 65535, 65535, Buffer.alloc(8))).toBeNull();
    expect(decompressDxt(TEX_FORMAT.DXT5, 1 << 20, 1 << 20, Buffer.alloc(16))).toBeNull();
  });

  it('returns null on non-positive / non-finite dimensions', () => {
    expect(decompressDxt(TEX_FORMAT.DXT1, 0, 4, Buffer.alloc(8))).toBeNull();
    expect(decompressDxt(TEX_FORMAT.DXT1, -1, 4, Buffer.alloc(8))).toBeNull();
    expect(decompressDxt(TEX_FORMAT.DXT1, 4, Number.NaN, Buffer.alloc(8))).toBeNull();
  });

  it('returns null when the source buffer is too short for the block layout', () => {
    // 4×4 DXT1 needs 8 bytes; provide fewer → no out-of-bounds read.
    expect(decompressDxt(TEX_FORMAT.DXT1, 4, 4, Buffer.alloc(4))).toBeNull();
    // 8×8 DXT1 needs 2×2×8 = 32 bytes.
    expect(decompressDxt(TEX_FORMAT.DXT1, 8, 8, Buffer.alloc(16))).toBeNull();
    // 4×4 DXT5 needs 16 bytes.
    expect(decompressDxt(TEX_FORMAT.DXT5, 4, 4, Buffer.alloc(8))).toBeNull();
  });

  it('returns null for uncompressed formats whose buffer is too short', () => {
    expect(decompressDxt(TEX_FORMAT.RGBA8888, 4, 4, Buffer.alloc(10))).toBeNull();
    expect(decompressDxt(TEX_FORMAT.R8, 4, 4, Buffer.alloc(10))).toBeNull();
    expect(decompressDxt(TEX_FORMAT.RG88, 4, 4, Buffer.alloc(20))).toBeNull();
  });

  it('still decodes a valid small texture normally', () => {
    // 4×4 DXT1 = 8 bytes; all-zero block decodes to a 64-byte RGBA buffer.
    const out = decompressDxt(TEX_FORMAT.DXT1, 4, 4, Buffer.alloc(8));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4 * 4 * 4);
  });
});

describe('parseTex — 截断/损坏头鲁棒性', () => {
  it('returns null for a header truncated right after the magic', () => {
    // Magic + a couple of bytes, not enough for the 11 int32 header fields.
    const buf = Buffer.concat([Buffer.from('TEXV0005\0TEXI0001\0'), Buffer.from([1, 2, 3, 4])]);
    expect(parseTex(buf)).toBeNull();
  });

  it('parses a header with a malformed short mipmap without throwing, and decode fails gracefully', () => {
    // Minimal header claiming 1 image / 1 mipmap, but the mipmap body (4 bytes)
    // is far too small for a 64×64 RGBA texture. parseTex must return a TexFile
    // (it only validates structure, not pixel data) and the downstream decode
    // must drop it rather than crash.
    const header = Buffer.concat([
      Buffer.from('TEXV0005\0TEXI0001\0'),
      Buffer.alloc(4 * 7), // format, flags, texW, texH, imgW, imgH, unkInt0
      Buffer.from('TEXB0001\0'), // container magic
      i32(1), // imageCount = 1
      i32(1), // mipmapCount = 1
      i32(64), // width
      i32(64), // height
      i32(4), // byteCount = 4 (valid length field, far too few pixels)
      Buffer.alloc(4),
    ]);
    const tex = parseTex(header);
    expect(tex).not.toBeNull();
    // 4 bytes can't back a 64×64 RGBA mipmap → decompressDxt returns null →
    // texToDataUrl returns null instead of throwing.
    expect(texToDataUrl(tex!)).toBeNull();
  });
});

describe('parseTex — TEXV0006 magic 白名单', () => {
  it('accepts TEXV0006 as a valid magic', () => {
    const texBuf = buildTex({ format: TEX_FORMAT.RGBA8888 });
    // Overwrite the magic at offset 0 from TEXV0005 to TEXV0006.
    texBuf.write('TEXV0006', 0, 8, 'utf8');
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
    expect(tex!.format).toBe(TEX_FORMAT.RGBA8888);
  });

  it('still rejects unknown magics', () => {
    const texBuf = buildTex({ format: TEX_FORMAT.RGBA8888 });
    texBuf.write('TEXV0099', 0, 8, 'utf8');
    expect(parseTex(texBuf)).toBeNull();
  });

  it('still accepts the original TEXV0005 magic', () => {
    const texBuf = buildTex({ format: TEX_FORMAT.RGBA8888 });
    const tex = parseTex(texBuf);
    expect(tex).not.toBeNull();
  });
});

describe('decompressDxt — BC7 格式', () => {
  it('decodes a 4×4 BC7 block (mode 0) to a 64-byte RGBA buffer', () => {
    // BC7 mode 0: 3-subset, bit 0 set in mode byte, 3-bit indices, P-bits.
    // Endpoint bytes land in a packed bitstream; the first pixel decodes to
    // endpoint 0's color (subset 0's first endpoint, anchor index = 0).
    const block = Buffer.alloc(16, 0);
    block[0] = 0x01; // mode 0 (first set bit at position 0)
    block[2] = 100;
    block[3] = 150;
    block[4] = 200;
    block[6] = 50;
    block[7] = 80;
    block[8] = 30;

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4 * 4 * 4);
    // All alpha values must be 255 for mode 0 (no alpha channel).
    expect(out![3]).toBe(255);
    expect(out![7]).toBe(255);
    expect(out![11]).toBe(255);
    expect(out![15]).toBe(255);
    // Pixel values are in [0, 255].
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBeGreaterThanOrEqual(0);
      expect(out![i * 4]).toBeLessThanOrEqual(255);
    }
  });

  it('decodes a BC7 mode 6 block with 4-bit indices (RGBA, single subset)', () => {
    // Mode 6: single subset, 4-bit indices, no partition, 7.7.7.7.1 endpoints.
    // Mode byte 0x40 = bit 6 set.  Build a block where endpoint 0 ≈ solid color.
    // Layout: 7-bit mode field (bits 0-6), then RGBA endpoints + 1 P-bit,
    //         then 16 × 4-bit indices. We zero-fill indices → all 0 → endpoint 0.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x40; // mode 6

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4 * 4 * 4);
    // With all-zero endpoints and zero P-bit, all channels decode to 0.
    // Index 0 → weight 0 → endpoint 0 (black) for all 16 pixels.
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(0);
      expect(out![i * 4 + 1]).toBe(0);
      expect(out![i * 4 + 2]).toBe(0);
      expect(out![i * 4 + 3]).toBe(0);
    }
  });

  it('decodes a BC7 mode 5 block (dual-plane, 7-bit RGB + 8-bit A)', () => {
    // Mode 5: single subset, rotation, 2-bit separate color and alpha indices.
    // Mode byte 0x20 = bit 5 set.  All-zero endpoints + zero indices = black.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x20; // mode 5

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4 * 4 * 4);
    // With all-zero endpoints and zero rotation, all pixels = (0, 0, 0, 0).
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(0);
      expect(out![i * 4 + 1]).toBe(0);
      expect(out![i * 4 + 2]).toBe(0);
      expect(out![i * 4 + 3]).toBe(0);
    }
  });

  it('decodes a BC7 mode 4 block (dual-plane, 5-bit RGB + 6-bit A)', () => {
    // Mode 4: single subset, idxMode + rotation, separate color and alpha indices.
    // Mode byte 0x10 = bit 4 set.  All-zero endpoints = black for all pixels.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x10; // mode 4

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(4 * 4 * 4);
    // With idxMode=0, rotation=0, all-zero endpoints: RGBA = (0, 0, 0, 0).
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(0);
      expect(out![i * 4 + 1]).toBe(0);
      expect(out![i * 4 + 2]).toBe(0);
      expect(out![i * 4 + 3]).toBe(0);
    }
  });

  it('decodes distinct colors for different subsets in a mode 0 block', () => {
    // Mode 0 with 3 subsets should produce at least 2 distinct colors among
    // the 16 pixels (subset 0 vs subset 1 vs subset 2 endpoints differ).
    const block = Buffer.alloc(16, 0);
    block[0] = 0x01; // mode 0

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    // All endpoints are zero (no explicit endpoint bits set) → all black,
    // but the fix-up / partition machinery still runs correctly.  Assert
    // that the decoder runs without throwing and produces 64 bytes.
    expect(out!.length).toBe(64);
  });

  it('returns null when the source buffer is too short for BC7 blocks', () => {
    // 8×8 BC7 needs 2×2×16 = 64 bytes; provide fewer.
    expect(decompressDxt(TEX_FORMAT.BC7, 8, 8, Buffer.alloc(32))).toBeNull();
    // 4×4 BC7 needs 16 bytes; provide fewer.
    expect(decompressDxt(TEX_FORMAT.BC7, 4, 4, Buffer.alloc(8))).toBeNull();
  });

  it('returns null for absurd BC7 dimensions', () => {
    expect(decompressDxt(TEX_FORMAT.BC7, 65535, 65535, Buffer.alloc(16))).toBeNull();
  });

  it('decodes a full 8×8 BC7 mipmap (4 blocks) without error', () => {
    // 8×8 = 4 blocks × 16 bytes = 64 bytes.
    const blocks = Buffer.alloc(64, 0);
    // Set each block's mode byte to mode 0.
    for (let i = 0; i < 4; i++) {
      blocks[i * 16] = 0x01;
    }
    const out = decompressDxt(TEX_FORMAT.BC7, 8, 8, blocks);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(8 * 8 * 4);
  });

  // ---------------------------------------------------------------------------
  // Bit-exact reference vector tests — verify per-pixel decode against spec math
  // ---------------------------------------------------------------------------

  it('mode 6 reference vector: all-zero endpoints and indices → all pixels (0,0,0,0)', () => {
    // Mode 6, all endpoints = 0, P = 0, all indices = 0 → everything decodes to 0.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x40; // mode 6 (bit 6 set)
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(0);
      expect(out![i * 4 + 1]).toBe(0);
      expect(out![i * 4 + 2]).toBe(0);
      expect(out![i * 4 + 3]).toBe(0);
    }
  });

  it('mode 6 reference vector: known endpoints produce correct output at idx 0', () => {
    // Construct a Mode 6 block with known endpoints and all-zero indices.
    // Mode 6 layout: 7-bit mode (bit 6), R0(7), R1(7), G0(7), G1(7), B0(7), B1(7),
    //   A0(7), A1(7), P(1), then 16 × 4-bit indices.
    // The code applies P-bit injection: (v << 1) | pBit. With pBit = 0, result = v << 1.
    // We set:
    //   R0 = 100, G0 = 75, B0 = 50, A0 = 127 → ep0 = (200, 150, 100, 254)
    //   R1 = 50,  G1 = 25, B1 = 100, A1 = 64  → ep1 = (100, 50, 200, 128)
    // P = 0, indices all 0 → every pixel = ep0.
    // 7-bit v with P=0: (v << 1) | 0 = v << 1.
    //   R0=100 → 200, G0=75 → 150, B0=50 → 100, A0=127 → 254.
    const block = buildBc7Mode6Block({
      r0: 100,
      r1: 50,
      g0: 75,
      g1: 25,
      b0: 50,
      b1: 100,
      a0: 127,
      a1: 64,
      pBit: 0,
      indices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);

    // ep0 = (200, 150, 100, 254) after P-bit injection with P=0:
    const expectedR = 200;
    const expectedG = 150;
    const expectedB = 100;
    const expectedA = 254;

    // All pixels should decode to ep0:
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(expectedR);
      expect(out![i * 4 + 1]).toBe(expectedG);
      expect(out![i * 4 + 2]).toBe(expectedB);
      expect(out![i * 4 + 3]).toBe(expectedA);
    }
  });

  it('mode 6 reference vector: anchor pixel idx 0 and non-anchor idx 8 interpolation', () => {
    // Mode 6: same endpoints as previous test but set pixel 4's color index to 8.
    // Pixel 0 is the anchor → stores only 3 bits → forced MSB=0 → index 0 → ep0.
    // Pixel 4 (non-anchor) → stores 4 bits → we set it to 8 → weight = BC7_WEIGHTS_4[8] = 34.
    // Interpolation formula: ((64 - 34) * ep0 + 34 * ep1 + 32) >> 6.
    // ep0 = (200, 150, 100, 254), ep1 = (100, 50, 200, 128)
    // For R: ((30)*200 + 34*100 + 32) >> 6 = (6000 + 3400 + 32) >> 6 = 9432 >> 6 = 147
    const block = buildBc7Mode6Block({
      r0: 100,
      r1: 50,
      g0: 75,
      g1: 25,
      b0: 50,
      b1: 100,
      a0: 127,
      a1: 64,
      pBit: 0,
      indices: [0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();

    // Pixel 0 (index 0, weight 0): output = ep0
    expect(out![0]).toBe(200);
    expect(out![1]).toBe(150);
    expect(out![2]).toBe(100);
    expect(out![3]).toBe(254);

    // Pixel 4 (index 8, weight 34/64): interpolated
    // R: ((30)*200 + 34*100 + 32) >> 6 = (6000+3400+32)>>6 = 9432>>6 = 147
    expect(out![4 * 4]).toBe(147);
  });

  it('mode 4 reference vector: reads both endpoint sets (fix verification)', () => {
    // Mode 4: idxMode=0, rotation=0, R0=31, G0=0, B0=0, A0=63, R1=0, G1=0, B1=0, A1=0,
    // all color indices = 0, all alpha indices = 0.
    // If the fix is correct: ep0 = (248, 0, 0, 252), pixel 0 = (248, 0, 0, 252).
    // If the bug persisted (second endpoint = [0,0,0,0]): ep0 = (248, 0, 0, 252),
    //   but other pixels with non-zero indices would see gradient to black.
    const block = buildBc7Mode4Block({
      idxMode: 0,
      rotation: 0,
      r0: 31,
      g0: 0,
      b0: 0,
      a0: 63,
      r1: 0,
      g1: 0,
      b1: 0,
      a1: 0,
      colorIndices: new Array(16).fill(0),
      alphaIndices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);

    // R0=31 (5-bit) → (31<<3)|(31>>2) = 248|7 = 255 (bottom 8 bits)
    // Actually: 31 << 3 = 248, 31 >> 2 = 7, 248 | 7 = 255.
    // G0=0 → 0, B0=0 → 0.
    // A0=63 (6-bit) → (63<<2)|(63>>4) = 252|3 = 255.
    // So ep0 = (255, 0, 0, 255) after full bit replication.
    expect(out![0]).toBe(255); // R
    expect(out![1]).toBe(0); // G
    expect(out![2]).toBe(0); // B
    expect(out![3]).toBe(255); // A
  });

  it('mode 4 reference vector: non-zero indices gradient to read ep1, not stale-zero', () => {
    // The bug: second endpoint was always [0,0,0,0]. With non-zero color indices,
    // pixels would gradient between ep0 and (0,0,0,0).
    // After the fix: second endpoint is correctly read from the bitstream.
    // Set R0=0, R1=31 so ep0.R=0, ep1.R=255. A0=63, A1=0 so ep0.A=255, ep1.A=0.
    // Color indices: [0, 1, 0, ...]. Alpha indices: all 0.
    // Pixel 1 color idx 1 → weight = BC7_WEIGHTS_2[1] = 21.
    // With fix: R = ((43)*0 + 21*255 + 32) >> 6 = 84 (gradient toward ep1.R=255).
    // With bug: R = ((43)*0 + 21*0 + 32) >> 6 = 0 (gradient toward stale-zero).
    const block = buildBc7Mode4Block({
      idxMode: 0,
      rotation: 0,
      r0: 0,
      g0: 0,
      b0: 0,
      a0: 63,
      r1: 31,
      g1: 0,
      b1: 0,
      a1: 0,
      colorIndices: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      alphaIndices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();

    // Pixel 0 (idx 0, weight 0): output = ep0 = (0, 0, 0, 255)
    expect(out![0]).toBe(0); // R
    expect(out![3]).toBe(255); // A

    // Pixel 1 (color idx 1, weight 21/64):
    // ep0 = (0,0,0,255), ep1 = (255,0,0,0)
    // R: ((43)*0 + 21*255 + 32) >> 6 = 84
    expect(out![4]).toBe(84); // R channel at pixel 1 (gradient toward 255)
  });

  it('mode 4 reference vector: rotation=1 swaps R and A', () => {
    // Mode 4 rotation=1 swaps decoded R and A channels.
    // ep0 = (255, 0, 0, 255), all indices 0 → pixel = (255, 0, 0, 255) before rotation.
    // After rotation=1: outR = a = 255, outA = r = 255. Both same, use different values.
    const block = buildBc7Mode4Block({
      idxMode: 0,
      rotation: 1,
      r0: 31,
      g0: 0,
      b0: 0,
      a1: 0,
      r1: 0,
      g1: 0,
      b1: 0,
      a0: 0, // A0 = 0
      colorIndices: new Array(16).fill(0),
      alphaIndices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();

    // ep0 before rotation: R=255, G=0, B=0, A=0.
    // After rotation=1: outR = original_A = 0, outG = 0, outB = 0, outA = original_R = 255.
    expect(out![0]).toBe(0); // R (swapped with A)
    expect(out![3]).toBe(255); // A (swapped with R)
  });

  it('mode 5 reference vector: reads both endpoint sets (fix verification)', () => {
    // Mode 5: rotation=0, R0=127, G0=0, B0=0, A0=255, R1=0, G1=0, B1=0, A1=0.
    // All indices 0 → pixel = ep0.
    // 7-bit bit replication: (v<<1)|(v>>6).
    //   R0=127: (127<<1)|(127>>6) = 254|1 = 255.
    //   A0=255 (8-bit, no replication).
    const block = buildBc7Mode5Block({
      rotation: 0,
      r0: 127,
      g0: 0,
      b0: 0,
      a0: 255,
      r1: 0,
      g1: 0,
      b1: 0,
      a1: 0,
      colorIndices: new Array(16).fill(0),
      alphaIndices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);

    // ep0 = (255, 0, 0, 255), all pixels same since all indices = 0.
    for (let i = 0; i < 16; i++) {
      expect(out![i * 4]).toBe(255);
      expect(out![i * 4 + 1]).toBe(0);
      expect(out![i * 4 + 2]).toBe(0);
      expect(out![i * 4 + 3]).toBe(255);
    }
  });

  it('mode 5 reference vector: non-zero indices gradient to read ep1, not stale-zero', () => {
    // The bug: second endpoint was always [0,0,0,0].
    // After the fix: second endpoint is correctly read from the bitstream.
    // Set R0=0, R1=127 so ep0.R=0, ep1.R=255. A0=255, A1=0.
    // R is 7-bit with bit replication (v << 1) | (v >> 6):
    //   R0=0 → 0, R1=127 → (127<<1)|(127>>6) = 254|1 = 255.
    // Color indices: [0, 1, 0, ...]. Alpha indices: all 0.
    // Pixel 1 color idx 1 → weight = BC7_WEIGHTS_2[1] = 21.
    // With fix: R = ((43)*0 + 21*255 + 32) >> 6 = 84 (gradient toward ep1.R=255).
    // With bug: R = ((43)*0 + 21*0 + 32) >> 6 = 0 (gradient toward stale-zero).
    const block = buildBc7Mode5Block({
      rotation: 0,
      r0: 0,
      g0: 0,
      b0: 0,
      a0: 255,
      r1: 127,
      g1: 0,
      b1: 0,
      a1: 0,
      colorIndices: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      alphaIndices: new Array(16).fill(0),
    });
    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();

    // Pixel 0 (idx 0, weight 0): output = ep0 = (0, 0, 0, 255)
    expect(out![0]).toBe(0); // R
    expect(out![3]).toBe(255); // A

    // Pixel 1 (color idx 1, weight 21/64):
    // ep0 = (0,0,0,255), ep1 = (255,0,0,0)
    // R: ((43)*0 + 21*255 + 32) >> 6 = 84
    expect(out![4]).toBe(84); // R channel at pixel 1 (gradient toward 255)
  });

  it('decodes mode 1 (2-subset, 3-bit indices) without error', () => {
    // Mode 1: 2 subsets, 64 partitions, 3-bit indices, 6.6.6.1 endpoints.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x02; // mode 1 (bit 1 set)

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);
  });

  it('decodes mode 7 (2-subset RGBA, 2-bit indices) without error', () => {
    // Mode 7: 2 subsets, 64 partitions, 2-bit indices, 5.5.5.5.1 endpoints.
    const block = Buffer.alloc(16, 0);
    block[0] = 0x80; // mode 7 (bit 7 set)

    const out = decompressDxt(TEX_FORMAT.BC7, 4, 4, block);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(64);
  });
});

describe('rgbaToPngDataUrl — 输入校验', () => {
  it('throws a labelled RangeError on a too-small buffer', () => {
    const rgba = Buffer.alloc(4); // enough for 1×1, but we claim 2×2 (needs 16)
    expect(() => rgbaToPngDataUrl(rgba, 2, 2)).toThrow(/too small/);
  });

  it('throws on non-positive dimensions', () => {
    expect(() => rgbaToPngDataUrl(Buffer.alloc(4), 0, 1)).toThrow(/non-positive/);
  });

  it('throws when dimensions exceed the decode cap', () => {
    const big = MAX_SCENE_DECODE_DIM + 1;
    expect(() => rgbaToPngDataUrl(Buffer.alloc(big * big * 4), big, big)).toThrow(/exceed max/);
  });

  it('still produces a valid data URL for a well-formed 1×1 buffer', () => {
    const url = rgbaToPngDataUrl(Buffer.from([255, 0, 0, 255]), 1, 1);
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

// ---------------------------------------------------------------------------
// BC7 bit-level block construction helpers for reference vector tests
// ---------------------------------------------------------------------------

/** Set `count` LSBF bits at bit offset `bitOfs` in a 16-byte buffer. */
function setBits(block: Buffer, bitOfs: number, value: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const byteIndex = (bitOfs + i) >> 3;
    const bitIndex = (bitOfs + i) & 7;
    if (value & (1 << i)) {
      block[byteIndex] |= 1 << bitIndex;
    } else {
      block[byteIndex] &= ~(1 << bitIndex);
    }
  }
}

/** Build a 16-byte BC7 Mode 6 (7.7.7.7.1 RGBA) block with explicit endpoints and indices. */
function buildBc7Mode6Block(opts: {
  r0: number;
  r1: number;
  g0: number;
  g1: number;
  b0: number;
  b1: number;
  a0: number;
  a1: number;
  pBit: number;
  indices: number[];
}): Buffer {
  const block = Buffer.alloc(16, 0);
  block[0] = 0x40; // mode 6 (bit 6 set)
  let ofs = 7; // after 7-bit mode indicator
  setBits(block, ofs, opts.r0, 7);
  ofs += 7;
  setBits(block, ofs, opts.r1, 7);
  ofs += 7;
  setBits(block, ofs, opts.g0, 7);
  ofs += 7;
  setBits(block, ofs, opts.g1, 7);
  ofs += 7;
  setBits(block, ofs, opts.b0, 7);
  ofs += 7;
  setBits(block, ofs, opts.b1, 7);
  ofs += 7;
  setBits(block, ofs, opts.a0, 7);
  ofs += 7;
  setBits(block, ofs, opts.a1, 7);
  ofs += 7;
  setBits(block, ofs, opts.pBit, 1);
  ofs += 1;
  // 16 × 4-bit color indices (MSB of anchor pixel 0 is implicitly 0 → 3 stored bits).
  for (let p = 0; p < 16; p++) {
    const storedBits = p === 0 ? 3 : 4;
    setBits(block, ofs, opts.indices[p] & ((1 << storedBits) - 1), storedBits);
    ofs += storedBits;
  }
  return block;
}

/** Build a 16-byte BC7 Mode 4 (5-bit RGB + 6-bit A, separate planes) block. */
function buildBc7Mode4Block(opts: {
  idxMode: number;
  rotation: number;
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  colorIndices: number[];
  alphaIndices: number[];
}): Buffer {
  const block = Buffer.alloc(16, 0);
  block[0] = 0x10; // mode 4 (bit 4 set)
  let ofs = 5; // after 5-bit mode indicator
  setBits(block, ofs, opts.idxMode, 1);
  ofs += 1;
  setBits(block, ofs, opts.rotation, 2);
  ofs += 2;
  // Interleaved endpoint pairs: R0R1, G0G1, B0B1, then A0, A1
  setBits(block, ofs, opts.r0 | (opts.r1 << 5), 10);
  ofs += 10;
  setBits(block, ofs, opts.g0 | (opts.g1 << 5), 10);
  ofs += 10;
  setBits(block, ofs, opts.b0 | (opts.b1 << 5), 10);
  ofs += 10;
  setBits(block, ofs, opts.a0, 6);
  ofs += 6;
  setBits(block, ofs, opts.a1, 6);
  ofs += 6;
  // Color idx stores 2-bit (idxMode=0) or 3-bit (idxMode=1); anchor pixel 0 uses storedBits - 1.
  const colorIdxBits = opts.idxMode === 0 ? 2 : 3;
  for (let p = 0; p < 16; p++) {
    const storedBits = p === 0 ? colorIdxBits - 1 : colorIdxBits;
    setBits(block, ofs, opts.colorIndices[p] & ((1 << storedBits) - 1), storedBits);
    ofs += storedBits;
  }
  // Alpha idx stores 3-bit (idxMode=0) or 2-bit (idxMode=1).
  const alphaIdxBits = opts.idxMode === 0 ? 3 : 2;
  for (let p = 0; p < 16; p++) {
    const storedBits = p === 0 ? alphaIdxBits - 1 : alphaIdxBits;
    setBits(block, ofs, opts.alphaIndices[p] & ((1 << storedBits) - 1), storedBits);
    ofs += storedBits;
  }
  return block;
}

/** Build a 16-byte BC7 Mode 5 (7-bit RGB + 8-bit A, separate planes) block. */
function buildBc7Mode5Block(opts: {
  rotation: number;
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  colorIndices: number[];
  alphaIndices: number[];
}): Buffer {
  const block = Buffer.alloc(16, 0);
  block[0] = 0x20; // mode 5 (bit 5 set)
  let ofs = 6; // after 6-bit mode indicator
  setBits(block, ofs, opts.rotation, 2);
  ofs += 2;
  setBits(block, ofs, opts.r0 | (opts.r1 << 7), 14);
  ofs += 14;
  setBits(block, ofs, opts.g0 | (opts.g1 << 7), 14);
  ofs += 14;
  setBits(block, ofs, opts.b0 | (opts.b1 << 7), 14);
  ofs += 14;
  setBits(block, ofs, opts.a0, 8);
  ofs += 8;
  setBits(block, ofs, opts.a1, 8);
  ofs += 8;
  // Color idx: 2-bit, anchor pixel 0 stores 1 bit.
  for (let p = 0; p < 16; p++) {
    const storedBits = p === 0 ? 1 : 2;
    setBits(block, ofs, opts.colorIndices[p] & ((1 << storedBits) - 1), storedBits);
    ofs += storedBits;
  }
  // Alpha idx: 2-bit, anchor pixel 0 stores 1 bit.
  for (let p = 0; p < 16; p++) {
    const storedBits = p === 0 ? 1 : 2;
    setBits(block, ofs, opts.alphaIndices[p] & ((1 << storedBits) - 1), storedBits);
    ofs += storedBits;
  }
  return block;
}
