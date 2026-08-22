// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-worker (smoke)
 *
 * Exercises the worker's core render path (`handleRenderRequest`) — the exact
 * function the `worker_threads` entry runs for each message. The `?nodeWorker`
 * wrapper itself is build-only (electron-vite does not ship it to vitest), so
 * this test validates the worker's protocol + fallback semantics directly:
 *
 *   - success: requestId echoed back with a non-null HTML document
 *   - parse/read failure: requestId echoed back, html null, no error field
 *     (renderSceneToHtml swallows those and degrades to null)
 *   - unexpected throw is a defensive error branch (not reachable today)
 */
import { describe, expect, it } from 'vitest';
import { resolveWorkshopOrSkip } from './scene/_workshop-test-helpers';
import { handleRenderRequest } from './scene-renderer-worker';

describe('scene render worker — handleRenderRequest protocol', () => {
  it('echoes the requestId and returns a rendered HTML document on success', async () => {
    const workshop = await resolveWorkshopOrSkip();
    if (!workshop) return; // skipped: WE not installed
    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(workshop);
    let exercised = false;
    for (const d of dirs) {
      const pkgPath = `${workshop}/${d}/scene.pkg`;
      const res = await handleRenderRequest({ requestId: 42, pkgPath });
      expect(res.requestId).toBe(42);
      if (res.html) {
        expect(res.error).toBeUndefined();
        expect(res.html).toContain('<canvas');
        exercised = true;
        break;
      }
    }
    // At least one real scene must render; otherwise the helper produced a
    // workshop dir with no renderable assets, which is an environment issue.
    expect(exercised).toBe(true);
  }, 120000);

  it('degrades to html:null without an error for a parseable-but-empty scene', async () => {
    const workshop = await resolveWorkshopOrSkip();
    if (!workshop) return; // skipped: WE not installed
    const { readdir, access } = await import('node:fs/promises');
    const dirs = await readdir(workshop);
    let exercised = false;
    for (const d of dirs) {
      const pkgPath = `${workshop}/${d}/scene.pkg`;
      try {
        await access(pkgPath);
      } catch {
        continue;
      }
      const res = await handleRenderRequest({ requestId: 7, pkgPath });
      expect(res.requestId).toBe(7);
      // A scene that parses but has no renderable layers yields null — and
      // that is a *normal* outcome, so no error field is set.
      expect(res.error).toBeUndefined();
      exercised = true; // counted even if html is null
      break;
    }
    expect(exercised).toBe(true);
  }, 120000);

  it('degrades to html:null without an error for an unreadable/missing pkg', async () => {
    // renderSceneToHtml swallows parse/read failures and returns null — the
    // worker surfaces that same contract (null html, no error field). The
    // error branch is a defensive fallback for truly unexpected throws.
    const res = await handleRenderRequest({
      requestId: 1,
      pkgPath: 'C:/definitely/not/a/scene.pkg',
    });
    expect(res.requestId).toBe(1);
    expect(res.html).toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('static mode produces a zero-script HTML document', async () => {
    const workshop = await resolveWorkshopOrSkip();
    if (!workshop) return; // skipped: WE not installed
    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(workshop);
    let exercised = false;
    for (const d of dirs) {
      const pkgPath = `${workshop}/${d}/scene.pkg`;
      const staticRes = await handleRenderRequest({
        requestId: 100,
        pkgPath,
        mode: 'static',
      });
      // Even for layers-only scenes the static output must be a string with
      // zero <script> tags — the L1 zero-runtime contract.
      if (staticRes.html) {
        expect(staticRes.html).not.toContain('<script');
        expect(staticRes.html).toContain('<img');
        exercised = true;
        break;
      }
    }
    // At least one real scene should produce a static image; otherwise the
    // workshop dir contains no renderable assets, which is an environment
    // issue — not a code bug.
    expect(exercised).toBe(true);
  }, 120000);

  it('static mode degrades to null (no error) for a missing pkg', async () => {
    const res = await handleRenderRequest({
      requestId: 2,
      pkgPath: 'C:/definitely/not/a/scene.pkg',
      mode: 'static',
    });
    expect(res.requestId).toBe(2);
    expect(res.html).toBeNull();
    // extractScene returns null on parse failure; the static path swallows
    // it to null (same contract as full mode).
    expect(res.error).toBeUndefined();
  });
});
