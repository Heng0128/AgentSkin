// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Window State (size / position / display memory)
 *
 * Persists Theme Studio window bounds (size + position + maximized flag +
 * which display it lives on) so reopening the Studio window lands the user
 * back where they left it — instead of always starting at the hard-coded
 * 1340x860 centre.
 *
 * ## Why a standalone module
 *
 * The `SettingsService` owns the main app's settings file, but studio
 * window bounds are transient state, not user configuration. Mixing them
 * would bloat the settings schema with positional data the user never
 * edits directly. This module keeps a tiny sidecar JSON
 * (`studio-window.json`) next to the main settings — load-bearing enough
 * to survive app restarts, isolated enough to ignore in backups.
 *
 * ## Display awareness (multi-monitor DPI)
 *
 * When a window was persisted on a monitor that no longer exists (e.g.
 * unplugging a 4K external display), naive restore would spawn the window
 * off-screen at coordinates like (3000, 200). `clampToNearestDisplay`
 * detects this and nudges the window back into the nearest display's
 * work area — the behaviour Electron's `BrowserWindow.getBounds` users
 * often hand-roll.
 *
 * ## Persistence
 *
 * Atomic write via `writeJsonAtomic` (tmp + rename) — same pattern as the
 * settings service. Malformed files fall back to factory defaults instead
 * of throwing, so a partial write never bricks the Studio launch.
 *
 * Pure module: all I/O is injected so it's testable without Electron.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from '../fs-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StudioWindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioWindowState extends StudioWindowBounds {
  isMaximized: boolean;
  /** Electron display `id` — hints at which monitor held the window. */
  displayId?: number;
}

/** I/O surface injected so tests can run without Electron. */
export interface StudioWindowStateIO {
  /** Persist the state (atomic). */
  write(state: StudioWindowState): Promise<void>;
  /** Read persisted state. Returns null if never saved or malformed. */
  read(): Promise<StudioWindowState | null>;
  /** Returns the work area of every connected display, or a single
   *  1280x720 fallback when detection is unavailable. */
  getDisplays(): Promise<DisplayBounds[]>;
}

/** Reasonable defaults when no state has ever been saved. */
export const DEFAULT_BOUNDS: StudioWindowBounds = {
  width: 1340,
  height: 860,
  x: -1, // sentinel: centre on primary
  y: -1,
};

export const MIN_WIDTH = 980;
export const MIN_HEIGHT = 680;

// ---------------------------------------------------------------------------
// Pure helpers (platform-independent, fully testable)
// ---------------------------------------------------------------------------

/**
 * Clamp persisted bounds into the nearest display's work area. Handles:
 *
 *   1. Monitor gone (persisted coordinates lie outside any current display).
 *   2. Window larger than the new display.
 *   3. Windows top-bar off-screen (y < workArea.y).
 *
 * Mutates nothing — returns a new bounds object.
 */
export function clampToNearestDisplay(
  bounds: StudioWindowBounds,
  displays: DisplayBounds[],
): StudioWindowBounds {
  if (displays.length === 0) return { ...bounds };

  const fallback: DisplayBounds = { x: 0, y: 0, width: 1280, height: 720 };
  const primary = displays[0] ?? fallback;

  // Find the display whose centre is closest to the persisted window centre.
  const windowCenterX = bounds.x + bounds.width / 2;
  const windowCenterY = bounds.y + bounds.height / 2;

  let nearest = primary;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const d of displays) {
    const cx = d.x + d.width / 2;
    const cy = d.y + d.height / 2;
    const dx = windowCenterX - cx;
    const dy = windowCenterY - cy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = d;
    }
  }

  const clamped: StudioWindowBounds = { ...bounds };

  // 1. Clamp size: upper bound by display dims, lower bound by MIN_SIZE.
  //    Order matters — apply upper bound BEFORE lower bound so that when
  //    the display is smaller than MIN, we still expand to MIN and accept
  //    that the window may overflow (handled in step 2).
  clamped.width = Math.max(MIN_WIDTH, Math.min(bounds.width, nearest.width));
  clamped.height = Math.max(MIN_HEIGHT, Math.min(bounds.height, nearest.height));

  // 2. Clamp position so the entire window falls within the display.
  //    Use Math.max(nearest.xy, displayRight - size) as the upper floor
  //    to guard against the case where (display.dims - clamped.size) is
  //    negative (tiny display that cannot fit MIN-sized window).
  const maxX = Math.max(nearest.x, nearest.x + nearest.width - clamped.width);
  const maxY = Math.max(nearest.y, nearest.y + nearest.height - clamped.height);
  clamped.x = Math.min(Math.max(bounds.x, nearest.x), maxX);
  clamped.y = Math.min(Math.max(bounds.y, nearest.y), maxY);

  return clamped;
}

/** Validate that a deserialized JSON actually describes a window state.
 *  Malformed fields → null (caller falls back to defaults). */
export function normalizeState(raw: unknown): StudioWindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const n = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const b = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

  return {
    width: Math.max(MIN_WIDTH, n(r.width, DEFAULT_BOUNDS.width)),
    height: Math.max(MIN_HEIGHT, n(r.height, DEFAULT_BOUNDS.height)),
    x: n(r.x, DEFAULT_BOUNDS.x),
    y: n(r.y, DEFAULT_BOUNDS.y),
    isMaximized: b(r.isMaximized, false),
    displayId: typeof r.displayId === 'number' ? r.displayId : undefined,
  };
}

// ---------------------------------------------------------------------------
// IO implementation (uses real fs in prod)
// ---------------------------------------------------------------------------

function defaultStateFilePath(): string {
  const userData = process.env.APPDATA ?? process.env.HOME ?? path.join(process.cwd(), 'user-data');
  return path.join(userData, 'studio-window.json');
}

export function createDefaultIO(
  stateFilePath: string = defaultStateFilePath(),
): StudioWindowStateIO {
  return {
    async write(state: StudioWindowState): Promise<void> {
      await writeJsonAtomic(stateFilePath, state);
    },
    async read(): Promise<StudioWindowState | null> {
      try {
        const buf = await fs.readFile(stateFilePath, 'utf8');
        const parsed = JSON.parse(buf);
        return normalizeState(parsed);
      } catch {
        // First run or corrupt — caller falls back to defaults.
        return null;
      }
    },
    async getDisplays(): Promise<DisplayBounds[]> {
      // Real display detection happens in window-manager via electron's
      // `screen.getAllDisplays()`. This stub is overridden by the caller.
      return [{ x: 0, y: 0, width: 1920, height: 1080 }];
    },
  };
}

// ---------------------------------------------------------------------------
// High-level API (used by window-manager)
// ---------------------------------------------------------------------------

/**
 * Load + clamp the persisted state so it fits the currently connected
 * displays. Falls back to defaults on first run / corruption / missing
 * monitor.
 */
export async function loadSafeWindowState(io: StudioWindowStateIO): Promise<StudioWindowState> {
  let state: StudioWindowState = { ...DEFAULT_BOUNDS, isMaximized: false };
  try {
    const persisted = await io.read();
    if (persisted) state = persisted;
  } catch {
    // Corrupt file, permission error — fall back to defaults silently.
  }
  const displays = await io.getDisplays();
  const clamped = clampToNearestDisplay(state, displays);
  return { ...state, ...clamped };
}

/**
 * Capture live bounds from a BrowserWindow (excluding OS-drawn chrome like
 * Windows 11 rounded corners — just the content's memory).
 */
export function captureWindowState(win: {
  getBounds(): { x: number; y: number; width: number; height: number };
  isMaximized(): boolean;
  getDisplayMatching(bounds: { x: number; y: number; width: number; height: number }): {
    id: number;
  };
}): StudioWindowState {
  const b = win.getBounds();
  return {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    isMaximized: win.isMaximized(),
    displayId: win.getDisplayMatching(b).id,
  };
}
