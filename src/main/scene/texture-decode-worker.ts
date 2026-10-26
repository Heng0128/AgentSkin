// SPDX-License-Identifier: MPL-2.0

/**
 * # Texture Decode Worker (worker_threads entry)
 *
 * Worker thread entry point for parallel texture decoding. Receives compressed
 * texture data and returns decoded RGBA pixels.
 *
 * Message protocol (main → worker):
 *   { requestId, format, width, height, data }
 *     - format: 'dxt1' | 'dxt3' | 'dxt5' | 'bc7' | 'r8' | 'rg88' | 'rgba8888'
 *     - data: compressed texture data (Buffer as ArrayBuffer)
 *
 * Worker → main:
 *   { requestId, rgba }      — success (rgba is Buffer as ArrayBuffer)
 *   { requestId, error }     — decode failure
 *
 * ## Import-hygiene invariant (Buffer.from(undefined) bug)
 *
 * This file is a **worker entry** — its top-level `parentPort?.on('message')`
 * registration is a side effect that must only run inside the decode worker
 * thread. Library code must import `handleDecodeRequest` from
 * `./texture-decode-core` (side-effect-free) — never from this file. When the
 * pool previously imported the entry directly, the bundler pulled it into the
 * scene-renderer worker chunk; its message handler then ran in that thread and
 * answered foreign requests (e.g. `{ requestId, pkgPath }` with no `data`)
 * first with `Buffer.from(undefined)` errors, breaking every scene render.
 */

import { parentPort } from 'node:worker_threads';
import type { DecodeRequest, DecodeResponse } from './texture-decode-core';
import { handleDecodeRequest } from './texture-decode-core';

// Re-exported for type consumers only — the VALUE must be imported from
// `./texture-decode-core` (see the invariant above; importing it from this
// entry would execute the parentPort side effect in the importing thread).
export type { DecodeRequest, DecodeResponse } from './texture-decode-core';

// Worker thread message handler
parentPort?.on('message', (request: DecodeRequest) => {
  if (!request || typeof request.requestId !== 'number') {
    parentPort?.postMessage({
      requestId: request?.requestId ?? -1,
      error: 'Invalid request: requestId is required',
    } as DecodeResponse);
    return;
  }

  const result = handleDecodeRequest(request);
  parentPort?.postMessage(result);
});
