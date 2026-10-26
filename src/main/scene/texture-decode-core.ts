// SPDX-License-Identifier: MPL-2.0

/**
 * # Texture Decode Core
 *
 * Pure decode logic for compressed Wallpaper Engine textures (DXT1/3/5, BC7,
 * R8, RG88, RGBA8888 → RGBA8888). Shared by:
 *   - `texture-decode-worker.ts` (worker_threads entry)
 *   - `texture-decode-pool.ts`   (synchronous in-process fallback)
 *
 * ## Why this module exists (import-hygiene invariant)
 *
 * This module must stay **free of side effects** — in particular it must not
 * import `node:worker_threads`'s `parentPort` or register any message
 * handler. The pool imports it from library code that ends up bundled inside
 * OTHER worker threads (e.g. `scene-renderer-worker`): if the decode worker
 * entry were pulled into such a bundle, its top-level `parentPort?.on('message')`
 * would register a *second* handler in the host thread. That handler would then
 * see foreign requests (e.g. `{ requestId, pkgPath }` with no `data` field) and
 * reply first with `Buffer.from(undefined)` errors — a bug observed in the wild
 * as every scene render failing with "The first argument must be of type string
 * or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.
 * Received undefined" (see `texture-decode-worker.ts` for the entry).
 */

import { decompressBc7 } from './tex-parser/bc7-decompress';
import { decompressDxt } from './tex-parser/dxt-decompress';
import { TEX_FORMAT } from './tex-parser/tex-types';

/** Request shape sent to the decode worker / fallback path. */
export interface DecodeRequest {
  requestId: number;
  format: number;
  width: number;
  height: number;
  /** Compressed texture data as Uint8Array (transferred as ArrayBuffer) */
  data: ArrayBuffer;
}

/** Response shape produced by the decode worker / fallback path. */
export interface DecodeResponse {
  requestId: number;
  /** Decoded RGBA data as Uint8Array (transferred as ArrayBuffer) */
  rgba?: ArrayBuffer;
  error?: string;
}

/**
 * Decode a compressed texture to RGBA8888.
 * Returns a Buffer (Uint8Array subclass) suitable for transfer.
 */
function decodeTexture(request: DecodeRequest): Buffer {
  const { format, width, height, data } = request;
  const input = Buffer.from(data);

  switch (format) {
    case TEX_FORMAT.DXT1: {
      const result = decompressDxt(TEX_FORMAT.DXT1, width, height, input);
      if (!result)
        throw new Error('DXT1 decode returned null (unsupported dimensions or corrupt data)');
      return result;
    }
    case TEX_FORMAT.DXT3: {
      const result = decompressDxt(TEX_FORMAT.DXT3, width, height, input);
      if (!result)
        throw new Error('DXT3 decode returned null (unsupported dimensions or corrupt data)');
      return result;
    }
    case TEX_FORMAT.DXT5: {
      const result = decompressDxt(TEX_FORMAT.DXT5, width, height, input);
      if (!result)
        throw new Error('DXT5 decode returned null (unsupported dimensions or corrupt data)');
      return result;
    }
    case TEX_FORMAT.BC7: {
      const result = decompressBc7(width, height, input);
      if (!result)
        throw new Error('BC7 decode returned null (unsupported dimensions or corrupt data)');
      return result;
    }
    case TEX_FORMAT.R8: {
      // Single channel to RGBA
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = input[i];
        rgba[i * 4 + 1] = input[i];
        rgba[i * 4 + 2] = input[i];
        rgba[i * 4 + 3] = 255;
      }
      return rgba;
    }
    case TEX_FORMAT.RG88: {
      // Two channels to RGBA
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = input[i * 2];
        rgba[i * 4 + 1] = input[i * 2 + 1];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
      return rgba;
    }
    case TEX_FORMAT.RGBA8888:
      // Already RGBA, return copy
      return Buffer.from(input);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Handle a single decode request.
 */
export function handleDecodeRequest(request: DecodeRequest): DecodeResponse {
  try {
    const rgba = decodeTexture(request);
    // Extract ArrayBuffer slice for transfer
    const buffer = rgba.buffer.slice(
      rgba.byteOffset,
      rgba.byteOffset + rgba.byteLength,
    ) as ArrayBuffer;
    return { requestId: request.requestId, rgba: buffer };
  } catch (error) {
    return {
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
