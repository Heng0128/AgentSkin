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

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

interface MediaEntry {
  filePath: string;
  mime: string;
  size: number;
}

class WallpaperMediaServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly entries = new Map<string, MediaEntry>();

  /** Lazily start the server (idempotent). Resolves once listening. */
  private async ensureStarted(): Promise<void> {
    if (this.server && this.port > 0) return;
    const server = http.createServer((req, res) => this.handle(req, res));
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
      const size = statSync(filePath).size;
      await this.ensureStarted();
      const token = randomBytes(16).toString('hex');
      this.entries.set(token, { filePath, mime, size });
      return { token, url: `http://127.0.0.1:${this.port}/w?t=${token}` };
    } catch {
      return null;
    }
  }

  /** Drop a previously registered file (best-effort; entries also cleared on stop). */
  unregister(token: string): void {
    this.entries.delete(token);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('t');
    const entry = token ? this.entries.get(token) : undefined;
    if (!entry) {
      res.writeHead(404).end();
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': entry.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : entry.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= entry.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${entry.size}` }).end();
        return;
      }
      const clampedEnd = Math.min(end, entry.size - 1);
      headers['Content-Range'] = `bytes ${start}-${clampedEnd}/${entry.size}`;
      headers['Content-Length'] = String(clampedEnd - start + 1);
      res.writeHead(206, headers);
      createReadStream(entry.filePath, { start, end: clampedEnd }).pipe(res);
      return;
    }

    headers['Content-Length'] = String(entry.size);
    res.writeHead(200, headers);
    createReadStream(entry.filePath).pipe(res);
  }

  /** Stop the server and forget all registrations (called on app quit). */
  stop(): void {
    this.entries.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }
}

export const wallpaperMediaServer = new WallpaperMediaServer();
