// SPDX-License-Identifier: MPL-2.0

/**
 * # WE Scanner — Workshop Directory Iteration
 *
 * Iterates over Wallpaper Engine's workshop content directory and delegates
 * per-project parsing to {@link parseWorkshopProject}. Returns a Map of
 * discovered items keyed by workshop id (directory name).
 *
 * Workshop root resolution is NOT done here — it lives in
 * `steam-path-resolver.ts` (VDF-based Steam library detection). The adapter
 * (`wallpaper/adapter.ts`) calls the resolver and passes the root to
 * {@link scanWorkshop}.
 *
 * Extracted from the original `wallpaper-service.ts` scan() method so that
 * scanning can be tested with a temp directory without the full service.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredItem } from '../types';
import { parseWorkshopProject } from './parser';

/**
 * Max workshop directories parsed concurrently during a scan.
 *
 * Each parse decompresses + decodes every texture in the project (scene.pkg
 * files are 10-140MB), so parsing too many at once spikes the main process
 * heap. A cap of 8 keeps the scan fast on 45+ item libraries while bounding
 * peak memory — the classic serial-vs-parallel middle ground.
 */
const SCAN_CONCURRENCY = 8;

/**
 * Run an async map over `items` with a bounded concurrency pool. Preserves
 * input order in the result.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  };
  const poolSize = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

/**
 * Scan the Wallpaper Engine workshop library and return all discovered
 * wallpaper items. Each workshop directory is parsed independently via
 * {@link parseWorkshopProject}; parse failures (no project.json, no usable
 * media) are silently skipped.
 *
 * Directories are parsed with a bounded concurrency pool: parsing is I/O +
 * CPU bound (texture decompression for scene projects), so the pool keeps a
 * 45+ item scan fast without spiking the main-process heap to GBs.
 *
 * @param root Absolute path to the workshop content directory (e.g.
 *   `…/steamapps/workshop/content/431960`).
 */
export async function scanWorkshop(root: string): Promise<Map<string, DiscoveredItem>> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return new Map();
  }

  const dirs = entries.map((entry) => path.join(root, entry));
  const parsed = await mapWithConcurrency(dirs, SCAN_CONCURRENCY, (dir) =>
    parseWorkshopProject(dir, path.basename(dir)),
  );

  const items = new Map<string, DiscoveredItem>();
  for (const item of parsed) {
    if (item) items.set(item.id, item);
  }
  return items;
}
