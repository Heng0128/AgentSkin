// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/hero-inject
 *
 * Hero image injection helpers. Converts local hero images to in-memory
 * Blob URLs inside the agent page, bypassing file:// CSP restrictions.
 *
 * Extracted from the split of {@link ./shared}.
 */

import { readFile } from 'node:fs/promises';
import { toMessage } from '../../../shared/errors';
import { HERO_CHUNKS_GLOBAL, WALLPAPER_CHUNK_SIZE } from '../../../shared/injection-constants';
import { mainWarn } from '../../logger';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// Hero blob injection
// ---------------------------------------------------------------------------

/**
 * Threshold above which hero base64 is transferred in chunks instead of
 * inlined into a single Runtime.evaluate expression. P1 audit #10: inlining
 * a 800KB hero → 1.1MB base64 string into a single CDP evaluate expression
 * caused 30s timeouts on some targets. Chunking at ~2MB per evaluate call
 * (same as wallpaper video transfer) keeps each WebSocket message small
 * enough to stay well under the CDP timeout. Heroes below this threshold
 * skip chunking overhead and go direct.
 */
const HERO_CHUNK_THRESHOLD = 256 * 1024;

/**
 * Transfer base64-encoded hero image data into the agent page and set it as
 * `--agentskin-art` via an in-memory Blob URL (bypasses file:// CSP).
 *
 * P1 audit #10: previously the entire base64 string was inlined into a single
 * Runtime.evaluate expression. For hero images ≥500KB (→ ~680KB+ base64) this
 * hit CDP's implicit single-message size limit and timed out at 30s. Now uses
 * the same chunked-transfer strategy as the wallpaper video injector:
 *   1. Initialize a chunk accumulator on `window`.
 *   2. Push base64 in ~2MB chunks via separate evaluate calls.
 *   3. Assemble a Blob URL in-page and set the CSS variable.
 *
 * Small heroes (<256KB base64) skip chunking and go direct — the overhead of
 * N round-trips outweighs the size benefit for typical ~100KB hero art.
 */
export async function transferHeroBase64(
  session: CdpSession,
  base64: string,
  mime: string,
): Promise<boolean> {
  // Small heroes: direct inline evaluate is fine and avoids chunking overhead.
  if (base64.length <= HERO_CHUNK_THRESHOLD) {
    try {
      const result = await session.evaluate(`(async () => {
        try {
          const b64 = ${JSON.stringify(base64)};
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: ${JSON.stringify(mime)} });
          // P1-5: Revoke the previous hero Blob URL (if any) before creating a
          // new one. Without this every apply or retry leaked a hero-sized
          // Blob reference: switching themes 20 times accumulated ~20 MB of
          // orphaned Blobs in the renderer.
          try {
            const prev = document.documentElement.dataset.agentskinArtBlobUrl;
            if (prev) URL.revokeObjectURL(prev);
          } catch (e) { /* ignore revoke failures */ }
          const url = URL.createObjectURL(blob);
          document.documentElement.dataset.agentskinArtBlobUrl = url;
          document.documentElement.style.setProperty('--agentskin-art', 'url(' + url + ')');
          return 'ok';
        } catch(e) { return 'err:' + e.message; }
      })()`);
      if (!result.startsWith('ok')) {
        mainWarn('Inject.Hero', `small-hero renderer evaluate failed: ${String(result)}`);
      }
      return result.startsWith('ok');
    } catch (error) {
      mainWarn('Inject.Hero', `small-hero CDP evaluate failed: ${toMessage(error)}`);
      return false;
    }
  }

  // Large heroes: chunk the base64 to keep each CDP message small.
  try {
    // Step 1: initialize the chunk accumulator.
    await session.evaluate(`window.${HERO_CHUNKS_GLOBAL} = []; 'init';`);

    // Step 2: push base64 in ~2MB chunks.
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      await session.evaluate(`window.${HERO_CHUNKS_GLOBAL}.push(${JSON.stringify(chunk)});`);
    }

    // Step 3: assemble the Blob URL in-page and set the CSS variable.
    const result = await session.evaluate(`(async () => {
      try {
        const b64 = window.${HERO_CHUNKS_GLOBAL}.join('');
        delete window.${HERO_CHUNKS_GLOBAL};
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: ${JSON.stringify(mime)} });
        // P1-5: Revoke any previous hero blob URL before creating a new one so
        // retries and repeated theme applies don't leak Blob references.
        try {
          const prev = document.documentElement.dataset.agentskinArtBlobUrl;
          if (prev) URL.revokeObjectURL(prev);
        } catch (e) { /* ignore revoke failures */ }
        const url = URL.createObjectURL(blob);
        document.documentElement.dataset.agentskinArtBlobUrl = url;
        document.documentElement.style.setProperty('--agentskin-art', 'url(' + url + ')');
        return 'ok';
      } catch(e) {
        try { delete window.${HERO_CHUNKS_GLOBAL}; } catch (_) {}
        return 'err:' + e.message;
      }
    })()`);
    if (!result.startsWith('ok')) {
      mainWarn('Inject.Hero', `chunked-hero renderer assemble failed: ${String(result)}`);
    }
    return result.startsWith('ok');
  } catch (error) {
    mainWarn('Inject.Hero', `chunked-hero CDP transfer failed: ${toMessage(error)}`);
    // Best-effort cleanup of the accumulator on failure.
    try {
      await session.evaluate(`try { delete window.${HERO_CHUNKS_GLOBAL}; } catch(e) {} 'cleanup';`);
    } catch {
      // ignore cleanup errors (already logging primary failure above)
    }
    return false;
  }
}

export async function injectHeroBlob(session: CdpSession, heroPath: string): Promise<boolean> {
  try {
    const data = await readFile(heroPath);
    const base64 = data.toString('base64');
    const mime = heroPath.endsWith('.png')
      ? 'image/png'
      : heroPath.endsWith('.jpg') || heroPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/webp';
    return await transferHeroBase64(session, base64, mime);
  } catch (error) {
    mainWarn('Inject.Hero', `read local hero failed (${heroPath}): ${toMessage(error)}`);
    return false;
  }
}

/**
 * Inject hero art from a data URL (data:image/webp;base64,...).
 * Used by the engine integration where ResolvedThemeTarget provides
 * imageDataUrls.hero as a data URL rather than a file path.
 */
export async function injectHeroFromDataUrl(
  session: CdpSession,
  dataUrl: string,
): Promise<boolean> {
  try {
    // Extract mime and base64 payload from the data URL
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) {
      mainWarn('Inject.Hero', `inject data-url: malformed data URL (len=${dataUrl.length})`);
      return false;
    }
    const mime = match[1] || 'image/webp';
    const base64 = match[2];
    return await transferHeroBase64(session, base64, mime);
  } catch (error) {
    mainWarn('Inject.Hero', `inject data-url parse failed: ${toMessage(error)}`);
    return false;
  }
}
