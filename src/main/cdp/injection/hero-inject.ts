// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/hero-inject
 *
 * Image injection helpers. Converts theme images (hero + multi-asset) to
 * in-memory Blob URLs inside the agent page, bypassing file:// CSP
 * restrictions.
 *
 * Extracted from the split of {@link ./shared}.
 */

import { readFile } from 'node:fs/promises';
import { toMessage } from '../../../shared/errors';
import { HERO_CHUNKS_GLOBAL, WALLPAPER_CHUNK_SIZE } from '../../../shared/injection-constants';
import { mainWarn } from '../../logger';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// Image blob injection
// ---------------------------------------------------------------------------

/**
 * Threshold above which image base64 is transferred in chunks instead of
 * inlined into a single Runtime.evaluate expression. P1 audit #10: inlining
 * a 800KB hero → 1.1MB base64 string into a single CDP evaluate expression
 * caused 30s timeouts on some targets. Chunking at ~2MB per evaluate call
 * (same as wallpaper video transfer) keeps each WebSocket message small
 * enough to stay well under the CDP timeout. Images below this threshold
 * skip chunking overhead and go direct.
 */
const HERO_CHUNK_THRESHOLD = 256 * 1024;

/**
 * A single CSS-variable target for one Blob URL: the custom property to set
 * and the `data-*` dataset key that records the URL so a later apply/retry
 * can revoke it (P1-5 leak prevention).
 */
interface BlobCssTarget {
  /** CSS custom property, e.g. `--agentskin-art` or `--agentskin-asset-hero`. */
  var: string;
  /** dataset key (without `data-` prefix), e.g. `agentskinArtBlobUrl`. */
  dataset: string;
}

/**
 * Shared single-image transfer kernel: base64 → Blob URL → set one or more
 * CSS variables on `document.documentElement`. Handles the direct (<256KB)
 * and chunked (≥256KB) paths. Each target's previous Blob URL is revoked
 * before the new one is recorded so repeated applies don't leak Blobs.
 */
async function injectBlobCssVar(
  session: CdpSession,
  base64: string,
  mime: string,
  targets: BlobCssTarget[],
): Promise<boolean> {
  const targetsJson = JSON.stringify(targets);
  const setVarsBody = `
        const targets = ${targetsJson};
        for (const t of targets) {
          try {
            const prev = document.documentElement.dataset[t.dataset];
            if (prev) URL.revokeObjectURL(prev);
          } catch (e) { /* ignore revoke failures */ }
          document.documentElement.dataset[t.dataset] = url;
          document.documentElement.style.setProperty(t.var, 'url(' + url + ')');
        }`;

  // Small images: direct inline evaluate is fine and avoids chunking overhead.
  if (base64.length <= HERO_CHUNK_THRESHOLD) {
    try {
      const result = await session.evaluate(`(async () => {
        try {
          const b64 = ${JSON.stringify(base64)};
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: ${JSON.stringify(mime)} });
          const url = URL.createObjectURL(blob);
          ${setVarsBody}
          return 'ok';
        } catch(e) { return 'err:' + e.message; }
      })()`);
      if (!result.startsWith('ok')) {
        mainWarn('Inject.Hero', `small-image renderer evaluate failed: ${String(result)}`);
      }
      return result.startsWith('ok');
    } catch (error) {
      mainWarn('Inject.Hero', `small-image CDP evaluate failed: ${toMessage(error)}`);
      return false;
    }
  }

  // Large images: chunk the base64 to keep each CDP message small.
  // Hardened 2026-08-23 (theme hero 变色块): the previous loop used bare
  // `session.evaluate` with no retry — a single transport glitch (timeout /
  // socket backpressure during the ~16 chunk round-trips a 5 MB+ hero
  // requires) aborted the whole transfer, leaving `--agentskin-art` as
  // `none` and the background as a flat colour block. Each chunk now retries
  // with backoff and the transfer verifies chunk count before assembling.
  try {
    // Step 1: initialize the chunk accumulator.
    await session.evaluate(`window.${HERO_CHUNKS_GLOBAL} = []; 'init';`);

    // Step 2: push base64 in ~512KB chunks, retrying transport-level
    // failures so one transient timeout doesn't kill a 5MB+ hero transfer.
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    const CHUNK_MAX_RETRIES = 2;
    const CHUNK_RETRY_DELAY_MS = 800;
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      const expr = `window.${HERO_CHUNKS_GLOBAL}.push(${JSON.stringify(chunk)});`;
      let lastError: unknown;
      let pushed = false;
      let retried = false;
      for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
        try {
          await session.evaluate(expr);
          pushed = true;
          break;
        } catch (error) {
          lastError = error;
          const msg = error instanceof Error ? error.message : String(error);
          if (attempt < CHUNK_MAX_RETRIES) {
            retried = true;
            await new Promise((r) => setTimeout(r, CHUNK_RETRY_DELAY_MS));
          }
          void msg; // transport retry only; renderer errors re-throw naturally below
        }
      }
      if (!pushed) {
        mainWarn(
          'Inject.Hero',
          `chunk ${i}/${totalChunks} failed after retries: ${toMessage(lastError)}`,
        );
        throw lastError ?? new Error(`chunk ${i}/${totalChunks} failed`);
      }
      if (retried) mainWarn('Inject.Hero', `chunk ${i}/${totalChunks} required retry`);
    }
    if (totalChunks > 0) {
      mainWarn(
        'Inject.Hero',
        `chunked transfer ok: ${totalChunks} chunks for ${(base64.length / 1024 / 1024).toFixed(2)}MB base64`,
      );
    }

    // Step 3: safe-assemble — verify every chunk landed before joining; if
    // any is missing, treat as failure instead of mounting a corrupted image.
    const result = await session.evaluate(`(async () => {
      try {
        const chunks = window.${HERO_CHUNKS_GLOBAL} || [];
        if (chunks.length !== ${totalChunks}) {
          delete window.${HERO_CHUNKS_GLOBAL};
          return 'err:chunk-mismatch(' + chunks.length + '/' + ${totalChunks} + ')';
        }
        const b64 = chunks.join('');
        delete window.${HERO_CHUNKS_GLOBAL};
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: ${JSON.stringify(mime)} });
        const url = URL.createObjectURL(blob);
        ${setVarsBody}
        return 'ok';
      } catch(e) {
        try { delete window.${HERO_CHUNKS_GLOBAL}; } catch (e) { console.warn('[hero-inject] cleanup chunks failed:', e); }
        return 'err:' + e.message;
      }
    })()`);
    if (!result.startsWith('ok')) {
      mainWarn('Inject.Hero', `chunked-image renderer assemble failed: ${String(result)}`);
    }
    return result.startsWith('ok');
  } catch (error) {
    mainWarn('Inject.Hero', `chunked-image CDP transfer failed: ${toMessage(error)}`);
    // Best-effort cleanup of the accumulator on failure.
    try {
      await session.evaluate(
        `try { delete window.${HERO_CHUNKS_GLOBAL}; } catch (e) { console.warn('[hero-inject] cleanup chunks failed:', e); } 'cleanup';`,
      );
    } catch {
      // ignore cleanup errors (already logging primary failure above)
    }
    return false;
  }
}

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
  return injectBlobCssVar(session, base64, mime, [
    { var: '--agentskin-art', dataset: 'agentskinArtBlobUrl' },
  ]);
}

/** Result of injecting a full image set (2a multi-asset). */
export interface ImageSetResult {
  /** Asset ids whose `--agentskin-asset-<id>` was successfully set (includes `hero`). */
  injectedIds: string[];
  /** Whether the `hero` asset (→ `--agentskin-art` alias) was injected. */
  heroInjected: boolean;
}

const ASSET_ID = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * 2a multi-asset injection: transfer every image in `imageDataUrls` into the
 * agent page as `--agentskin-asset-<id>` Blob URLs (bypasses file:// CSP).
 * The `hero` entry is also aliased to `--agentskin-art` so existing consumers
 * (adapter config, verification) keep reading the single art variable.
 *
 * Non-safe ids and malformed data URLs are skipped individually — one bad
 * asset never blocks the rest.
 */
export async function transferImageSet(
  session: CdpSession,
  imageDataUrls: Record<string, string>,
): Promise<ImageSetResult> {
  const injectedIds: string[] = [];
  for (const [id, dataUrl] of Object.entries(imageDataUrls)) {
    if (!ASSET_ID.test(id)) {
      mainWarn('Inject.Hero', `transferImageSet: skipping unsafe asset id '${id}'`);
      continue;
    }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      mainWarn('Inject.Hero', `transferImageSet: skipping malformed data URL for '${id}'`);
      continue;
    }
    const targets: BlobCssTarget[] = [
      { var: `--agentskin-asset-${id}`, dataset: `agentskinAssetBlobUrl_${id}` },
    ];
    // hero also drives the legacy single-art variable.
    if (id === 'hero') {
      targets.push({ var: '--agentskin-art', dataset: 'agentskinArtBlobUrl' });
    }
    const ok = await injectBlobCssVar(session, parsed.base64, parsed.mime, targets);
    if (ok) injectedIds.push(id);
  }
  return { injectedIds, heroInjected: injectedIds.includes('hero') };
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
 * Inject the hero by pointing the CSS variables at an agentskin-theme:// URL.
 * The renderer streams the ORIGINAL wallpaper file straight from disk (zero
 * compression, zero base64 over CDP) — the only approach that does not time
 * out for multi-MB 4K/8K backdrops (chunked base64 transfer routinely hit
 * the CDP Runtime.evaluate timeout).
 *
 * Returns true when the evaluate succeeded (variables set).
 */
export async function injectHeroFromProtocolUrl(
  session: CdpSession,
  protocolUrl: string,
): Promise<boolean> {
  const expr = `(function(){
    document.documentElement.dataset.agentskinArtBlobUrl = ${JSON.stringify(protocolUrl)};
    document.documentElement.style.setProperty('--agentskin-art', 'url("${protocolUrl}")');
    document.documentElement.style.setProperty('--agentskin-asset-hero', 'url("${protocolUrl}")');
    return true;
  })()`;
  try {
    const result = await session.evaluate(expr);
    // evaluate() always returns a string — the IIFE returns `true`, which
    // String(result) normalizes to 'true'.
    return result === 'true';
  } catch (error) {
    mainWarn('Inject.Hero', `protocol hero inject failed (${protocolUrl}): ${toMessage(error)}`);
    return false;
  }
}

/**
 * Split a `data:<mime>[;base64],<payload>` URL into its mime + payload parts.
 * Returns null for non-data URLs (the caller decides how to handle it).
 */
function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1] || 'image/webp', base64: match[2] };
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
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      mainWarn('Inject.Hero', `inject data-url: malformed data URL (len=${dataUrl.length})`);
      return false;
    }
    return await transferHeroBase64(session, parsed.base64, parsed.mime);
  } catch (error) {
    mainWarn('Inject.Hero', `inject data-url parse failed: ${toMessage(error)}`);
    return false;
  }
}
