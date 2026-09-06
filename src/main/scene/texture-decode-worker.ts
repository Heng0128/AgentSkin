// SPDX-License-Identifier: MPL-2.0

/**
 * # Texture Decode Worker
 *
 * Worker thread entry point for parallel texture decoding.
 * Receives compressed texture data and returns decoded RGBA pixels.
 *
 * Message protocol (main → worker):
 *   { requestId, format, width, height, data }
 *     - format: 'dxt1' | 'dxt3' | 'dxt5' | 'bc7' | 'r8' | 'rg88' | 'rgba8888'
 *     - data: compressed texture data (Buffer as ArrayBuffer)
 *
 * Worker → main:
 *   { requestId, rgba }      — success (rgba is Buffer as ArrayBuffer)
 *   { requestId, error }     — decode failure
 */

import { parentPort } from 'node:worker_threads';
import { decompressBc7 } from './tex-parser/bc7-decompress';
import { decompressDxt } from './tex-parser/dxt-decompress';
import { TEX_FORMAT } from './tex-parser/tex-types';

export interface DecodeRequest {
  requestId: number;
  format: number;
  width: number;
  height: number;
  /** Compressed texture data as Uint8Array (transferred as ArrayBuffer) */
  data: ArrayBuffer;
}

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

// Worker thread message handler
parentPort?.on('message', (request: DecodeRequest) => {
  if (!request || typeof request.requestId !== 'number') {
    parentPort?.postMessage({
      requestId: request?.requestId ?? -1,
      error: 'Invalid request: requestId is required',
    } as DecodeResponse);
    return;
  }

  const result = handleDecodeRequest(request);
  parentPort?.postMessage(result);
});
