// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wallpaperMediaServer } from './wallpaper-server';

// ---------------------------------------------------------------------------
// The wallpaper server is a plain Node.js http.Server bound to 127.0.0.1.
// We test it end-to-end: register a real temp file, fetch the issued URL,
// and verify status / headers / body. No Electron dependency.
// ---------------------------------------------------------------------------

let tmpDir: string;
let testFile: string;
const testContent = Buffer.from('fake-video-content-for-testing');

// Helper: issue an HTTP request and collect status + headers + body.
function fetchUrl(
  url: string,
  options: { headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wallpaper-server-test-'));
  testFile = path.join(tmpDir, 'test.mp4');
  await fs.writeFile(testFile, testContent);
});

afterEach(async () => {
  wallpaperMediaServer.stop();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer.register', () => {
  it('returns a loopback URL with a token', async () => {
    const result = await wallpaperMediaServer.register(testFile, 'video/mp4');
    expect(result).not.toBeNull();
    expect(result!.token).toHaveLength(32); // 16 bytes hex = 32 chars
    expect(result!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/w\?t=/);
  });

  it('starts the server lazily on first register', async () => {
    // Before register, server is not running
    wallpaperMediaServer.stop();
    const result = await wallpaperMediaServer.register(testFile, 'video/mp4');
    expect(result).not.toBeNull();
    // The URL should be reachable
    const res = await fetchUrl(result!.url);
    expect(res.status).toBe(200);
  });

  it('is idempotent — second register does not start a new server', async () => {
    const r1 = await wallpaperMediaServer.register(testFile, 'video/mp4');
    const r2 = await wallpaperMediaServer.register(testFile, 'video/mp4');
    // Same port (server reused), different tokens
    expect(r1!.url.split(':')[2].split('/')[0]).toBe(r2!.url.split(':')[2].split('/')[0]);
    expect(r1!.token).not.toBe(r2!.token);
  });

  it('returns null for non-existent file', async () => {
    const result = await wallpaperMediaServer.register(
      path.join(tmpDir, 'does-not-exist.mp4'),
      'video/mp4',
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTTP serving — full file
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer HTTP serving (full file)', () => {
  it('serves the complete file with 200', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Number(res.headers['content-length'])).toBe(testContent.length);
    expect(res.body).toEqual(testContent);
  });

  it('returns 404 for unknown token', async () => {
    await wallpaperMediaServer.register(testFile, 'video/mp4');
    // Fetch with a bogus token
    const port = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!.url
      .split(':')[2]
      .split('/')[0];
    const res = await fetchUrl(`http://127.0.0.1:${port}/w?t=bogustoken`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for missing token parameter', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const port = url.split(':')[2].split('/')[0];
    const res = await fetchUrl(`http://127.0.0.1:${port}/w`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// HTTP serving — Range requests
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer HTTP serving (Range requests)', () => {
  it('serves a partial content range with 206', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, { headers: { Range: 'bytes=0-9' } });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${testContent.length}`);
    expect(Number(res.headers['content-length'])).toBe(10);
    expect(res.body).toEqual(testContent.subarray(0, 10));
  });

  it('serves a range from the middle', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, { headers: { Range: 'bytes=5-14' } });
    expect(res.status).toBe(206);
    expect(res.body).toEqual(testContent.subarray(5, 15));
  });

  it('clamps end to file size', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, {
      headers: { Range: `bytes=0-${testContent.length + 100}` },
    });
    expect(res.status).toBe(206);
    expect(Number(res.headers['content-length'])).toBe(testContent.length);
  });

  it('supports open-ended range (bytes=N-)', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, { headers: { Range: 'bytes=10-' } });
    expect(res.status).toBe(206);
    expect(res.body).toEqual(testContent.subarray(10));
  });

  it('handles bytes=-N as bytes=0-N (non-standard but safe)', async () => {
    // Note: per RFC 7233, bytes=-5 should mean "last 5 bytes", but the
    // server's regex treats empty start as 0. Browsers never send this
    // form for video seeking (they use bytes=N-), so this is a documented
    // limitation rather than a production issue.
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, { headers: { Range: 'bytes=-5' } });
    expect(res.status).toBe(206);
    // Server interprets bytes=-5 as bytes=0-5 (first 6 bytes)
    expect(res.body).toEqual(testContent.subarray(0, 6));
  });

  it('returns 416 when start >= file size', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    const res = await fetchUrl(url, {
      headers: { Range: `bytes=${testContent.length + 10}-` },
    });
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${testContent.length}`);
  });
});

// ---------------------------------------------------------------------------
// unregister()
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer.unregister', () => {
  it('removes a registered file so subsequent fetches 404', async () => {
    const { token, url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    // Verify it works before unregister
    const before = await fetchUrl(url);
    expect(before.status).toBe(200);

    wallpaperMediaServer.unregister(token);

    const after = await fetchUrl(url);
    expect(after.status).toBe(404);
  });

  it('does not throw for unknown token', () => {
    expect(() => wallpaperMediaServer.unregister('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer.stop', () => {
  it('clears all registrations', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    wallpaperMediaServer.stop();
    // After stop, the URL should no longer be reachable (connection refused)
    await expect(fetchUrl(url)).rejects.toThrow();
  });

  it('allows re-registering after stop', async () => {
    await wallpaperMediaServer.register(testFile, 'video/mp4');
    wallpaperMediaServer.stop();
    const r2 = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    // New server, potentially new port
    expect(r2).not.toBeNull();
    const res = await fetchUrl(r2.url);
    expect(res.status).toBe(200);
  });

  it('is safe to call when already stopped', () => {
    wallpaperMediaServer.stop();
    expect(() => wallpaperMediaServer.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// File disappears after registration
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer file disappearance', () => {
  it('returns 404 when file is deleted after registration', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    await fs.unlink(testFile);
    const res = await fetchUrl(url);
    expect(res.status).toBe(404);
  });

  it('returns 404 for range request when file is deleted after registration', async () => {
    const { url } = (await wallpaperMediaServer.register(testFile, 'video/mp4'))!;
    await fs.unlink(testFile);
    const res = await fetchUrl(url, { headers: { Range: 'bytes=0-9' } });
    expect(res.status).toBe(404);
  });
});
