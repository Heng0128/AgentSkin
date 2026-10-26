// SPDX-License-Identifier: MPL-2.0 OR MIT

/**
 * # Full Scene Frame Renderer — bridge to the ported WE renderer worker
 *
 * Renders a Wallpaper Engine scene (scene.pkg, or a loose scene.json
 * directory) into a complete PNG frame using the CPU renderer ported from
 * dsh-plugin-wallpaper-engine (MIT, see ./we-renderer/ + ./scene-renderer.js).
 *
 * ## Execution model
 *
 * The renderer is synchronous CPU rasterization — a 1080p frame takes
 * roughly 1-2s, 4K several seconds. It MUST NOT run on the main-process
 * event loop, so production execution happens in a dedicated worker thread:
 * `scene-render-worker.js`, bundled as a second main entry by
 * electron-vite (see electron.vite.config.ts) and spawned from
 * `__dirname` — the same pattern as the texture-decode pool.
 *
 * When the worker file cannot be resolved (vitest, or a build without the
 * worker entry), rendering falls back to in-process execution of the same
 * SceneRenderer — blocking, but correct; the fallback keeps the module
 * testable and keeps preview generation alive if the worker entry is ever
 * dropped from the bundle.
 *
 * ## Empty-frame gating
 *
 * The worker samples the rendered frame against the scene clear color and
 * reports `diff/checked` (fraction of sampled pixels differing by >24 per
 * channel). A frame where essentially nothing differs from the background
 * is treated as a failed render by the caller (the static-frame extractor's
 * degradation chain takes over) — ported from the dsh plugin's 空帧门禁.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/** Hard deadline for one frame render (worker + inline). The dsh plugin used
 *  600s for multi-frame APNG jobs; a single static frame is far cheaper, but
 *  pathological scenes (huge pkg + puppet + particles) still need headroom. */
const RENDER_TIMEOUT_MS = 120_000;

interface WorkerOkMessage {
  ok: true;
  png: Uint8Array;
  diff: number;
  checked: number;
}

interface WorkerErrorMessage {
  ok: false;
  error: string;
}

type WorkerMessage =
  | WorkerOkMessage
  | WorkerErrorMessage
  | { progress: true; done: number; total: number };

export interface SceneFrameRequest {
  /** Absolute path to scene.pkg, a scene.json file, or its loose directory. */
  pkgPath: string;
  /** Output width in pixels (default 1920). */
  width?: number;
  /** Output height in pixels (default 1080). */
  height?: number;
  /** Scene time in seconds to render (default 0). */
  time?: number;
  /** Wallpaper Engine install dir whose assets/ holds global textures. */
  weAssetsDir?: string | null;
}

export interface SceneFrameResult {
  /** Encoded PNG bytes of the rendered frame. */
  png: Buffer;
  /** Sampled pixels differing from the clear color (empty-frame gate). */
  diff: number;
  /** Total sampled pixels. */
  checked: number;
}

/**
 * Resolve the bundled worker script. Returns null when it does not exist
 * next to this module (vitest runs from source; the .js bundle only exists
 * in the electron-vite output directory).
 */
function resolveWorkerPath(): string | null {
  const candidate = path.join(__dirname, 'scene-render-worker.js');
  try {
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Render one scene frame. Returns null on any failure (unparseable scene,
 * worker crash, timeout, blank frame) — callers own the fallback.
 */
export async function renderSceneFrame(req: SceneFrameRequest): Promise<SceneFrameResult | null> {
  const workerPath = resolveWorkerPath();
  if (!workerPath) return renderSceneFrameInline(req);

  return new Promise<SceneFrameResult | null>((resolve) => {
    let settled = false;
    const finish = (value: SceneFrameResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let worker: Worker;
    try {
      worker = new Worker(workerPath, {
        workerData: {
          src: req.pkgPath,
          width: req.width ?? 1920,
          height: req.height ?? 1080,
          time: req.time ?? 0,
          weAssetsDir: req.weAssetsDir ?? undefined,
        },
      });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      void worker.terminate();
      finish(null);
    }, RENDER_TIMEOUT_MS);

    worker.on('message', (msg: WorkerMessage) => {
      if ('progress' in msg) return; // multi-frame progress — not used for static frames
      if (msg.ok && msg.png) {
        // The worker transfers png.buffer; Buffer.from copies into a
        // standalone Buffer regardless of the received view type.
        finish({ png: Buffer.from(msg.png), diff: msg.diff, checked: msg.checked });
      } else {
        finish(null);
      }
      void worker.terminate();
    });
    worker.on('error', () => finish(null));
    worker.on('exit', () => finish(null));
  });
}

/**
 * In-process fallback (vitest / missing worker bundle). Same render + gate
 * semantics as the worker, executed synchronously on this thread.
 */
async function renderSceneFrameInline(req: SceneFrameRequest): Promise<SceneFrameResult | null> {
  try {
    const { SceneRenderer, encodePng } = (await import('./scene-renderer.js')) as {
      SceneRenderer: new (
        pkgPath: string,
        opts: Record<string, unknown>,
      ) => {
        render(): { w: number; h: number; data: Uint8Array };
        scene: { general?: { clearcolor?: string } };
      };
      encodePng: (w: number, h: number, data: Uint8Array) => Uint8Array;
    };
    const renderer = new SceneRenderer(req.pkgPath, {
      width: req.width ?? 1920,
      height: req.height ?? 1080,
      time: req.time ?? 0,
      weAssetsDir: req.weAssetsDir ?? undefined,
      log: () => {},
    });
    const canvas = renderer.render();

    // Empty-frame gate (mirrors the worker's sampling).
    const cc = renderer.scene?.general?.clearcolor;
    const ccv =
      typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
    const cr0 = (ccv[0] || 0) * 255;
    const cg0 = (ccv[1] || 0) * 255;
    const cb0 = (ccv[2] || 0) * 255;
    const step = 8;
    let diff = 0;
    let checked = 0;
    for (let y = 0; y < canvas.h; y += step) {
      for (let x = 0; x < canvas.w; x += step) {
        const i = (y * canvas.w + x) * 4;
        checked++;
        if (
          Math.abs(canvas.data[i] - cr0) > 24 ||
          Math.abs(canvas.data[i + 1] - cg0) > 24 ||
          Math.abs(canvas.data[i + 2] - cb0) > 24
        ) {
          diff++;
        }
      }
    }

    return { png: Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)), diff, checked };
  } catch {
    return null;
  }
}
