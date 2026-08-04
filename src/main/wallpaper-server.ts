// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Media Server
 *
 * Local HTTP server that streams wallpaper media (mainly large videos) into
 * agent pages over loopback.
 *
 * ## Why this exists
 *
 * The previous injection path read the entire video file into the AgentSkin
 * main process, base64-encoded it (×1.33), transferred it through CDP in
 * chunks, and reassembled it as a `Blob` inside the agent renderer — peaking
 * at ~2.3× the file size in the agent's JS heap. A 500 MB clip could blow
 * past 1 GB and crash the agent renderer.
 *
 * Pointing the injected `<video src>` at a loopback HTTP URL lets the
 * browser's media stack stream + buffer the file itself, so the agent's JS
 * heap only ever holds the URL string. Memory drops from ~2.3× to a few MB
 * of playback buffer regardless of file size.
 *
 * ## Safety
 * - Binds exclusively to `127.0.0.1` (loopback, not reachable from the network).
 * - Each registered file gets a random hex token; only AgentSkin-issued URLs
 *   can fetch a file, so a stray web page cannot enumerate or read local files.
 * - Supports `Range` requests so video seeking / progressive buffering works.
 *
 * Lifecycle: lazily started on first registration, stopped on app quit.
 */

import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, relative, resolve } from 'node:path';

interface MediaEntry {
  filePath: string;
  mime: string;
  size: number;
  /** Entity tag derived from size + mtime so the agent can cache the media. */
  etag: string;
}

/** Extension -> MIME map for files served out of a registered directory. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

class WallpaperMediaServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly entries = new Map<string, MediaEntry>();
  /** Directory roots served for web-type wallpapers (token -> root dir). */
  private readonly dirEntries = new Map<string, { dirPath: string }>();
  /** Inline HTML served for scene-type wallpapers (token -> raw markup). */
  private readonly htmlEntries = new Map<string, { html: string; mime: string }>();

  /** Lazily start the server (idempotent). Resolves once listening. */
  private async ensureStarted(): Promise<void> {
    if (this.server && this.port > 0) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    // Prevent slow loris / fd-leak: enforce timeouts so a hung or malicious
    // client cannot hold a socket open indefinitely. The server is loopback-
    // only, but defense-in-depth is cheap here.
    server.timeout = 60_000;
    server.headersTimeout = 30_000;
    server.maxHeadersCount = 50;
    server.requestTimeout = 60_000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      this.server = server;
      this.port = (server.address() as AddressInfo).port;
    } catch (error) {
      server.close();
      throw error;
    }
  }

  /** Register a media file. Returns the loopback URL, or null on failure. */
  async register(filePath: string, mime: string): Promise<{ token: string; url: string } | null> {
    try {
      const stat = statSync(filePath);
      const size = stat.size;
      await this.ensureStarted();
      const token = randomBytes(16).toString('hex');
      const etag = `"${size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      this.entries.set(token, { filePath, mime, size, etag });
      return { token, url: `http://127.0.0.1:${this.port}/w?t=${token}` };
    } catch (error) {
      // Distinguish "file not found" (common — theme uninstalled) from
      // "port binding failed" (rare but actionable) so the caller knows
      // whether to retry or report a deeper issue.
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        console.warn(`[wallpaper-server] file not found: ${filePath}`);
      } else {
        console.error(`[wallpaper-server] register failed for ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Register an entire directory tree to serve over loopback (web-type
   * wallpapers). Files are streamed on demand, resolved from the URL path
   * segment after the token: `/d/{token}/{filepath}`. This path-based scheme
   * ensures relative URLs inside the web wallpaper's `index.html` resolve
   * correctly when the HTML is loaded in an iframe (e.g. `src="script.js"`
   * resolves to `/d/{token}/script.js`).
   *
   * Returns the base URL (`http://127.0.0.1:{port}/d/{token}/`) — callers
   * append the entry file (e.g. `index.html`) to get the iframe src.
   */
  async registerDirectory(dirPath: string): Promise<{ token: string; url: string } | null> {
    try {
      await this.ensureStarted();
      const token = randomBytes(16).toString('hex');
      this.dirEntries.set(token, { dirPath });
      return { token, url: `http://127.0.0.1:${this.port}/d/${token}/` };
    } catch (error) {
      console.error(`[wallpaper-server] registerDirectory failed for ${dirPath}:`, error);
      return null;
    }
  }

  /**
   * Register a raw HTML string to serve over loopback (scene-type
   * wallpapers). `mime` defaults to `text/html`. Returns the loopback URL,
   * or null on failure.
   */
  async registerHtml(html: string, mime?: string): Promise<{ token: string; url: string } | null> {
    try {
      await this.ensureStarted();
      const token = randomBytes(16).toString('hex');
      this.htmlEntries.set(token, { html, mime: mime ?? 'text/html' });
      return { token, url: `http://127.0.0.1:${this.port}/h?t=${token}` };
    } catch (error) {
      console.error('[wallpaper-server] registerHtml failed:', error);
      return null;
    }
  }

  /** Drop a previously registered entry across all three maps (best-effort). */
  unregister(token: string): void {
    this.entries.delete(token);
    this.dirEntries.delete(token);
    this.htmlEntries.delete(token);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = new URL(req.url ?? '', 'http://localhost');
    const pathname = parsed.pathname ?? '';

    // Path-based directory serving: /d/{token}/{filepath...}
    // Relative URLs in web wallpaper HTML resolve correctly under this scheme
    // (e.g. src="script.js" → /d/{token}/script.js).
    if (pathname.startsWith('/d/')) {
      const segments = pathname.split('/'); // ['', 'd', '{token}', 'file...']
      const dirToken = segments[2] ?? '';
      const filePath = segments.slice(3).join('/');
      this.handleDirectoryPath(dirToken, filePath, res);
      return;
    }

    // Query-based routes (backward-compatible)
    const token = parsed.searchParams.get('t');
    if (!token) {
      res.writeHead(404).end();
      return;
    }
    if (pathname === '/h') {
      this.handleHtml(token, res);
      return;
    }
    // Default (and /w): legacy single-file serving.
    this.handleFile(token, req, res);
  }

  /** Serve a previously registered single media file (supports Range). */
  private handleFile(token: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const entry = this.entries.get(token);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': entry.mime,
      'Accept-Ranges': 'bytes',
      // Wallpaper media is immutable for the lifetime of a token — let the
      // agent cache it so re-mounts don't re-stream.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: entry.etag,
    };

    // Honor conditional requests — answer 304 when the agent's cached copy is fresh.
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === entry.etag) {
      res.writeHead(304, headers).end();
      return;
    }

    // Guard: if the file disappeared (Wallpaper Engine uninstall/update),
    // createReadStream would emit 'error' mid-stream. We re-stat here so we
    // can return a clean 404 instead of relying on the stream error handler
    // (which would have already sent headers by then).
    let sizeNow: number;
    try {
      sizeNow = statSync(entry.filePath).size;
    } catch {
      this.entries.delete(token);
      res.writeHead(404).end();
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : sizeNow - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= sizeNow) {
        res.writeHead(416, { 'Content-Range': `bytes */${sizeNow}` }).end();
        return;
      }
      const clampedEnd = Math.min(end, sizeNow - 1);
      headers['Content-Range'] = `bytes ${start}-${clampedEnd}/${sizeNow}`;
      headers['Content-Length'] = String(clampedEnd - start + 1);
      res.writeHead(206, headers);
      // Attach an error listener: a mid-stream 'error' (file pulled from
      // under us, permission flip, I/O fault) would otherwise become an
      // unhandled EventEmitter error and crash the Electron main process.
      const stream = createReadStream(entry.filePath, { start, end: clampedEnd });
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500).end();
        else res.destroy();
      });
      stream.pipe(res);
      return;
    }

    headers['Content-Length'] = String(sizeNow);
    res.writeHead(200, headers);
    const stream = createReadStream(entry.filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  /**
   * Serve a file from a registered directory tree using path-based routing.
   * The token identifies the registered root; `filePath` is resolved relative
   * to that root. Path traversal is blocked both syntactically (no `..`, no
   * leading slash) and via a post-resolve containment check.
   */
  private handleDirectoryPath(token: string, filePath: string, res: http.ServerResponse): void {
    const entry = this.dirEntries.get(token);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    // Decode percent-encoded file path (URL-encoded by the browser).
    let relPath: string;
    try {
      relPath = decodeURIComponent(filePath);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Syntactic traversal guard: reject any path containing '..' or any
    // path that looks absolute ('/' or '\').
    if (relPath.includes('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
      res.writeHead(403).end();
      return;
    }
    const absRoot = resolve(entry.dirPath);
    const absTarget = resolve(absRoot, relPath);
    // Defense in depth: verify the resolved target stays under the root.
    const rel = relative(absRoot, absTarget);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(403).end();
      return;
    }
    if (rel === '') {
      // Target is the root directory itself; directories are not served.
      res.writeHead(404).end();
      return;
    }

    let size: number;
    try {
      const stat = statSync(absTarget);
      if (!stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      size = stat.size;
    } catch {
      res.writeHead(404).end();
      return;
    }

    const ext = extname(absTarget).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': String(size),
      // Directory assets are mutable on disk; let the browser revalidate.
      'Cache-Control': 'no-cache',
    });
    const stream = createReadStream(absTarget);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  /** Serve a previously registered inline HTML string. */
  private handleHtml(token: string, res: http.ServerResponse): void {
    const entry = this.htmlEntries.get(token);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    const body = Buffer.from(entry.html, 'utf8');
    res.writeHead(200, {
      'Content-Type': entry.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }

  /** Stop the server and forget all registrations (called on app quit). */
  stop(): void {
    this.entries.clear();
    this.dirEntries.clear();
    this.htmlEntries.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }
}

export const wallpaperMediaServer = new WallpaperMediaServer();
