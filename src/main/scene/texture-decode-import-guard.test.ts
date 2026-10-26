// SPDX-License-Identifier: MPL-2.0

/**
 * Guard tests for the worker-entry import-hygiene invariant.
 *
 * Worker entries register a top-level `parentPort?.on('message')` handler as a
 * side effect. If library code imports a worker entry by value, the bundler
 * inlines the entry into the importing bundle — and when that bundle is itself
 * a worker, the entry's handler starts intercepting foreign messages. This was
 * observed in the wild as every scene render failing with
 * `Buffer.from(undefined)` (see texture-decode-core.ts header for the full
 * post-mortem), because the texture-decode worker entry got inlined into the
 * scene-renderer worker chunk and answered `{ requestId, pkgPath }` render
 * requests (no `data` field) before the real handler could.
 *
 * These tests enforce two rules:
 *   1. The pure decode core (`texture-decode-core.ts`) still decodes correctly
 *      after the split out of the entry file.
 *   2. No non-test source file imports a worker entry by value — only
 *      type-only imports and build-time `?nodeWorker` dynamic imports are
 *      allowed. New worker entries must be registered in WORKER_ENTRIES below.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEX_FORMAT } from './tex-parser/tex-types';
import { handleDecodeRequest } from './texture-decode-core';

// ---------------------------------------------------------------------------
// 1. Decode core behaviour (moved verbatim out of the worker entry)
// ---------------------------------------------------------------------------

describe('texture-decode-core', () => {
  it('decodes R8 format to RGBA', () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height, 200);
    const res = handleDecodeRequest({
      requestId: 1,
      format: TEX_FORMAT.R8,
      width,
      height,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    });
    expect(res.error).toBeUndefined();
    expect(res.rgba).toBeDefined();
    const rgba = Buffer.from(res.rgba!);
    expect(rgba.length).toBe(width * height * 4);
    expect(rgba[0]).toBe(200);
    expect(rgba[3]).toBe(255);
  });

  it('decodes RGBA8888 as a copy', () => {
    const data = Buffer.alloc(4 * 4 * 4, 128);
    const res = handleDecodeRequest({
      requestId: 2,
      format: TEX_FORMAT.RGBA8888,
      width: 4,
      height: 4,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    });
    expect(res.error).toBeUndefined();
    expect(Buffer.from(res.rgba!).length).toBe(64);
  });

  it('reports unsupported formats as an error instead of throwing', () => {
    const res = handleDecodeRequest({
      requestId: 3,
      format: 999,
      width: 4,
      height: 4,
      data: new ArrayBuffer(16),
    });
    expect(res.error).toContain('Unsupported format');
  });
});

// ---------------------------------------------------------------------------
// 2. Worker-entry import guard (repo-wide static scan)
// ---------------------------------------------------------------------------

/** Worker entry files whose module-level parentPort registration must never be
 *  pulled into library bundles. Register new worker entries here. */
const WORKER_ENTRIES = [
  'src/main/scene-renderer-worker.ts',
  'src/main/scene/texture-decode-worker.ts',
  'src/main/scene/we/scene-render-worker.mjs',
];

const MAIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function* walkSources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSources(full);
    } else if (/\.(ts|mts|js|mjs)$/.test(name) && !name.endsWith('.test.ts')) {
      yield full;
    }
  }
}

/** True when the import statement is type-only (erased at build time). */
function isTypeOnlyImport(stmt: string): boolean {
  return /^\s*import\s+type\s/.test(stmt) || /^\s*export\s+type\s/.test(stmt);
}

describe('worker-entry import guard', () => {
  it('no library code imports a worker entry by value', () => {
    const offenders: string[] = [];
    const entryAbsolute = new Set(WORKER_ENTRIES.map((p) => path.resolve(MAIN_DIR, '..', p)));

    for (const file of walkSources(MAIN_DIR)) {
      const src = readFileSync(file, 'utf8');
      // Match import/export statements with a `from '<spec>'` clause.
      const stmtRe = /\b(import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g;
      for (const m of src.matchAll(stmtRe)) {
        const stmt = m[0];
        const spec = m[2];
        if (!spec.startsWith('.')) continue;
        const bare = spec.split('?')[0];
        const resolved = path.resolve(path.dirname(file), bare);
        if (!entryAbsolute.has(resolved)) continue;
        if (spec.includes('?nodeWorker')) continue; // build-time Worker spawn
        if (isTypeOnlyImport(stmt)) continue; // erased before bundling
        offenders.push(`${path.relative(MAIN_DIR, file)} → ${spec}`);
      }
    }

    expect(
      offenders,
      `Worker entries must not be imported by value from library code (their ` +
        `top-level parentPort handler would be inlined into the importing ` +
        `bundle and intercept foreign worker messages — the Buffer.from(undefined) ` +
        `bug). Import the pure logic from a side-effect-free core module instead. ` +
        `Offenders: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});
