// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEX_FORMAT } from './tex-parser/tex-types';
import { TextureDecodePool, terminateTextureDecodePool } from './texture-decode-pool';

describe('TextureDecodePool', () => {
  let pool: TextureDecodePool;

  beforeEach(() => {
    terminateTextureDecodePool();
    // Force synchronous mode in tests by pointing to a non-existent worker script.
    // This tests the decode logic without requiring compiled Worker threads.
    pool = new TextureDecodePool({
      maxWorkers: 2,
      workerScriptPath: '/nonexistent/worker.js',
    });
  });

  afterEach(async () => {
    await pool.terminate();
  });

  it('decodes RGBA8888 format (no-op)', async () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height * 4, 128);

    const result = await pool.decode(TEX_FORMAT.RGBA8888, width, height, data);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(width * height * 4);
  });

  it('decodes R8 format to RGBA', async () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height, 200);

    const result = await pool.decode(TEX_FORMAT.R8, width, height, data);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(width * height * 4);
    // First pixel should be (200, 200, 200, 255)
    expect(result?.[0]).toBe(200);
    expect(result?.[1]).toBe(200);
    expect(result?.[2]).toBe(200);
    expect(result?.[3]).toBe(255);
  });

  it('decodes RG88 format to RGBA', async () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height * 2);
    // Set first pixel to (100, 150)
    data[0] = 100;
    data[1] = 150;

    const result = await pool.decode(TEX_FORMAT.RG88, width, height, data);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(width * height * 4);
    expect(result?.[0]).toBe(100); // R
    expect(result?.[1]).toBe(150); // G
    expect(result?.[2]).toBe(0); // B
    expect(result?.[3]).toBe(255); // A
  });

  it('decodes multiple textures in batch', async () => {
    const tasks = [
      { format: TEX_FORMAT.R8, width: 4, height: 4, data: Buffer.alloc(16, 100) },
      { format: TEX_FORMAT.RG88, width: 4, height: 4, data: Buffer.alloc(32, 150) },
      { format: TEX_FORMAT.RGBA8888, width: 4, height: 4, data: Buffer.alloc(64, 200) },
    ];

    const results = await pool.decodeBatch(tasks);
    expect(results.length).toBe(3);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(results[2]).not.toBeNull();
  });

  it('reports pool statistics', () => {
    const stats = pool.getStats();
    expect(stats.totalWorkers).toBe(0); // Workers created lazily
    expect(stats.busyWorkers).toBe(0);
    expect(stats.queuedTasks).toBe(0);
  });

  it('handles unsupported format gracefully', async () => {
    const result = await pool.decode(999, 4, 4, Buffer.alloc(16));
    expect(result).toBeNull();
  });
});
