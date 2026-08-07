// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio History (Undo / Redo Stack)
 *
 * Tracks Theme Studio project-mutation history and provides bounded
 * undo/redo. Each entry captures a before/after snapshot of the
 * StudioProject for one atomic edit — moving the slider, uploading a
 * new image, applying a tonal ramp all push ONE entry.
 *
 * ## Why a standalone module
 *
 * ThemeStudioPage currently recomputes `palette` and `toolOverrides`
 * inside setOverride / onThemeGenerated and writes to disk via
 * `saveActiveProject`. Pushing undo logic into that component would:
 *
 *   - Mix UI state orchestration with history bookkeeping.
 *   - Make undo/redo untestable without mounting the whole page.
 *
 * Extracting the stack as a pure module means the page just calls
 * `snapshot.record(project, description)` after every successful
 * mutation, and dispatches `undo()` / `redo()` on Ctrl+Z / Ctrl+Shift+Z.
 *
 * ## Bounded
 *
 * The stack holds at most `limit` entries (default 50). This prevents a
 * user sliding a hue slider 200 times from leaking memory indefinitely.
 * When the tail is trimmed, that entry is gone forever — typical UX.
 *
 * ## Design
 *
 *   - Immutable entries: every snapshot is deep-cloned at `record()` time.
 *     The stack never holds references to live project objects, so future
 *     renders don't mutate history by accident.
 *   - Stable pointer: `cursor` indicates where we are in the history.
 *     Undoing decrements the cursor; recording after undo truncates the
 *     redo tail (matches Git's reflog / most editors).
 *   - Deep-clone: `record` uses `structuredClone` (Node ≥17, our baseline).
 *
 * Inspired by: VSCode's undo stack, Tokens Studio history, Git reflog.
 */

import type { StudioProject } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One immutable snapshot of a StudioProject at a point in time. */
export interface HistoryEntry {
  /** Project state BEFORE the edit that produced the next entry. */
  snapshot: StudioProject;
  /** User-facing description for the history panel (e.g. "将 accent 改为 #FF453A"). */
  description: string;
  /** ISO timestamp — used for sorting + tooltip. */
  timestamp: string;
}

/** Read-only view of history state for UI rendering. */
export interface HistoryView {
  entries: Array<{ description: string; timestamp: string }>;
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface StudioHistoryOptions {
  /** Maximum number of entries to retain (default 50). */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export class StudioHistory {
  private entries: HistoryEntry[] = [];
  /** Index of the *current* state — points to the entry we restored last. */
  private cursor = -1;
  private readonly limit: number;

  constructor(options: StudioHistoryOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 50);
  }

  // -----------------------------------------------------------------------
  // Core ops
  // -----------------------------------------------------------------------

  /**
   * Record a new mutation. Any forward history (redo tail) is discarded,
   * matching conventional editor behavior.
   *
   * @param snapshot  Deep-cloned project state BEFORE this mutation
   *                  (the "undo-to-here" state).
   * @param description  User-facing edit description.
   */
  record(snapshot: StudioProject, description: string): void {
    // Discard redo tail.
    if (this.cursor < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.cursor + 1);
    }

    this.entries.push({
      snapshot: structuredClone(snapshot),
      description,
      timestamp: new Date().toISOString(),
    });
    this.cursor = this.entries.length - 1;

    // Trim head if over limit.
    if (this.entries.length > this.limit) {
      const overflow = this.entries.length - this.limit;
      this.entries = this.entries.slice(overflow);
      this.cursor -= overflow;
    }
  }

  /**
   * Step backwards. Returns the project snapshot to **restore** (i.e. the
   * state before the undone edit), or null if at the bottom of the stack.
   */
  undo(): StudioProject | null {
    if (!this.canUndo()) return null;
    this.cursor--;
    return structuredClone(this.snapshotAtCursor());
  }

  /**
   * Step forward. Returns the snapshot to restore, or null if at the tip.
   */
  redo(): StudioProject | null {
    if (!this.canRedo()) return null;
    this.cursor++;
    return structuredClone(this.snapshotAtCursor());
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** Current snapshot (the one matching the UI right now). */
  current(): StudioProject | null {
    if (this.cursor < 0) return null;
    return structuredClone(this.snapshotAtCursor());
  }

  /** View for UI display. */
  view(): HistoryView {
    return {
      entries: this.entries.map((e, i) => ({
        description: e.description,
        timestamp: e.timestamp,
        // Convenience: expose whether this entry is "before" or "at" the cursor.
        _cursor: i === this.cursor,
      })),
      cursor: this.cursor,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  /** Clear all history (e.g. on project switch). */
  reset(): void {
    this.entries = [];
    this.cursor = -1;
  }

  get size(): number {
    return this.entries.length;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private snapshotAtCursor(): StudioProject {
    return this.entries[this.cursor].snapshot;
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Convenience: format an ISO timestamp for the history panel (locale short). */
export function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  // new Date('garbage') does NOT throw — it yields an Invalid Date whose
  // toLocaleTimeString() returns the literal "Invalid Date". Guard against
  // that explicitly and fall back to the raw input so the UI never shows
  // that confusing string.
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
