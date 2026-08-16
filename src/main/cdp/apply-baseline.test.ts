// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the RFC §4.5 fast-path baseline cache: `ApplyBaselineCache`
 * LRU(3) + TTL semantics, and the best-effort `captureBaseline` / probe
 * helpers. The cache is pure in-memory state (no CDP), so these tests
 * exercise it directly without any session mocks.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import {
  APPLY_BASELINE_LRU_CAPACITY,
  APPLY_BASELINE_TTL_MS,
  ApplyBaselineCache,
  type BaselineSnapshot,
} from './apply-baseline';

const APP: AgentId = 'workbuddy';

function snap(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return {
    appId: APP,
    themeId: 'theme-a',
    url: 'app://main',
    accent: '#3355ff',
    adoptedSheetCount: 1,
    heroBlobActive: false,
    semanticNodeCount: 2500,
    capturedAt: Date.now(),
    ...overrides,
  };
}

describe('ApplyBaselineCache (RFC §4.5)', () => {
  it('returns null on an empty cache', () => {
    const cache = new ApplyBaselineCache();
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
  });

  it('returns a stored snapshot keyed by appId+url+themeId', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap());
    expect(cache.get(APP, 'app://main', 'theme-a')).toEqual(
      expect.objectContaining({ themeId: 'theme-a', accent: '#3355ff' }),
    );
  });

  it('does not leak entries across different agents', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap());
    expect(cache.get('traework' as AgentId, 'app://main', 'theme-a')).toBeNull();
  });

  it('differentiates by url — a navigation key is a distinct entry', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ url: 'app://main' }));
    expect(cache.get(APP, 'app://other', 'theme-a')).toBeNull();
  });

  it('differentiates by themeId — a theme switch is a distinct entry', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    expect(cache.get(APP, 'app://main', 'theme-b')).toBeNull();
  });

  it('expires entries after the 60s TTL', () => {
    vi.useFakeTimers();
    try {
      const cache = new ApplyBaselineCache();
      cache.put(snap({ capturedAt: Date.now() }));
      vi.advanceTimersByTime(APPLY_BASELINE_TTL_MS + 1);
      expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least-recently-used entry when over the LRU(3) capacity', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.put(snap({ themeId: 'theme-c' }));
    // Touch theme-a (most-recently-used) before adding the 4th entry.
    cache.get(APP, 'app://main', 'theme-a');
    cache.put(snap({ themeId: 'theme-d' }));

    expect(cache.get(APP, 'app://main', 'theme-a')).not.toBeNull();
    // theme-b was least-recently-used → evicted.
    expect(cache.get(APP, 'app://main', 'theme-b')).toBeNull();
    expect(cache.size(APP)).toBe(APPLY_BASELINE_LRU_CAPACITY);
  });

  it('invalidate() clears the whole agent cache when no theme is given', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.invalidate(APP);
    expect(cache.size(APP)).toBe(0);
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
  });

  it('invalidate() removes only matching themeId entries otherwise', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.invalidate(APP, 'theme-a');
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
    expect(cache.get(APP, 'app://main', 'theme-b')).not.toBeNull();
  });

  it('clearAgent() removes all entries for an agent', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.clearAgent(APP);
    expect(cache.size(APP)).toBe(0);
  });
});
