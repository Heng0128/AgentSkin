// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  clampToNearestDisplay,
  DEFAULT_BOUNDS,
  type DisplayBounds,
  loadSafeWindowState,
  MIN_HEIGHT,
  MIN_WIDTH,
  normalizeState,
  type StudioWindowState,
  type StudioWindowStateIO,
} from './studio-window-state';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIO(
  state: StudioWindowState | null,
  displays: DisplayBounds[] = [],
): StudioWindowStateIO {
  return {
    async write() {},
    async read() {
      return state;
    },
    async getDisplays() {
      return displays.length > 0 ? displays : [{ x: 0, y: 0, width: 1920, height: 1080 }];
    },
  };
}

// ---------------------------------------------------------------------------
// normalizeState
// ---------------------------------------------------------------------------

describe('normalizeState', () => {
  it('returns null for garbage input', () => {
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState('string')).toBeNull();
    expect(normalizeState(42)).toBeNull();
    // An empty object is valid — falls back to defaults rather than null,
    //   since a persisted zero-field object still represents a saved window.
    expect(normalizeState({})).toMatchObject({ width: DEFAULT_BOUNDS.width });
  });

  it('applies floor for below-min size', () => {
    const s = normalizeState({ width: 200, height: 200, x: 0, y: 0 });
    expect(s?.width).toBe(MIN_WIDTH);
    expect(s?.height).toBe(MIN_HEIGHT);
  });

  it('falls back to defaults for missing numeric fields', () => {
    const s = normalizeState({});
    expect(s?.width).toBe(DEFAULT_BOUNDS.width);
    expect(s?.height).toBe(DEFAULT_BOUNDS.height);
    expect(s?.x).toBe(DEFAULT_BOUNDS.x);
  });

  it('preserves displayId when present', () => {
    const s = normalizeState({ width: 1280, height: 800, x: 0, y: 0, displayId: 42 });
    expect(s?.displayId).toBe(42);
  });

  it('drops displayId when not a number', () => {
    const s = normalizeState({ displayId: 'not-a-number' });
    expect(s?.displayId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clampToNearestDisplay
// ---------------------------------------------------------------------------

describe('clampToNearestDisplay', () => {
  const PRIMARY: DisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const EXTERNAL: DisplayBounds = { x: 1920, y: 0, width: 3840, height: 2160 };

  it('passes through valid bounds on primary without change', () => {
    const b = { x: 100, y: 100, width: 1340, height: 860 };
    const out = clampToNearestDisplay(b, [PRIMARY]);
    expect(out).toEqual(b);
  });

  it('clamps oversized window to display bounds', () => {
    const b = { x: 0, y: 0, width: 4000, height: 3000 };
    const out = clampToNearestDisplay(b, [PRIMARY]);
    expect(out.width).toBe(PRIMARY.width);
    expect(out.height).toBe(PRIMARY.height);
  });

  it('pulls off-screen window back into primary (monitor removed)', () => {
    // Window was on an external display that is now unplugged.
    const b = { x: 5000, y: 2000, width: 1340, height: 860 };
    const out = clampToNearestDisplay(b, [PRIMARY]);
    // Should be clamped into the primary display.
    expect(out.x).toBeLessThanOrEqual(PRIMARY.x + PRIMARY.width - MIN_WIDTH);
    expect(out.y).toBeLessThanOrEqual(PRIMARY.y + PRIMARY.height - MIN_HEIGHT);
    expect(out.x).toBeGreaterThanOrEqual(PRIMARY.x);
    expect(out.y).toBeGreaterThanOrEqual(PRIMARY.y);
  });

  it('snaps to external display when that is nearest', () => {
    const b = { x: 2500, y: 500, width: 1340, height: 860 };
    const out = clampToNearestDisplay(b, [PRIMARY, EXTERNAL]);
    // Should remain on the external display.
    expect(out.x).toBeGreaterThanOrEqual(EXTERNAL.x);
  });

  it('falls back to defaults when no displays are provided', () => {
    const b = { x: 50, y: 50, width: 1280, height: 800 };
    const out = clampToNearestDisplay(b, []);
    expect(out).toEqual(b);
  });

  it('never returns below MIN_WIDTH / MIN_HEIGHT', () => {
    const tiny: DisplayBounds = { x: 0, y: 0, width: 640, height: 480 };
    const b = { x: 0, y: 0, width: 640, height: 480 };
    const out = clampToNearestDisplay(b, [tiny]);
    expect(out.width).toBe(MIN_WIDTH);
    expect(out.height).toBe(MIN_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// loadSafeWindowState
// ---------------------------------------------------------------------------

describe('loadSafeWindowState', () => {
  it('returns defaults when nothing is persisted', async () => {
    const io = makeIO(null);
    const state = await loadSafeWindowState(io);
    expect(state.width).toBe(DEFAULT_BOUNDS.width);
    expect(state.height).toBe(DEFAULT_BOUNDS.height);
    expect(state.isMaximized).toBe(false);
  });

  it('round-trips persisted state through IO', async () => {
    const persisted: StudioWindowState = {
      x: 120,
      y: 80,
      width: 1440,
      height: 900,
      isMaximized: false,
    };
    const io = makeIO(persisted);
    const state = await loadSafeWindowState(io);
    expect(state.x).toBe(120);
    expect(state.y).toBe(80);
    expect(state.width).toBe(1440);
    expect(state.height).toBe(900);
  });

  it('clamps persisted off-screen state to current displays', async () => {
    const persisted: StudioWindowState = {
      x: 99999,
      y: 99999,
      width: 4000,
      height: 3000,
      isMaximized: false,
    };
    const io = makeIO(persisted);
    const state = await loadSafeWindowState(io);
    expect(state.x).toBeLessThan(1000);
    expect(state.y).toBeLessThan(1000);
    expect(state.width).toBeLessThanOrEqual(1920);
  });
});

// ---------------------------------------------------------------------------
// createDefaultIO read path
// ---------------------------------------------------------------------------

describe('createDefaultIO', () => {
  it('read returns null when read() throws', async () => {
    const io: StudioWindowStateIO = {
      async write() {},
      async read() {
        throw new Error('EACCES');
      },
      async getDisplays() {
        return [{ x: 0, y: 0, width: 1920, height: 1080 }];
      },
    };
    const state = await loadSafeWindowState(io);
    expect(state.width).toBe(DEFAULT_BOUNDS.width);
  });
});
