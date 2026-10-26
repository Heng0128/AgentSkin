// SPDX-License-Identifier: MPL-2.0

/**
 * # Texture Decode Pool
 *
 * Worker pool for parallel texture decoding.
 * Manages a pool of Worker threads that decode compressed textures off the
 * main process event loop.
 *
 * The pool automatically sizes itself based on CPU cores (capped at 8) and
 * distributes decode tasks across available workers.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
// Import from the side-effect-free core, NOT from `./texture-decode-worker`:
// that file is a worker entry whose top-level parentPort message registration
// is a side effect. Importing it from library code previously caused the
// bundler to inline it into other worker bundles (scene-renderer-worker),
// where its handler intercepted foreign requests and failed every scene
// render with `Buffer.from(undefined)` (see texture-decode-core.ts).
import type { DecodeRequest, DecodeResponse } from './texture-decode-core';
import { handleDecodeRequest } from './texture-decode-core';

/** Task pending completion. */
interface PendingTask {
  request: DecodeRequest;
  resolve: (result: Buffer | null) => void;
  reject: (error: Error) => void;
}

/** Worker wrapper with per-worker task queue. */
interface PoolWorker {
  worker: Worker;
  busy: boolean;
  /**
   * RC4-FIX: Per-worker pending tasks so a single worker error doesn't
   * cascade-reject other workers' tasks. Each worker only rejects its own
   * pending tasks on error.
   */
  pending: PendingTask[];
}

/** Pool configuration. */
export interface DecodePoolConfig {
  /** Maximum number of workers (default: CPU cores, capped at 8) */
  maxWorkers?: number;
  /** Custom worker script path (for testing) */
  workerScriptPath?: string;
}

/**
 * Worker pool for parallel texture decoding.
 */
export class TextureDecodePool {
  private workers: PoolWorker[] = [];
  private queue: PendingTask[] = [];
  private nextRequestId = 1;
  private config: Required<DecodePoolConfig>;
  private workerAvailable: boolean | null = null;

  constructor(config: DecodePoolConfig = {}) {
    this.config = {
      maxWorkers: config.maxWorkers ?? Math.min(require('node:os').cpus().length, 8),
      workerScriptPath: config.workerScriptPath ?? path.join(__dirname, 'texture-decode-worker.js'),
    };
  }

  /**
   * Check if Worker threads are available (lazy check).
   */
  private isWorkerAvailable(): boolean {
    if (this.workerAvailable !== null) return this.workerAvailable;
    try {
      // Check if the worker script exists
      require.resolve(this.config.workerScriptPath);
      this.workerAvailable = true;
    } catch {
      this.workerAvailable = false;
    }
    return this.workerAvailable;
  }

  /**
   * Get or create an idle worker.
   */
  private getIdleWorker(): PoolWorker | null {
    // Find existing idle worker
    for (const w of this.workers) {
      if (!w.busy) return w;
    }

    // Create new worker if under limit
    if (this.workers.length < this.config.maxWorkers) {
      const workerPath = path.join(__dirname, 'texture-decode-worker.js');
      const worker = new Worker(workerPath);
      const poolWorker: PoolWorker = { worker, busy: false, pending: [] };
      this.workers.push(poolWorker);

      // Handle worker messages
      worker.on('message', (response: DecodeResponse) => {
        this.handleResponse(poolWorker, response);
      });

      worker.on('error', (error: Error) => {
        // RC4-FIX: Only reject this worker's own pending tasks — not the
        // entire queue. Prevents a single defective worker from cascading
        // failure to other healthy workers' tasks.
        poolWorker.busy = false;
        this.rejectWorkerPending(poolWorker, error);
      });

      return poolWorker;
    }

    return null;
  }

  /**
   * Handle a response from a worker.
   */
  private handleResponse(poolWorker: PoolWorker, response: DecodeResponse): void {
    poolWorker.busy = false;

    // RC4-FIX: Look for the pending task in this worker's own queue
    const taskIndex = poolWorker.pending.findIndex(
      (t) => t.request.requestId === response.requestId,
    );
    if (taskIndex === -1) return;

    const task = poolWorker.pending.splice(taskIndex, 1)[0];

    if (response.error) {
      task.reject(new Error(response.error));
    } else if (response.rgba) {
      task.resolve(Buffer.from(response.rgba));
    } else {
      task.resolve(null);
    }

    // Process next task in queue
    this.processNext();
  }

  /**
   * RC4-FIX: Reject only a single worker's own pending tasks when that worker
   * errors. Does NOT reject other workers' tasks — prevents cascading failure.
   */
  private rejectWorkerPending(poolWorker: PoolWorker, error: Error): void {
    for (const task of poolWorker.pending) {
      task.reject(error);
    }
    poolWorker.pending = [];
  }

  /**
   * Process the next task in the queue.
   */
  private processNext(): void {
    if (this.queue.length === 0) return;

    const idleWorker = this.getIdleWorker();
    if (!idleWorker) return; // All workers busy

    const task = this.queue.shift();
    if (!task) return;

    idleWorker.busy = true;
    // RC4-FIX: Track this task in the worker's own pending queue
    idleWorker.pending.push(task);
    idleWorker.worker.postMessage(task.request);
  }

  /**
   * Decode a texture using the pool.
   *
   * @param format Texture format (TEX_FORMAT constant)
   * @param width Texture width
   * @param height Texture height
   * @param data Compressed texture data
   * @returns Decoded RGBA buffer or null on failure
   */
  async decode(
    format: number,
    width: number,
    height: number,
    data: Buffer,
  ): Promise<Buffer | null> {
    // Fallback to synchronous decode if Workers aren't available
    if (!this.isWorkerAvailable()) {
      return this.decodeSync(format, width, height, data);
    }

    return new Promise<Buffer | null>((resolve, reject) => {
      const request: DecodeRequest = {
        requestId: this.nextRequestId++,
        format,
        width,
        height,
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      };

      this.queue.push({ request, resolve, reject });
      this.processNext();
    });
  }

  /**
   * Synchronous decode fallback (used when Workers aren't available).
   */
  private async decodeSync(
    format: number,
    width: number,
    height: number,
    data: Buffer,
  ): Promise<Buffer | null> {
    try {
      const request: DecodeRequest = {
        requestId: 0,
        format,
        width,
        height,
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      };
      const response = handleDecodeRequest(request);
      if (response.error) return null;
      return response.rgba ? Buffer.from(response.rgba) : null;
    } catch {
      return null;
    }
  }

  /**
   * Decode multiple textures in parallel.
   *
   * @param tasks Array of decode tasks
   * @returns Array of decoded RGBA buffers (null for failed decodes)
   */
  async decodeBatch(
    tasks: Array<{ format: number; width: number; height: number; data: Buffer }>,
  ): Promise<Array<Buffer | null>> {
    const promises = tasks.map((task) =>
      this.decode(task.format, task.width, task.height, task.data),
    );
    return Promise.all(promises);
  }

  /**
   * Get current pool statistics.
   */
  getStats(): { totalWorkers: number; busyWorkers: number; queuedTasks: number } {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.queue.length,
    };
  }

  /**
   * Terminate all workers in the pool.
   */
  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.worker.terminate()));
    this.workers = [];
    this.queue = [];
  }
}

/** Singleton pool instance. */
let globalPool: TextureDecodePool | null = null;

/**
 * Get the global texture decode pool instance.
 */
export function getTextureDecodePool(): TextureDecodePool {
  if (!globalPool) {
    globalPool = new TextureDecodePool();
  }
  return globalPool;
}

/**
 * Terminate the global pool (for testing/cleanup).
 */
export function terminateTextureDecodePool(): void {
  if (globalPool) {
    globalPool.terminate();
    globalPool = null;
  }
}
