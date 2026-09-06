// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-async (pool behaviour)
 *
 * The synchronous `renderSceneToHtml` and the worker entry
 * (`scene-renderer-worker.ts -> handleRenderRequest`) are covered by
 * `scene-renderer-html.test.ts` and `scene-renderer-worker.test.ts`.
 * This file validates the **module-level WorkerPool** inside
 * `scene-renderer-async.ts`:
 *
 *   - FIFO task ordering across concurrent submissions
 *   - worker reuse -- sequential calls recycle a single pool slot
 *   - maxSize concurrency cap -- pool never exceeds the configured ceiling
 *   - terminateSceneWorkerPool tears down idle slots and rejects queue
 *
 * The `?nodeWorker` suffix is a build-only electron-vite plugin, so the
 * factory is mocked here. `PooledWorker` / `WorkerPool` themselves are plain
 * classes with no build-only dependencies -- once the Worker constructor is
 * faked, the pool logic executes normally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock worker factory -- stands in for `scene-renderer-worker?nodeWorker`
// ---------------------------------------------------------------------------

interface PostMessageEntry {
  requestId: number;
  time: number;
  task: { requestId: number; pkgPath: string; mode?: string };
}

/** Records every `postMessage` in dispatch order for FIFO assertions. */
const postMessageLog: PostMessageEntry[] = [];

/** All MockWorker instances the factory has produced. */
const liveMockWorkers: MockWorker[] = [];

/** Total constructions -- acts as a proxy for "new Worker()" count. */
let workerCreateCount = 0;

/**
 * Lightweight stand-in for `worker_threads.Worker`. Mimics the subset of the
 * real API that `PooledWorker` touches (`on`, `postMessage`, `terminate`).
 *
 * `postMessage` resolves the task asynchronously (setTimeout 1ms) -- this is
 * what lets the test verify FIFO ordering and worker reuse.
 */
interface WorkerListenerMap {
  message?: (msg: { requestId: number; html: string }) => void;
  exit?: (code: number) => void;
}

class MockWorker {
  alive: boolean;
  postCount: number;
  listeners: WorkerListenerMap;

  constructor() {
    this.alive = true;
    this.postCount = 0;
    this.listeners = {};
  }

  on(
    event: 'message' | 'exit',
    handler: (arg: { requestId: number; html: string } | number) => void,
  ) {
    if (event === 'message') {
      this.listeners.message = handler as (msg: { requestId: number; html: string }) => void;
    } else if (event === 'exit') {
      this.listeners.exit = handler as (code: number) => void;
    }
  }

  postMessage(task: { requestId: number; pkgPath: string; mode?: string }) {
    this.postCount++;
    postMessageLog.push({ requestId: task.requestId, time: performance.now(), task });
    // Simulate async render -- resolve on the next tick.
    setTimeout(() => {
      if (this.alive) {
        this.listeners.message?.({
          requestId: task.requestId,
          html: `<html data-id="${task.requestId}"></html>`,
        });
      }
    }, 1);
  }

  terminate() {
    this.alive = false;
    this.listeners.exit?.(0);
    return Promise.resolve(0);
  }
}

// ---------------------------------------------------------------------------
// Module-level mock for the `?nodeWorker` suffix
// ---------------------------------------------------------------------------

vi.mock('./scene-renderer-worker?nodeWorker', () => ({
  default: () => {
    const w = new MockWorker();
    workerCreateCount++;
    liveMockWorkers.push(w);
    return w;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Let pending microtasks + setTimeout(1ms) workers settle. */
async function flush(ms = 5) {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scene-renderer-async WorkerPool', () => {
  let mod: typeof import('./scene-renderer-async');

  beforeEach(async () => {
    vi.resetModules();
    postMessageLog.length = 0;
    liveMockWorkers.length = 0;
    workerCreateCount = 0;
    mod = await import('./scene-renderer-async');
  });

  afterEach(() => vi.resetModules());

  it('exports renderSceneToHtmlAsync as a function', () => {
    expect(typeof mod.renderSceneToHtmlAsync).toBe('function');
  });

  it('exports renderSceneToStaticHtmlAsync as a function', () => {
    expect(typeof mod.renderSceneToStaticHtmlAsync).toBe('function');
  });

  it('exports terminateSceneWorkerPool as a function', () => {
    expect(typeof mod.terminateSceneWorkerPool).toBe('function');
  });

  it('dispatches tasks to workers in FIFO order under concurrent load', async () => {
    const promises = [
      mod.renderSceneToHtmlAsync('/a.pkg'),
      mod.renderSceneToHtmlAsync('/b.pkg'),
      mod.renderSceneToHtmlAsync('/c.pkg'),
      mod.renderSceneToHtmlAsync('/d.pkg'),
      mod.renderSceneToHtmlAsync('/e.pkg'),
      mod.renderSceneToHtmlAsync('/f.pkg'),
      mod.renderSceneToHtmlAsync('/g.pkg'),
      mod.renderSceneToHtmlAsync('/h.pkg'),
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r !== null)).toBe(true);

    const ids = postMessageLog.map((e) => e.requestId);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));

    expect(postMessageLog).toHaveLength(8);
  });

  it('never creates more than maxSize workers under concurrent load', async () => {
    const promises = Array.from({ length: 12 }, (_, i) =>
      mod.renderSceneToHtmlAsync(`/big-scene-${i}.pkg`),
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(12);
    expect(results.every((r) => r !== null)).toBe(true);

    expect(workerCreateCount).toBeLessThanOrEqual(2);
    expect(liveMockWorkers.length).toBeLessThanOrEqual(2);
  });

  it('reuses idle workers from a prior burst for subsequent calls', async () => {
    await Promise.all([
      mod.renderSceneToHtmlAsync('/phase1-a.pkg'),
      mod.renderSceneToHtmlAsync('/phase1-b.pkg'),
    ]);
    await flush();

    const burstCount = workerCreateCount;
    expect(burstCount).toBeGreaterThanOrEqual(1);
    expect(burstCount).toBeLessThanOrEqual(2);

    await mod.renderSceneToHtmlAsync('/phase2-a.pkg');
    await mod.renderSceneToHtmlAsync('/phase2-b.pkg');
    await mod.renderSceneToHtmlAsync('/phase2-c.pkg');
    await flush();

    expect(workerCreateCount).toBe(burstCount);
  });

  it('routes static-mode tasks through the same pool', async () => {
    const p1 = mod.renderSceneToHtmlAsync('/full.pkg');
    const p2 = mod.renderSceneToStaticHtmlAsync('/static.pkg');
    const [full, stat] = await Promise.all([p1, p2]);

    expect(full).not.toBeNull();
    expect(stat).not.toBeNull();

    const staticDispatch = postMessageLog.find((e) => e.task.pkgPath === '/static.pkg');
    expect(staticDispatch).toBeDefined();
    expect(staticDispatch?.task.mode).toBe('static');

    expect(postMessageLog).toHaveLength(2);
    expect(workerCreateCount).toBeLessThanOrEqual(2);
  });

  it('terminateSceneWorkerPool tears down idle workers', async () => {
    const r = await mod.renderSceneToHtmlAsync('/t.pkg');
    expect(r).not.toBeNull();
    await flush();

    expect(liveMockWorkers.length).toBe(1);
    expect(liveMockWorkers[0].alive).toBe(true);

    mod.terminateSceneWorkerPool();
    expect(liveMockWorkers[0].alive).toBe(false);
  });

  it('rejects queued tasks after terminateSceneWorkerPool', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      mod.renderSceneToHtmlAsync(`/pending-${i}.pkg`),
    );

    await new Promise((r) => setTimeout(r, 2));

    mod.terminateSceneWorkerPool();

    const settled = await Promise.allSettled(promises);
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);

    for (const r of rejected) {
      expect(r.reason.message).toContain('Worker pool terminated');
    }
  });
});
