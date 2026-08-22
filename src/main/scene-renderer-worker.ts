// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-worker
 *
 * `worker_threads` entry that runs scene rendering off the main process event
 * loop. Large workshop scenes (50MB+ textures, 100+ objects) parse +
 * base64-encode synchronously and can stall the main process for seconds;
 * this worker isolates that CPU-bound work so IPC handlers stay responsive.
 *
 * The worker is bundled by electron-vite as a separate chunk. The main
 * process imports it via the `?nodeWorker` suffix (see
 * `scene-renderer-async.ts`) which emits a `Worker` wrapper at build time.
 *
 * Message protocol (main → worker):
 *   { requestId, pkgPath, options?, mode? }
 *     - mode === 'full' (default): L2 Canvas 2D renderer with rAF loop
 *     - mode === 'static': L1 zero-runtime static document (no scripts)
 * Worker → main:
 *   { requestId, html }        — success (html may be null on parse failure)
 *   { requestId, error }       — unexpected throw
 */
import { parentPort } from 'node:worker_threads';
import { deriveWeInstallRoot, extractSceneAsync } from './scene-pkg-parser';
import { renderSceneToHtml, renderSceneToStaticHtml } from './scene-renderer-html';
import { buildRenderLayers } from './scene-renderer-layers';
import type { RenderLayer } from './scene-renderer-types';

/**
 * Render mode — defaults to `'full'` (L2 Canvas 2D renderer with rAF loop,
 * particles, and parallax). `'static'` selects the L1 zero-runtime path that
 * outputs a pure `<img>` document with no `<script>` tags.
 */
export type RenderMode = 'static' | 'full';

export interface RenderRequest {
  requestId: number;
  pkgPath: string;
  options?: { weInstallRoot?: string };
  /** @default 'full' */
  mode?: RenderMode;
}

export interface WorkerResponse {
  requestId: number;
  html: string | null;
  /** @internal error string, present only when the worker caught a throw */
  error?: string;
}

/**
 * Asynchronous L1 core: parse + build layers + render pure static HTML.
 *
 * Uses `extractSceneAsync` which enjoys mtime-based caching — repeated renders
 * of the same scene.pkg skip the costly `parsePkg` step. The returned string
 * contains zero `<script>` tags, so there is no runtime overhead beyond the
 * browser's image decode + paint — the L1 zero-runtime contract.
 */
async function renderStaticFromPkgAsync(
  pkgPath: string,
  options?: { weInstallRoot?: string },
): Promise<string | null> {
  // Mirror `renderSceneToHtml`'s parse-failure contract: capture any throw
  // from extractSceneAsync and degrade to null — no error field surfaces to
  // the caller. A "missing / unreadable / truncated" pkg therefore yields the
  // same { html: null, error: undefined } shape as the L2 full path.
  let scene = null;
  try {
    scene = await extractSceneAsync(pkgPath);
  } catch {
    return null;
  }
  if (!scene) return null;

  const weInstallRoot = options?.weInstallRoot ?? deriveWeInstallRoot(pkgPath);

  let layers: RenderLayer[];
  try {
    layers = buildRenderLayers(scene, weInstallRoot);
  } catch {
    return null;
  }
  if (layers.length === 0 && !scene.general.clearEnabled) return null;

  return renderSceneToStaticHtml(layers);
}

/**
 * Pure handler for a single render request — the exact function the worker
 * thread runs for each message. Exported so vitest can exercise the worker's
 * core path without depending on the build-only `?nodeWorker` wrapper.
 *
 * The static ('L1') path uses `extractSceneAsync` which enjoys mtime-based
 * caching — repeated renders of the same scene.pkg skip the costly parse step.
 * See `extractSceneAsync` in `scene/scene-extractor.ts`.
 */
export async function handleRenderRequest(request: RenderRequest): Promise<WorkerResponse> {
  try {
    const html =
      request.mode === 'static'
        ? await renderStaticFromPkgAsync(request.pkgPath, request.options)
        : renderSceneToHtml(request.pkgPath, request.options);
    return { requestId: request.requestId, html };
  } catch (error) {
    return { requestId: request.requestId, html: null, error: String(error) };
  }
}

parentPort?.on('message', async (request: RenderRequest) => {
  // Defensive entry validation — reject malformed messages before touching
  // the render pipeline so a bad sender cannot crash the worker silently.
  if (!request || typeof request.requestId !== 'number' || typeof request.pkgPath !== 'string') {
    parentPort?.postMessage({
      requestId: request?.requestId ?? -1,
      html: null,
      error: 'Invalid request: requestId and pkgPath are required',
    } as WorkerResponse);
    return;
  }

  try {
    const result = await handleRenderRequest(request);
    parentPort?.postMessage(result);
  } catch (error) {
    // handleRenderRequest has its own try/catch around the render pipeline,
    // so this branch is only reachable if postMessage itself throws — a
    // last-resort guard so the worker never silent-hangs.
    parentPort?.postMessage({
      requestId: request.requestId,
      html: null,
      error: error instanceof Error ? error.message : String(error),
    } as WorkerResponse);
  }
});
