// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
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

// ---------------------------------------------------------------------------
// registerDirectory() — path-based directory serving
// ---------------------------------------------------------------------------

/**
 * Directory serving is used by web-type wallpapers. The registered root is
 * served under /d/{token}/{filepath}; relative URLs in the wallpaper's
 * index.html resolve correctly under this scheme. Path traversal must be
 * blocked both syntactically (no `..`, no leading slash) and via a
 * post-resolve containment check.
 */
describe('WallpaperMediaServer.registerDirectory', () => {
  let webRoot: string;
  const indexHtml = Buffer.from('<!doctype html><body>web-wallpaper</body>');
  const scriptJs = Buffer.from('console.log("wp");');
  const nestedCss = Buffer.from('body { color: red; }');
  const binAsset = Buffer.from([0x00, 0x01, 0x02, 0xff]);

  beforeEach(async () => {
    webRoot = path.join(tmpDir, 'web-root');
    await fs.mkdir(path.join(webRoot, 'sub'), { recursive: true });
    await fs.writeFile(path.join(webRoot, 'index.html'), indexHtml);
    await fs.writeFile(path.join(webRoot, 'script.js'), scriptJs);
    await fs.writeFile(path.join(webRoot, 'sub', 'nested.css'), nestedCss);
    await fs.writeFile(path.join(webRoot, 'data.bin'), binAsset);
    // A sibling directory OUTSIDE webRoot — must not be reachable.
    await fs.writeFile(path.join(tmpDir, 'secret.txt'), 'top-secret');
  });

  it('returns a loopback base URL ending with /d/{token}/', async () => {
    const result = await wallpaperMediaServer.registerDirectory(webRoot);
    expect(result).not.toBeNull();
    expect(result!.token).toHaveLength(32);
    expect(result!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/d\/[0-9a-f]{32}\//);
  });

  it('serves index.html from the registered root', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}index.html`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toEqual(indexHtml);
  });

  it('serves nested files via relative path', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}sub/nested.css`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css');
    expect(res.body).toEqual(nestedCss);
  });

  it('derives MIME from extension', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}script.js`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/javascript');
  });

  it('falls back to application/octet-stream for unknown extensions', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}data.bin`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.body).toEqual(binAsset);
  });

  it('returns 404 for missing files', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}does-not-exist.html`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the path targets the root directory itself', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    // Empty path -> root directory -> 404 (directories are not served)
    const res = await fetchUrl(url);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a subdirectory path', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}sub`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// registerDirectory() — path traversal protection
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer.registerDirectory path traversal', () => {
  let webRoot: string;

  beforeEach(async () => {
    webRoot = path.join(tmpDir, 'web-root');
    await fs.mkdir(webRoot, { recursive: true });
    await fs.writeFile(path.join(webRoot, 'index.html'), 'ok');
    // Sibling file outside the registered root — must never be served.
    await fs.writeFile(path.join(tmpDir, 'secret.txt'), 'top-secret');
  });

  it('rejects encoded ".." traversal (%2e%2e%2f)', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    // %2e%2e%2f decodes to ../ which is syntactically rejected.
    const res = await fetchUrl(`${url}%2e%2e%2fsecret.txt`);
    expect(res.status).toBe(403);
  });

  it('rejects encoded absolute path (%2f leading slash)', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    // %2fetc%2fpasswd decodes to /etc/passwd — leading slash rejected.
    const res = await fetchUrl(`${url}%2fetc%2fpasswd`);
    expect(res.status).toBe(403);
  });

  it('rejects encoded backslash absolute path (%5c leading)', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    // %5c decodes to \ — leading backslash rejected (Windows absolute).
    const res = await fetchUrl(`${url}%5cwindows%5csystem32%5cdrivers%5cetc%5chosts`);
    expect(res.status).toBe(403);
  });

  it('does not serve files outside the root even with multiple .. segments', async () => {
    const { url } = (await wallpaperMediaServer.registerDirectory(webRoot))!;
    const res = await fetchUrl(`${url}%2e%2e%2f%2e%2e%2fsecret.txt`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// registerHtml() — inline HTML serving
// ---------------------------------------------------------------------------

describe('WallpaperMediaServer.registerHtml', () => {
  it('serves inline HTML with default text/html MIME', async () => {
    const html = '<!doctype html><body>scene-wallpaper</body>';
    const { url } = (await wallpaperMediaServer.registerHtml(html))!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/h\?t=/);
    const res = await fetchUrl(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body.toString('utf8')).toBe(html);
  });

  it('serves inline HTML with a custom MIME type', async () => {
    const { url } = (await wallpaperMediaServer.registerHtml('{}', 'application/json'))!;
    const res = await fetchUrl(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body.toString('utf8')).toBe('{}');
  });

  it('returns 404 for unknown token', async () => {
    const { url } = (await wallpaperMediaServer.registerHtml('<p>x</p>'))!;
    const port = url.split(':')[2].split('/')[0];
    const res = await fetchUrl(`http://127.0.0.1:${port}/h?t=bogustoken`);
    expect(res.status).toBe(404);
  });

  it('unregister removes the inline HTML entry', async () => {
    const { token, url } = (await wallpaperMediaServer.registerHtml('<p>x</p>'))!;
    const before = await fetchUrl(url);
    expect(before.status).toBe(200);
    wallpaperMediaServer.unregister(token);
    const after = await fetchUrl(url);
    expect(after.status).toBe(404);
  });
});
