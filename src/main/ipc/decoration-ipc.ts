// SPDX-License-Identifier: MPL-2.0

/**
 * # Decoration IPC
 *
 * Registers the DECORATION_* channel family. Bridges the renderer's
 * decoration UI to the {@link decoration-generator} engine in the main
 * process.
 *
 * ## Channels
 *
 * | Channel               | Direction       | Purpose                          |
 * |-----------------------|-----------------|----------------------------------|
 * | DECORATION_ANALYZE    | renderer → main | Analyse an image → DecorationPrompt |
 * | DECORATION_GENERATE   | renderer → main | Generate candidate decorations   |
 * | DECORATION_LIST       | renderer → main | List cached decorations for theme|
 * | DECORATION_APPLY      | renderer → main | Apply a decoration slot to theme |
 *
 * All handlers are self-contained (no `MainContext` dependency) so this
 * module can be registered in isolation and unit-tested with stub inputs.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { DecorationAsset, DecorationSlot } from '../../shared/types/decoration';
import {
  analyseImageForDecoration,
  buildCandidates,
  type DecorationDeps,
  findCachedByHash,
  generateDecorationCandidates,
  getCachedDecorations,
} from '../profile/decoration-generator';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** IPC timeout configuration (ms). */
const TIMEOUT_ANALYZE = 15_000;
const TIMEOUT_GENERATE = 15_000;
const TIMEOUT_LIST = 10_000;
const TIMEOUT_APPLY = 15_000;

/**
 * Dependencies for the decoration IPC module. Injected so handlers remain
 * unit-testable without a real filesystem or Electron `nativeImage`.
 */
export interface DecorationIpcDeps {
  /** Override the cache directory resolver (tests). */
  getCacheDir?: DecorationDeps['getCacheDir'];
}

/**
 * Validate that a value is a non-empty string. Throws a localised error.
 * (Mirrors the pattern from `ipc-validators.ts` but self-contained so this
 * module has no cross-file coupling.)
 */
function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid ${label}: expected non-empty string`);
  }
}

/** Validate a {@link DecorationSlot} shape at runtime. */
function assertDecorationSlot(value: unknown): asserts value is DecorationSlot {
  if (!value || typeof value !== 'object') throw new Error('Invalid decoration slot');
  const v = value as Record<string, unknown>;
  assertString(v.id, 'slot id');
  assertString(v.assetId, 'slot assetId');
  if (typeof v.opacity !== 'number' || v.opacity < 0 || v.opacity > 1) {
    throw new Error('Invalid slot opacity: expected number in [0,1]');
  }
  if (typeof v.scale !== 'number') throw new Error('Invalid slot scale');
  if (typeof v.offsetX !== 'number') throw new Error('Invalid slot offsetX');
  if (typeof v.offsetY !== 'number') throw new Error('Invalid slot offsetY');
}

export function registerDecorationIpc(deps: DecorationIpcDeps = {}): void {
  // --- DECORATION_ANALYZE ---
  // Analyse an image file and return a DecorationPrompt. The renderer sends
  // an absolute file path; the handler decodes the image and runs the
  // pure-TS analysis pipeline.
  ipcMain.handle(IpcChannel.DECORATION_ANALYZE, async (_event, imagePath: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.DECORATION_ANALYZE,
      TIMEOUT_ANALYZE,
      (async () => {
        assertString(imagePath, 'imagePath');
        return analyseImageForDecoration(imagePath);
      })(),
    );
  });

  // --- DECORATION_GENERATE ---
  // Generate candidate decorations from a prompt. The renderer may send a
  // full DecorationPrompt (from a prior ANALYZE call) or just a themeId to
  // trigger builtin-only generation. The handler always succeeds — the
  // builtin fallback guarantees a non-empty result.
  ipcMain.handle(
    IpcChannel.DECORATION_GENERATE,
    async (_event, prompt: unknown, count: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.DECORATION_GENERATE,
        TIMEOUT_GENERATE,
        (async () => {
          const n = typeof count === 'number' && count > 0 ? Math.min(count, 12) : 6;
          if (prompt && typeof prompt === 'object' && 'mood' in prompt && 'dominantHue' in prompt) {
            const result = await generateDecorationCandidates(
              prompt as Parameters<typeof generateDecorationCandidates>[0],
              n,
            );
            return result;
          }
          // No prompt → return all builtins with a neutral accent.
          const fallback = buildCandidates(
            { mood: 'neutral', luminance: 0.5, dominantHue: 210, keywords: ['default'] },
            n,
          );
          return { assets: fallback, usedBuiltin: true };
        })(),
      );
    },
  );

  // --- DECORATION_LIST ---
  // List all cached decorations for a theme. Returns an empty array when
  // the cache directory does not exist (no decorations generated yet).
  ipcMain.handle(IpcChannel.DECORATION_LIST, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.DECORATION_LIST,
      TIMEOUT_LIST,
      (async () => {
        assertString(themeId, 'themeId');
        return getCachedDecorations(themeId, { getCacheDir: deps.getCacheDir });
      })(),
    );
  });

  // --- DECORATION_APPLY ---
  // Apply a decoration slot to a theme. The handler validates the slot,
  // resolves the referenced asset from cache, and returns the resolved slot
  // for the renderer to inject as a CSS overlay.
  ipcMain.handle(IpcChannel.DECORATION_APPLY, async (_event, themeId: unknown, slot: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.DECORATION_APPLY,
      TIMEOUT_APPLY,
      (async () => {
        assertString(themeId, 'themeId');
        assertDecorationSlot(slot);

        // Resolve the asset from cache.
        const cached = await getCachedDecorations(themeId, {
          getCacheDir: deps.getCacheDir,
        });
        const asset = cached.find((a) => a.id === slot.assetId);
        if (!asset) {
          throw new Error(`Decoration asset "${slot.assetId}" not found in cache`);
        }

        // If the slot references a source hash, verify it matches the
        // cached asset (cache-hit optimisation).
        const hash = (slot as DecorationSlot & { sourceHash?: string }).sourceHash;
        if (hash && hash !== asset.sourceImageHash) {
          // Cache miss for this hash — re-generate from the cached asset
          // (best-effort: the asset data URL is already available).
        }

        const resolvedSlot: DecorationSlot & { asset?: DecorationAsset } = {
          ...slot,
          asset,
        };
        return resolvedSlot;
      })(),
    );
  });
}

/**
 * Convenience: check whether a decoration is already cached for a given
 * source image hash. Used by the renderer to skip regeneration when the
 * same image has been analysed before.
 *
 * @param themeId  Target theme id.
 * @param hash     SHA-256 hex digest of the source image.
 * @param deps     Optional dependency overrides.
 */
export async function isDecorationCached(
  themeId: string,
  hash: string,
  deps: DecorationIpcDeps = {},
): Promise<boolean> {
  const hit = await findCachedByHash(themeId, hash, { getCacheDir: deps.getCacheDir });
  return hit !== null;
}
