// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaperVideo tests
 *
 * Unit tests for the web URL LRU cache cap (R6-17). Verifies that the
 * `webCache` grows no larger than MAX_WEB_CACHE_SIZE and evicts the oldest
 * entry first.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWallpaperWebUrl } = vi.hoisted(() => ({
  mockWallpaperWebUrl: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    wallpaperWebUrl: mockWallpaperWebUrl,
  },
}));

// Import AFTER mock is in place
import { fetchWallpaperWebUrl } from './wallpaperVideo';

describe('fetchWallpaperWebUrl — LRU cache cap (R6-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each call returns a unique URL so we can distinguish entries.
    mockWallpaperWebUrl.mockImplementation(async (id: string) => `http://127.0.0.1/web/${id}`);
  });

  it('evicts the oldest entry when cache exceeds MAX_WEB_CACHE_SIZE', async () => {
    // Fill cache to capacity (MAX_WEB_CACHE_SIZE = 20).
    for (let i = 0; i < 20; i++) {
      await fetchWallpaperWebUrl(`wp-${i}`);
    }
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(20);

    // First 20 should now be cached — no additional IPC calls.
    for (let i = 0; i < 20; i++) {
      await fetchWallpaperWebUrl(`wp-${i}`);
    }
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(20); // cache hits, no new IPC.

    // Add a 21st entry — this should evict the oldest (wp-0).
    await fetchWallpaperWebUrl('wp-20');
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(21);

    // wp-1 should still be cached (was not evicted yet — only wp-0 was).
    await fetchWallpaperWebUrl('wp-1');
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(21); // cache hit, no new IPC.

    // wp-0 was evicted — fetching it again triggers a new IPC call.
    // This re-fetch inserts wp-0 back, evicting wp-1 as oldest.
    await fetchWallpaperWebUrl('wp-0');
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(22); // re-fetch = cache miss.

    // wp-1 was evicted by the wp-0 re-fetch above — must re-fetch.
    await fetchWallpaperWebUrl('wp-1');
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(23); // cache miss, new IPC.
  });

  it('returns null and does not cache on api failure', async () => {
    mockWallpaperWebUrl.mockResolvedValueOnce(null);

    const result = await fetchWallpaperWebUrl('wp-fail');
    expect(result).toBeNull();

    // After a null result, retries should re-call the api (not cached).
    await fetchWallpaperWebUrl('wp-fail');
    expect(mockWallpaperWebUrl).toHaveBeenCalledTimes(2);
  });
});
