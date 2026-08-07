// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { BinaryReader } from './binary-reader';
import {
  boxDownscaleRgba,
  cappedTextureDim,
  MAX_SCENE_TEXTURE_DIM,
  parseTex,
  pickMipmapForDisplay,
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
