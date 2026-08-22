// SPDX-License-Identifier: MPL-2.0

/**
 * # Workshop Test Helpers
 *
 * Shared utility for the four "real workshop data" scene tests:
 *   - scene-renderer-html.test.ts
 *   - scene-particle-smoke.test.ts
 *   - scene-html-size.test.ts
 *   - scene-size.verify.test.ts
 *
 * ## Why this exists
 *
 * Previously each test hard-coded
 *   `C:/Program Files (x86)/Steam/steamapps/workshop/content/431960`
 * and handled "WE not installed" inconsistently — one test silently skipped
 * via try/catch, the other three let `readdir` throw, breaking CI runs on
 * non-Windows machines and on Windows machines with non-standard Steam
 * installs.
 *
 * Resolution order:
 *   1. `AGENTSKIN_TEST_WORKSHOP` env var — explicit override (CI, dev boxes
 *      with WE on a secondary drive, etc.). When set, used verbatim.
 *   2. `resolveWorkshopRoot()` — dynamic discovery via the Steam registry
 *      + libraryfolders.vdf. Returns null on non-Windows or when Steam / WE
 *      isn't installed.
 *   3. null — caller treats the test as skipped.
 *
 * ## Usage
 *
 * ```ts
 * import { resolveWorkshopOrSkip } from './_workshop-test-helpers';
 *
 * it('renders every scene.pkg', async () => {
 *   const workshop = await resolveWorkshopOrSkip();
 *   if (!workshop) return; // skipped: WE not installed
 *   const dirs = await readdir(workshop);
 *   ...
 * });
 * ```
 *
 * We deliberately do NOT call `it.skip()` dynamically — vitest's `it.skip`
 * must be called at top-level collection time, not inside the test body.
 * Returning early from the test body is the simplest portable pattern.
 */

import { resolveWorkshopRoot } from '../steam-path-resolver';

/** Cached result of the first {@link resolveWorkshopOrSkip} call. Subsequent
 *  calls in the same test process reuse it — `resolveWorkshopRoot` does
 *  synchronous registry reads and we don't want every test re-querying. */
let cached: string | null | undefined;

/**
 * Resolve the Wallpaper Engine workshop content directory, or null if WE is
 * not installed and no override was provided.
 *
 * Tests should `if (!workshop) return;` from the test body when this returns
 * null. The function logs a single line so a skipped test run leaves a
 * breadcrumb explaining why no scenes were exercised.
 */
export async function resolveWorkshopOrSkip(): Promise<string | null> {
  if (cached !== undefined) return cached;

  // 1. Explicit env override (CI / non-standard install paths).
  const envOverride = process.env.AGENTSKIN_TEST_WORKSHOP;
  if (envOverride && envOverride.trim().length > 0) {
    cached = envOverride;
    return cached;
  }

  // 2. Dynamic discovery via Steam registry + libraryfolders.vdf.
  try {
    const discovered = await resolveWorkshopRoot();
    if (discovered) {
      cached = discovered;
      return cached;
    }
  } catch (error) {
    // resolveWorkshopRoot throws on Windows when reg.exe is unavailable or
    // the Steam key is missing. Treat as "not installed" — the test will
    // skip — but surface the reason so a misconfigured CI is debuggable.
    console.warn(
      '[_workshop-test-helpers] resolveWorkshopRoot threw — ' +
        `treating WE as not installed: ${(error as Error)?.message ?? error}`,
    );
  }

  // 3. Not found. Log once so a skipped run leaves a breadcrumb.
  console.log(
    '[_workshop-test-helpers] Wallpaper Engine workshop not found — ' +
      'skipping real-scene test. Set AGENTSKIN_TEST_WORKSHOP to override.',
  );
  cached = null;
  return cached;
}
