// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-wallpaper-inject (pipeline stage)
 *
 * Page-side wallpaper injection through the unified engine's `NS.wallpaper`
 * namespace. The injection scripts previously embedded inline JS expressions
 * (video/image/web mounts, CSS builders, parallax, signal bridge); that body
 * now lives in `engines/unified/engine.mjs` (§10 Wallpaper block). This module
 * ships a tiny evaluate wrapper so callers continue to inject wallpaper media
 * without rebuilding script strings in the main process.
 *
 * ## Why this module still exists
 *
 * The orchestration layer (`wallpaper-injector.ts`) needs:
 *   - A pure-function contract (`injectImageWallpaper`, `injectVideoWallpaper`,
 *     `injectWebWallpaper`, `removeAllWallpapers`) so the multi-target pipeline
 *     can track verdicts and drive fallback/scheme policy.
 *   - A place to enforce the CSP+Page.setBypassCSP handshake that the engine's
 *     own in-page helpers cannot do (Page.setBypassCSP is a CDP command, not a
 *     browser API).
 *
 * CDP transport (Page.enable/setBypassCSP + Runtime.evaluate + retry) is the
 * main process's responsibility — it owns the WebSocket session. So are the
 * size-blob thresholds, base64 chunking, and media-server token management.
 *
 * ### Layering summary
 *
 *   1. Main process (this module, session wrapper via `CdpSession`)
 *        → Page.setBypassCSP + Runtime.evaluate `NS.wallpaper.*`
 *   2. Page (engines/unified/engine.mjs §10)
 *        → Element construction + attribute/size reconciliation + verdict
 *
 * Re-export contract preserved for all existing consumers.
 */

import { readFile } from 'node:fs/promises';
import {
  MAX_VIDEO_BLOB_BYTES,
  WALLPAPER_CHUNK_SIZE,
  WALLPAPER_CHUNKS_GLOBAL,
  WALLPAPER_DATA_URL_GLOBAL,
} from '../../shared/injection-constants';
import type { WallpaperRenderOptions } from '../../shared/types';
import type { CdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// Helpers (main-process side of CSP + retry)
// ---------------------------------------------------------------------------

/**
 * Three-layer CSP bypass, kept at the main-process layer because
 * `Page.setBypassCSP` is a CDP command. Layer 2 (meta-tag removal) is an
 * in-page evaluate so that the engine's own mount helpers can run Bypass-1 /
 * Bypass-2-eval without re-entering the command boundary.
 */
export async function bypassPageCsp(session: CdpSession): Promise<boolean> {
  let anySucceeded = false;
  try {
    await session.send('Page.enable');
    await session.send('Page.setBypassCSP', { enabled: true });
    anySucceeded = true;
  } catch (error) {
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 1 (Page.setBypassCSP) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await session.evaluate(`(() => {
      document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function(m){ m.remove(); });
      return 'csp-meta-removed';
    })()`);
    anySucceeded = true;
  } catch (error) {
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 2 (CSP meta removal) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const cspStatus = await session.evaluate(`(() => {
      try {
        var meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return meta ? 'meta-csp-present' : 'no-meta-csp';
      } catch(e) { return 'probe-failed:' + e.message; }
    })()`);
    if (cspStatus === 'no-meta-csp' && !anySucceeded) {
      console.warn(
        '[cdp-wallpaper] bypassPageCsp: all bypass layers failed — CSP is header-based. Blob/data: URL fallback is the remaining path.',
      );
    }
  } catch (error) {
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 3 (CSP probe) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return anySucceeded;
}

const CHUNK_EVAL_MAX_RETRIES = 2;
const CHUNK_EVAL_RETRY_DELAY_MS = 1000;

/** Transport-level retry for chunked evaluate calls (see docstring in old shared.ts). */
export async function evaluateWithRetry(
  session: CdpSession,
  expression: string,
  _label?: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CHUNK_EVAL_MAX_RETRIES; attempt++) {
    try {
      return await session.evaluate(expression);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Renderer evaluation failed')) throw error;
      if (attempt < CHUNK_EVAL_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, CHUNK_EVAL_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// MIME detection (kept main-process: depends on Node path)
// ---------------------------------------------------------------------------

export function videoMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

export function imageMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// NS.wallpaper call-builders
// ---------------------------------------------------------------------------

/** Wrap a `NS.wallpaper.<method>(opts)` call as a returnable evaluate expression. */
function evalWallpaper(
  method: 'applyImage' | 'applyVideo' | 'applyWeb' | 'removeAll',
  opts?: Record<string, unknown>,
): string {
  const args = opts ? JSON.stringify(opts) : '{}';
  return `window.__agentskin__.wallpaper.${method}(${args})`;
}

// ---------------------------------------------------------------------------
// Public injectors
// ---------------------------------------------------------------------------

interface MountImageWallpaperOptions {
  url: string;
  scrimOpacity?: number;
  render?: WallpaperRenderOptions;
}

/** Inject a full-bleed static image via a pre-built URL (loopback http or blob). */
export async function injectImageWallpaperByUrl(
  session: CdpSession,
  options: MountImageWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { url, render } = options;
  if (!url || typeof url !== 'string') return { ok: false, verdict: 'invalid-url' };
  // The engine requires the leading "url(...)" wrapper; preserve prior behaviour.
  const payload = `url(${url})`;
  try {
    const r = await session.evaluate(evalWallpaper('applyImage', { src: payload, render }));
    const v = String(r);
    return { ok: v === 'ok', verdict: v };
  } catch (e) {
    return { ok: false, verdict: `throw:${e instanceof Error ? e.message : String(e)}` };
  }
}

interface InjectImageWallpaperOptions {
  imagePath: string;
  forceInject?: boolean;
  scrimOpacity?: number;
  render?: WallpaperRenderOptions;
}

/** Inject a static image by chunked base64 transfer when below the blob cap. */
export async function injectImageWallpaper(
  session: CdpSession,
  options: InjectImageWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { imagePath, forceInject = false } = options;
  // NOTE: size-blob cap is enforced upstream where stat info is available.
  if (!forceInject) {
    // honour upstream contract — caller already decided blob vs http
  }
  try {
    const buf = await readFile(imagePath);
    // Cap is enforced by the stat() check upstream; this module trusts caller.
    const base64 = buf.toString('base64');
    const mime = imageMimeForPath(imagePath);
    await initChunks(session);
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      await evaluateWithRetry(session, pushChunkExpr(chunk), `image-chunk-${i}/${totalChunks}`);
    }
    await session.evaluate(assembleExpr(mime));
    // The assembled data URL is read from the global by the engine's applyImage.
    const r = await session.evaluate(
      evalWallpaper('applyImage', { srcGlobal: WALLPAPER_DATA_URL_GLOBAL }),
    );
    const v = String(r);
    return { ok: v === 'ok', verdict: v };
  } catch (e) {
    return { ok: false, verdict: `throw:${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Init the page-side chunk accumulator. */
async function initChunks(session: CdpSession): Promise<void> {
  const expr = `(() => { if (window.${WALLPAPER_CHUNKS_GLOBAL}) delete window.${WALLPAPER_CHUNKS_GLOBAL}; return 'init'; })()`;
  await session.evaluate(expr);
}

function pushChunkExpr(chunk: string): string {
  return `(() => { if (!window.${WALLPAPER_CHUNKS_GLOBAL}) window.${WALLPAPER_CHUNKS_GLOBAL} = []; window.${WALLPAPER_CHUNKS_GLOBAL}.push(${JSON.stringify(chunk)}); return 'push'; })()`;
}

function assembleExpr(mime: string): string {
  return `(() => { var b = window.${WALLPAPER_CHUNKS_GLOBAL}.join(''); delete window.${WALLPAPER_CHUNKS_GLOBAL}; window.${WALLPAPER_DATA_URL_GLOBAL} = 'data:${mime};base64,' + b; return 'assembled'; })()`;
}

interface InjectVideoWallpaperOptions {
  url: string;
  mime: string;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
  render?: WallpaperRenderOptions;
}

/** Inject video wallpaper from an already-playable URL (streamed by the browser). */
export async function injectVideoWallpaper(
  session: CdpSession,
  options: InjectVideoWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { url, mime, speed = 1, loop = true, render } = options;
  if (!url || typeof url !== 'string') return { ok: false, verdict: 'invalid-url' };
  try {
    await bypassPageCsp(session);
    const r = await session.evaluate(
      evalWallpaper('applyVideo', { src: url, mime, speed, loop, render }),
    );
    const v = String(r);
    return { ok: v === 'ok', verdict: v };
  } catch (e) {
    return { ok: false, verdict: `throw:${e instanceof Error ? e.message : String(e)}` };
  }
}

interface InjectVideoWallpaperByBase64Options {
  videoPath: string;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
  render?: WallpaperRenderOptions;
}

/**
 * Inject a video wallpaper by reading the file, base64-encoding, and chunking
 * it to the page; the engine then mounts the assembled-data: URL via applyVideo.
 */
export async function injectVideoWallpaperByBase64(
  session: CdpSession,
  options: InjectVideoWallpaperByBase64Options,
): Promise<{ ok: boolean; verdict: string }> {
  const { videoPath, speed = 1, loop = true, render } = options;
  try {
    const buf = await readFile(videoPath);
    if (buf.byteLength > MAX_VIDEO_BLOB_BYTES) return { ok: false, verdict: 'oversize' };
    const base64 = buf.toString('base64');
    const mime = videoMimeForPath(videoPath);
    await bypassPageCsp(session);
    await initChunks(session);
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      await evaluateWithRetry(session, pushChunkExpr(chunk), `video-chunk-${i}/${totalChunks}`);
    }
    await session.evaluate(assembleExpr(mime));
    const r = await session.evaluate(
      evalWallpaper('applyVideo', {
        mime,
        speed,
        loop,
        render,
        srcGlobal: WALLPAPER_DATA_URL_GLOBAL,
      }),
    );
    const v = String(r);
    return { ok: v === 'ok', verdict: v };
  } catch (e) {
    return { ok: false, verdict: `throw:${e instanceof Error ? e.message : String(e)}` };
  }
}

interface InjectWebWallpaperOptions {
  url: string;
  scrimOpacity?: number;
  render?: WallpaperRenderOptions;
}

/** Inject a web/scene wallpaper via iframe. */
export async function injectWebWallpaper(
  session: CdpSession,
  options: InjectWebWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { url, render } = options;
  if (!url || typeof url !== 'string') return { ok: false, verdict: 'invalid-url' };
  try {
    await bypassPageCsp(session);
    const r = await session.evaluate(evalWallpaper('applyWeb', { url, render }));
    const v = String(r);
    return { ok: v === 'ok', verdict: v };
  } catch (e) {
    return { ok: false, verdict: `throw:${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Remove any injected wallpaper (image/video/web) from an agent's page. */
export async function removeAllWallpapers(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(evalWallpaper('removeAll'));
  } catch {
    // best-effort
  }
}
