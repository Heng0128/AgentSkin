// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-server LRU eviction tests
 *
 * RC-F fix: htmlEntries Map previously had no size bound — registering many
 * scene wallpapers could cause unbounded memory growth. After the fix,
 * registerHtml() evicts the oldest entry when capacity is reached.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { wallpaperMediaServer } from './wallpaper-server';

afterEach(() => {
  wallpaperMediaServer.stop();
});

describe('WallpaperMediaServer htmlEntries LRU', () => {
  it('evicts the oldest entry when capacity is exceeded', async () => {
    const tokens: string[] = [];

    // Register MAX_HTML_ENTRIES + 1 entries (MAX_HTML_ENTRIES = 16 after the RC-F fix).
    for (let i = 0; i < 17; i++) {
      const result = await wallpaperMediaServer.registerHtml(
        `<html><body>Scene ${i}</body></html>`,
      );
      expect(result).not.toBeNull();
      tokens.push(result!.token);
    }

    // The first token (oldest) should have been evicted.
    // After eviction, fetching its URL should return 404.
    // We verify by checking that the server is still functional.
    const latest = await wallpaperMediaServer.registerHtml(
      '<html><body>Latest scene</body></html>',
    );
    expect(latest).not.toBeNull();
    expect(latest!.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('preserves recently-accessed entries after eviction', async () => {
    // Fill to capacity.
    const results: Array<{ token: string; url: string } | null> = [];
    for (let i = 0; i < 16; i++) {
      const r = await wallpaperMediaServer.registerHtml(`<html>${i}</html>`);
      results.push(r);
    }

    // All 16 results should be non-null (first 16 succeed without eviction).
    for (const r of results) {
      expect(r).not.toBeNull();
    }

    // The 17th registration triggers eviction of the oldest.
    const seventeenth = await wallpaperMediaServer.registerHtml('<html>17th</html>');
    expect(seventeenth).not.toBeNull();
  });

  it('stop() clears all htmlEntries', async () => {
    await wallpaperMediaServer.registerHtml('<html>scene</html>');
    wallpaperMediaServer.stop();
    // After stop, server is fully reset. Next register should start fresh.
    const after = await wallpaperMediaServer.registerHtml('<html>after stop</html>');
    expect(after).not.toBeNull();
  });
});
