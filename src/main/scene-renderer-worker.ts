// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-worker
 *
 * `worker_threads` entry that runs `renderSceneToHtml` off the main process
 * event loop. Large workshop scenes (50MB+ textures, 100+ objects) parse +
 * base64-encode synchronously and can stall the main process for seconds;
 * this worker isolates that CPU-bound work so IPC handlers stay responsive.
 *
 * The worker is bundled by electron-vite as a separate chunk. The main
 * process imports it via the `?nodeWorker` suffix (see
 * `scene-renderer-async.ts`) which emits a `Worker` wrapper at build time.
 *
 * Message protocol (main → worker):
 *   { requestId, pkgPath, options? }
 * Worker → main:
 *   { requestId, html }        — success (html may be null on parse failure)
 *   { requestId, error }       — unexpected throw
 */
import { parentPort } from 'node:worker_threads';
import { renderSceneToHtml } from './scene-renderer-html';

interface RenderRequest {
  requestId: number;
  pkgPath: string;
  options?: { weInstallRoot?: string };
}

export interface WorkerResponse {
  requestId: number;
  html: string | null;
  /** @internal error string, present only when the worker caught a throw */
  error?: string;
}

/**
 * Pure handler for a single render request — the exact function the worker
 * thread runs for each message. Exported so vitest can exercise the worker's
 * core path without depending on the build-only `?nodeWorker` wrapper.
 */
export function handleRenderRequest(request: RenderRequest): WorkerResponse {
  try {
    return {
      requestId: request.requestId,
      html: renderSceneToHtml(request.pkgPath, request.options),
    };
  } catch (error) {
    return { requestId: request.requestId, html: null, error: String(error) };
  }
}

parentPort?.on('message', (request: RenderRequest) => {
  parentPort?.postMessage(handleRenderRequest(request));
});
