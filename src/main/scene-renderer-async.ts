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
 *
 * ## Worker Pool (since v1.0.1)
 *
 * Previously each `renderSceneToHtmlAsync` call spawned a fresh Worker and
 * terminated it after a single round-trip — the spawn / teardown overhead
 * (~50-100 ms per call) caused visible UI stutter during rapid wallpaper
 * switching. Workers are now pooled (max 2) and reused across calls:
 *
 *   - Up to 2 workers are kept alive and shared via a FIFO task queue.
 *   - Idle workers are reused; new ones are created lazily up to `maxSize`.
 *   - A `pendingCreation` counter prevents over-creation when multiple
 *     tasks arrive before the first worker finishes initialising.
 *   - If a worker dies (error / unexpected exit) it is discarded; the next
 *     task creates a replacement.
 */
import type { Worker } from 'node:worker_threads';
import type { WorkerResponse } from './scene-renderer-worker';

export type { RenderLayer } from './scene-renderer-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Task dispatched to a pooled worker. */
interface WorkerTask {
  requestId: number;
  pkgPath: string;
  options?: { weInstallRoot?: string };
}

/** Resolved result from a pooled worker. */
type WorkerResult = string | null;

/** Factory that produces a fresh `Worker` instance (the `?nodeWorker` default). */
type WorkerFactory = () => Worker;

// ---------------------------------------------------------------------------
// PooledWorker — wraps a single worker_threads.Worker with persistent
// message routing and lifecycle tracking
// ---------------------------------------------------------------------------

class PooledWorker {
  /** Maps requestId → pending promise handlers for in-flight tasks. */
  private pending = new Map<
    number,
    { resolve: (html: WorkerResult) => void; reject: (err: Error) => void }
  >();
  private alive = false;
  private worker: Worker;

  constructor(factory: WorkerFactory) {
    this.worker = factory();
    this.alive = true;

    this.worker.on('message', (msg: WorkerResponse) => {
      const entry = this.pending.get(msg.requestId);
      if (!entry) return; // stale or already handled
      this.pending.delete(msg.requestId);
      if (msg.error) {
        entry.reject(new Error(`scene render worker failed: ${msg.error}`));
      } else {
        entry.resolve(msg.html ?? null);
      }
    });

    this.worker.on('error', (err: Error) => {
      this.alive = false;
      for (const [, entry] of this.pending) entry.reject(err);
      this.pending.clear();
    });

    this.worker.on('exit', (code: number) => {
      this.alive = false;
      if (code === 0) return; // clean exit (after terminate())
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`scene render worker exited with code ${code} before responding`));
      }
      this.pending.clear();
    });
  }

  /**
   * Dispatch a task to this worker. The promise settles when the worker
   * posts the matching `requestId` response (or on error / exit).
   */
  execute(task: WorkerTask): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve, reject) => {
      this.pending.set(task.requestId, { resolve, reject });
      this.worker.postMessage(task);
    });
  }

  /** True if the worker has not errored or exited. */
  isAlive(): boolean {
    return this.alive;
  }

  /** Force-terminate the underlying worker. */
  terminate(): void {
    this.alive = false;
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Worker pool terminated'));
    }
    this.pending.clear();
    this.worker.terminate().catch(() => {
      /* terminate() never rejects in practice — swallow for safety */
    });
  }
}

// ---------------------------------------------------------------------------
// WorkerPool — manages up to maxSize workers with task queuing
// ---------------------------------------------------------------------------

class WorkerPool {
  /** Idle workers available for reuse. */
  private idleWorkers: PooledWorker[] = [];
  /** Number of workers currently executing a task. */
  private activeCount = 0;
  /** Number of workers being created (async factory resolution in flight). */
  private pendingCreation = 0;
  /** FIFO backlog of tasks awaiting a free worker. */
  private queue: Array<{
    task: WorkerTask;
    resolve: (html: WorkerResult) => void;
    reject: (err: Error) => void;
  }> = [];
  /** Cached factory — imported once, shared by every worker. */
  private factoryPromise: Promise<WorkerFactory> | null = null;

  constructor(private maxSize = 2) {}

  /**
   * Lazily resolve and cache the `?nodeWorker` factory. Safe to call
   * repeatedly — returns the same promise after the first successful import.
   */
  private getFactory(): Promise<WorkerFactory> {
    if (!this.factoryPromise) {
      this.factoryPromise = import('./scene-renderer-worker?nodeWorker')
        .then((mod) => mod.default as WorkerFactory)
        .catch((err) => {
          // Reset so a later call can retry (e.g. transient resolution error).
          this.factoryPromise = null;
          throw err;
        });
    }
    return this.factoryPromise;
  }

  /**
   * Enqueue a task. Settles when a worker finishes the task. Tasks are
   * processed in FIFO order; excess tasks wait in the queue until a worker
   * becomes free.
   */
  execute(task: WorkerTask): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Try to assign queued tasks to available workers. Called on every
   * `execute()` and when a worker finishes.
   *
   * Synchronous check + `pendingCreation++` is atomic in the JS event loop,
   * so no two calls can over-create workers.
   */
  private processQueue(): void {
    if (this.queue.length === 0) return;

    // Reuse an idle worker if one is available.
    const idle = this.idleWorkers.pop();
    if (idle?.isAlive()) {
      this.runTask(idle, this.queue.shift()!);
      return;
    }

    // No idle worker — check if we are at capacity.
    if (this.activeCount + this.pendingCreation >= this.maxSize) return;

    // Reserve a slot and create a new worker.
    this.pendingCreation++;
    this.getFactory()
      .then((factory) => {
        this.pendingCreation--;
        const worker = new PooledWorker(factory);
        if (this.queue.length === 0) {
          // Task was claimed during the async gap — keep worker idle.
          this.idleWorkers.push(worker);
          return;
        }
        this.runTask(worker, this.queue.shift()!);
      })
      .catch((err: Error) => {
        this.pendingCreation--;
        const item = this.queue.shift();
        if (item) item.reject(err);
        // Try to drain the queue with other workers.
        this.processQueue();
      });
  }

  /** Run a single task on a worker, then recycle or replace. */
  private runTask(
    worker: PooledWorker,
    item: { task: WorkerTask; resolve: (html: WorkerResult) => void; reject: (err: Error) => void },
  ): void {
    this.activeCount++;
    worker
      .execute(item.task)
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.activeCount--;
        if (worker.isAlive()) {
          this.idleWorkers.push(worker);
        }
        this.processQueue();
      });
  }

  /**
   * Terminate all idle workers and reject queued tasks. Active workers keep
   * running until their current task finishes; they will NOT be recycled
   * (their `alive` flag flips on exit). Intended for app shutdown.
   */
  terminateAll(): void {
    for (const w of this.idleWorkers) w.terminate();
    this.idleWorkers = [];
    for (const item of this.queue) {
      item.reject(new Error('Worker pool terminated'));
    }
    this.queue = [];
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let requestSeq = 0;
const pool = new WorkerPool(2);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a scene.pkg file into a self-contained HTML string without blocking
 * the main process. Workers are pooled and reused — no per-call spawn/teardown.
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
  const requestId = ++requestSeq;
  return pool.execute({ requestId, pkgPath, options });
}

/**
 * Terminate all pooled workers. Intended for app shutdown / cleanup.
 * After calling this, subsequent `renderSceneToHtmlAsync` calls will lazily
 * create new workers unless the pool is permanently torn down.
 */
export function terminateSceneWorkerPool(): void {
  pool.terminateAll();
}
