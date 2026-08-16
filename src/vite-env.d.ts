// SPDX-License-Identifier: MPL-2.0

/// <reference types="vite/client" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

/**
 * electron-vite `?nodeWorker` imports (see `scene-renderer-async.ts`). The
 * suffix is build-only — electron-vite emits a `Worker` wrapper at build time
 * and bundles the target as a separate chunk. This ambient declaration keeps
 * `tsc` happy; the runtime module is produced by the build, never resolved by
 * vitest (which does not run the build-only plugin).
 */
declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'node:worker_threads';

  const createWorker: (options?: WorkerOptions) => Worker;
  export default createWorker;
}
