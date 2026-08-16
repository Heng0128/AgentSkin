// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-async
 *
 * Async (non-blocking) variant of `renderSceneToHtml`. It runs the CPU-bound
 * scene parse + HTML build in a `worker_threads.Worker` so large workshop
 * scenes don't stall the main process event loop (see A-25 in
 * `scene-renderer-html.ts`).
 *
 * The worker is imported via electron-vite's `?nodeWorker` suffix, which is a
 * **build-only** plugin (it emits a `Worker` wrapper + separate chunk at
 * build time). To keep the vitest import graph clean (vitest does not run the
 * build-only plugin), this module copies the heavy work into a worker through
 * a runtime `await import('...?nodeWorker')` — never a static top-level import.
 *
 * The synchronous `renderSceneToHtml` is intentionally kept for unit tests
 * (they assert on string content directly); production callers should use this
 * async module instead.
 */
import type { WorkerResponse } from './scene-renderer-worker';

export type { RenderLayer } from './scene-renderer-types';

let requestSeq = 0;

/**
 * Render a scene.pkg file into a self-contained HTML string without blocking
 * the main process.
 *
 * @param pkgPath Absolute path to the `.pkg` file.
 * @param options Optional resolution context (see `renderSceneToHtml`).
 * @returns A complete HTML document string, or `null` if the pkg could not be
 *          parsed or contains no renderable content.
 */
export async function renderSceneToHtmlAsync(
  pkgPath: string,
  options?: { weInstallRoot?: string },
): Promise<string | null> {
  const createWorker = (await import('./scene-renderer-worker?nodeWorker')).default;

  const requestId = ++requestSeq;
  const worker = createWorker();

  return new Promise<string | null>((resolve, reject) => {
    worker.on('message', (msg: WorkerResponse) => {
      if (msg.requestId !== requestId) return;
      worker.terminate();
      if (msg.error) {
        reject(new Error(`scene render worker failed: ${msg.error}`));
        return;
      }
      resolve(msg.html);
    });
    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
    worker.on('exit', (code) => {
      // If the worker exits before responding, degrade to null (same contract
      // as a parse failure) rather than rejecting the IPC handler.
      reject(new Error(`scene render worker exited with code ${code} before responding`));
    });
    worker.postMessage({ requestId, pkgPath, options });
  });
}
