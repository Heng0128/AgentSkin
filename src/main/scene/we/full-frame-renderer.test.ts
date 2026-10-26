// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSceneFrame } from './full-frame-renderer';

/**
 * # full-frame-renderer tests
 *
 * In vitest the worker bundle (scene-render-worker.js) does not exist next to
 * this module, so renderSceneFrame exercises the inline fallback path. These
 * tests assert the failure contract (null on unparseable input, no throw) —
 * real scene rendering is validated by the dsh plugin's regression baseline.
 */

describe('renderSceneFrame — failure contract', () => {
  it('returns null for a nonexistent path without throwing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-frame-'));
    try {
      const result = await renderSceneFrame({
        pkgPath: path.join(dir, 'missing.pkg'),
        width: 64,
        height: 64,
      });
      expect(result).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a directory without scene.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-frame-'));
    try {
      const result = await renderSceneFrame({ pkgPath: dir, width: 64, height: 64 });
      expect(result).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null for an empty file that is not a valid pkg', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'we-frame-'));
    try {
      const pkg = path.join(dir, 'scene.pkg');
      await fs.writeFile(pkg, Buffer.alloc(0));
      const result = await renderSceneFrame({ pkgPath: pkg, width: 64, height: 64 });
      expect(result).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
