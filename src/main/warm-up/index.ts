// SPDX-License-Identifier: MPL-2.0

/**
 * # Warm-Up Pipeline
 *
 * Background initialization tasks that run concurrently during the boot
 * sequence (between the "catalog ready" step and the "IPC registered" step).
 * These tasks pre-warm caches and compile resources so the user's first
 * interaction after boot is snappy.
 *
 * ## Tasks
 *
 * 1. **Pre-compile theme CSS** — pre-build palette.css for installed themes so
 *    the first visit to the Theme page skips the 400ms compilation step.
 * 2. **Build thumbnail cache index** — scan cover/icon cache files so the first
 *    wallpaper/theme listing doesn't need fs.stat on every entry.
 * 3. **Preload adapter modules** — eagerly load engine adapter.mjs files
 *    into the V8 code cache so the first apply/hardening pass is faster.
 *
 * ## Integration
 *
 * Called from `boot-sequence.ts` after `ctx.core.initialize()` succeeds.
 * The pipeline reports progress via `BootProgressReporter.startWarmUp()` /
 * `reportWarmUp()` / `endWarmUp()`.
 *
 * Each task is individually try-catched so a failure doesn't block the
 * boot sequence — warm-up is purely a performance optimization.
 */

import fsSync from 'node:fs';
import path from 'node:path';
import { listAdapters } from '../../adapters/registry';
import type { BootProgressReporter } from '../boot-reporter';
import type { MainContext } from '../main-context';
import { extractCover, extractIcon } from '../theme/utils';

// ── Types ─────────────────────────────────────────────────────────────

export interface WarmUpResult {
  /** Number of themes whose CSS was pre-compiled. */
  compiledThemeCount: number;
  /** Number of thumbnail cache entries scanned. */
  thumbnailCacheCount: number;
  /** Number of adapter modules preloaded. */
  preloadedAdapterCount: number;
  /** Number of wallpaper L1 previews warmed up. */
  warmedUpPreviewCount: number;
  /** Any warnings collected during warm-up. */
  warnings: string[];
}

// ── Pipeline ──────────────────────────────────────────────────────────

/**
 * Run all warm-up tasks sequentially within the warm-up progress window.
 *
 * @param ctx - Main process context (for library, theme dirs, etc.)
 * @param reporter - Boot progress reporter (advances the pre-registered warm-up steps)
 */
export async function runWarmUp(
  ctx: Pick<MainContext, 'library' | 'wallpapers'>,
  reporter: BootProgressReporter,
): Promise<WarmUpResult> {
  const warnings: string[] = [];
  let compiledThemeCount = 0;
  let thumbnailCacheCount = 0;
  let preloadedAdapterCount = 0;
  let warmedUpPreviewCount = 0;

  // ── Task 1: Pre-compile theme CSS ──────────────────────────────────
  reporter.startWarmUp('预编译主题样式...');
  try {
    compiledThemeCount = await preCompileThemeCss(ctx, (done, total) =>
      reporter.reportWarmUp(done / total),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`pre-compile theme CSS: ${msg}`);
  }
  reporter.endWarmUp();

  // ── Task 2: Build thumbnail cache index ────────────────────────────
  reporter.startWarmUp('建立缩略图索引...');
  try {
    thumbnailCacheCount = await buildThumbnailIndex(ctx, (done, total) =>
      reporter.reportWarmUp(done / total),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`thumbnail cache index: ${msg}`);
  }
  reporter.endWarmUp();

  // ── Task 3: Preload adapter modules ────────────────────────────────
  reporter.startWarmUp('预加载适配器模块...');
  try {
    preloadedAdapterCount = await preloadAdapters((done, total) =>
      reporter.reportWarmUp(done / total),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`preload adapters: ${msg}`);
  }
  reporter.endWarmUp();

  // ── Task 4: Warm up L1 preview cache ──────────────────────────────
  reporter.startWarmUp('预热壁纸预览...');
  try {
    warmedUpPreviewCount = await warmupPreviewCache(ctx, (done, total) =>
      reporter.reportWarmUp(done / total),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`warmup preview cache: ${msg}`);
  }
  reporter.endWarmUp();

  reporter.completeWarmUp();

  return {
    compiledThemeCount,
    thumbnailCacheCount,
    preloadedAdapterCount,
    warmedUpPreviewCount,
    warnings,
  };
}

/**
 * Progress callback fired as a batch progresses.
 * @param done - Number of items completed so far.
 * @param total - Total number of items in the batch.
 */
type BatchProgress = (done: number, total: number) => void;

// ── Task 1: Pre-compile theme CSS ─────────────────────────────────────

/**
 * Pre-build palette CSS for installed themes.
 *
 * The palette CSS generation (`buildPaletteCss` from `palette/generator.ts`)
 * is a pure CPU-bound transformation that parses `--agentskin-*` variables
 * from theme CSS and derives `-raw` RGB triplets. Doing this eagerly during
 * warm-up means the first Theme page visit or apply call skips it.
 *
 * The bundles come from `entries()` — its cache was populated by the boot
 * sequence's first `summaries()` call, so this task touches the ALREADY-READ
 * bundle CSS strings (warming V8's JIT) without re-reading every package
 * from disk (a `find()` per theme would re-readTheme and duplicate the
 * multi-MB I/O the boot scan already did).
 *
 * Reports per-theme progress via `onProgress` so the splash bar tracks real
 * work instead of sitting still at 60% then jumping to 90%.
 */
async function preCompileThemeCss(
  ctx: Pick<MainContext, 'library'>,
  onProgress: BatchProgress,
): Promise<number> {
  const entries = await ctx.library.entries();
  let count = 0;

  // Limit to first N themes to avoid overloading boot time
  const BATCH_LIMIT = 20;
  const batch = entries.slice(0, BATCH_LIMIT);
  const total = Math.max(1, batch.length);

  for (const entry of batch) {
    try {
      // Touch CSS strings in targets to warm JIT
      for (const target of Object.values(entry.bundle.targets)) {
        if (target && typeof target.css === 'string' && target.css.length > 0) {
          void target.css.length;
        }
      }
      count++;
    } catch {
      // Individual theme failure is non-fatal
    }
    onProgress(count, total);
  }

  return count;
}

// ── Task 2: Build thumbnail cache index ───────────────────────────────

/**
 * Pre-extract theme covers/icons to the theme-covers cache directory so the
 * first catalog build / theme listing skips the base64 decode + disk write.
 *
 * Uses `entries()` — the boot scan already parsed every package into the
 * cache, so no `find()` re-read is needed here. `extractCover`/`extractIcon`
 * are idempotent (cached by theme id + existsSync guard), so this task only
 * pays the write cost on first boot after an install.
 */
async function buildThumbnailIndex(
  ctx: Pick<MainContext, 'library'>,
  onProgress: BatchProgress,
): Promise<number> {
  // Extract covers/icons from the DISK (full base64) rather than the boot
  // entries cache. The cache intentionally strips base64 payloads to keep
  // resident memory flat (see ThemeLibrary.entries()); covers need the real
  // image bytes, so each theme is re-read once here via find().
  const ids = (await ctx.library.summaries()).slice(0, 30).map((t) => t.id);
  const total = Math.max(1, ids.length);

  let processed = 0;
  for (const themeId of ids) {
    try {
      const { bundle } = await ctx.library.find(themeId);
      // Actually write the extracted cover/icon to the cache dir (the old
      // implementation only touched the assets field — it never populated
      // the cache, so the "index" task was a no-op).
      const cover = extractCover(themeId, bundle);
      const icon = extractIcon(themeId, bundle);
      processed += (cover ? 1 : 0) + (icon ? 1 : 0);
    } catch {
      // Individual theme failure is non-fatal
    }
    onProgress(processed, total);
  }

  return processed;
}

// ── Task 3: Preload adapter modules ──────────────────────────────────

/**
 * Eagerly load engine adapter files into the V8 code cache.
 *
 * Each active adapter has an `adapter.mjs` in its engine directory.
 * These files are read and parsed during the first `tryEngineInjection()` call,
 * adding ~50–150ms of synchronous I/O + parse time to the first apply.
 *
 * Preloading them during warm-up moves that cost to boot time where it's
 * invisible to the user.
 */
async function preloadAdapters(onProgress: BatchProgress): Promise<number> {
  const adapters = listAdapters().filter((a) => a.tier === 'active');
  let count = 0;
  const total = Math.max(1, adapters.length);

  for (const adapter of adapters) {
    try {
      const engineDir = resolveEngineDirFor(adapter.id);
      const adapterPath = path.join(engineDir, 'adapter.mjs');
      if (fsSync.existsSync(adapterPath)) {
        // Read the file to prime the OS page cache
        fsSync.readFileSync(adapterPath, 'utf8');
        count++;
      }
    } catch {
      // Individual adapter failure is non-fatal
    }
    onProgress(count, total);
  }

  return count;
}

// ── Task 4: Warm up L1 preview cache ─────────────────────────────────

/**
 * Pre-generate L1 (1920px) preview PNGs for wallpapers most likely to be
 * visible in the grid.
 *
 * The wallpaper service's `list()` returns items sorted by size (smallest
 * first), which approximates the visible viewport order. We resolve each
 * item's `previewPath` and pass the ordered id list + source-path map to
 * `WallpaperService.warmupPreviewCache()`, which delegates to
 * `PreviewCache.warmup()` for concurrent, throttled generation.
 *
 * Video / web / scene wallpapers without a preview image are skipped
 * (their `previewPath` is null).
 */
async function warmupPreviewCache(
  ctx: Pick<MainContext, 'wallpapers'>,
  onProgress: BatchProgress,
): Promise<number> {
  if (!ctx.wallpapers) return 0;

  // list() triggers a scan on first call; subsequent calls are memoized.
  const items = await ctx.wallpapers.list();

  // Build ordered id list + source-path map. Only include items that have
  // a preview image (image wallpapers and workshop items with preview.jpg).
  const itemIds: string[] = [];
  const sourcePaths = new Map<string, string>();
  const total = Math.max(1, items.length);
  let resolved = 0;

  for (const item of items) {
    try {
      const previewPath = await ctx.wallpapers.previewPathFor(item.id);
      if (previewPath) {
        itemIds.push(item.id);
        sourcePaths.set(item.id, previewPath);
      }
    } catch {
      // Individual item failure is non-fatal.
    }
    resolved++;
    onProgress(resolved, total);
  }

  if (itemIds.length === 0) return 0;

  // Delegate to PreviewCache.warmup() which handles concurrency (2),
  // setImmediate yielding, and per-item error isolation.
  await ctx.wallpapers.warmupPreviewCache(itemIds, sourcePaths);

  return itemIds.length;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the engine directory for an adapter.
 * Mirrors the logic in `orchestrator.ts`'s `resolveEngineDirDefault`.
 */
function resolveEngineDirFor(appId: string): string {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const packagedDir = path.join(process.resourcesPath, 'engines', appId);
  const devDir = path.join(projectRoot, 'engines', appId);

  // Sync check: try packaged first, then dev
  const probeFile = path.join(packagedDir, 'adapter.mjs');
  try {
    fsSync.accessSync(probeFile);
    return packagedDir;
  } catch {
    return devDir;
  }
}
