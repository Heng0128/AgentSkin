// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-hot-reload
 *
 * Incremental theme configuration hot-reload engine.
 *
 * Watches a theme's palette CSS file for changes and pushes only the
 * **changed** `--agentskin-*` CSS variables to the target agent via CDP,
 * avoiding a full re-injection on every save.
 *
 * ## Architecture
 *
 *   fs.watch(palette.css) → debounce(300ms) → parseVariables → diff →
 *   CDP evaluate(:root { --agentskin-x: new }) → verify → commit/rollback
 *
 * ## Design notes
 *
 * - Uses Node's built-in `fs.watch` (no chokidar dependency) for file
 *   monitoring. The watcher is replaced on each successful reload to
 *   recover from Windows handle invalidation.
 * - Variable-level diff: only CSS custom properties whose value actually
 *   changed are included in the injected `:root {}` block.
 * - Rollback: on CDP failure, the previous variable snapshot is resent
 *   to restore the agent to a known-good state.
 * - Debounce: 300ms coalesces rapid saves (e.g. Studio auto-save) into
 *   a single update.
 */

import fs from 'node:fs';
import path from 'node:path';
import { toMessage } from '../../shared/errors';
import type { CdpSession } from '../cdp/cdp-client';
import { mainWarn } from '../logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce window (ms) coalescing rapid file-change events. */
export const HOT_RELOAD_DEBOUNCE_MS = 300;

/** Regex extracting --agentskin-* custom properties from CSS text. */
const AGENTSKIN_VAR_REGEX = /--agentskin-([\w-]+)\s*:\s*([^;]+);/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A snapshot of --agentskin-* variables at a point in time. */
export type VariableSnapshot = Record<string, string>;

/** Result of a hot-reload attempt. */
export interface HotReloadResult {
  /** Whether the reload was applied successfully. */
  success: boolean;
  /** Number of variables that changed since the previous snapshot. */
  changedCount: number;
  /** Variable names that changed (for diagnostics). */
  changedKeys: string[];
  /** True when no variables changed (short-circuit, no CDP call). */
  noOp: boolean;
  /** Error message when success === false. */
  error?: string;
}

/** Options for constructing a ThemeHotReloader. */
export interface ThemeHotReloadOptions {
  /** Absolute path to the palette CSS file to watch. */
  palettePath: string;
  /** CDP session to the target agent. */
  session: CdpSession;
  /** Optional initial variable snapshot (skips first diff if provided). */
  initialSnapshot?: VariableSnapshot;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse `--agentskin-*` custom properties from CSS text.
 *
 * Returns a flat map of `{ variableName: value }` where `variableName`
 * includes the `agentskin-` prefix (e.g. `agentskin-accent`).
 *
 * Hyphenated names are preserved as-is (unlike `extractColors` which
 * normalizes them) because the CDP injection writes them back verbatim.
 */
export function parseVariables(cssText: string): VariableSnapshot {
  const result: VariableSnapshot = {};
  // Reset regex state for repeat calls.
  AGENTSKIN_VAR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = AGENTSKIN_VAR_REGEX.exec(cssText)) !== null) {
    const [, name, value] = match;
    result[`agentskin-${name}`] = value.trim();
  }
  return result;
}

/**
 * Compute the variable-level diff between two snapshots.
 *
 * Returns the variables that were added, removed, or changed in
 * `next` relative to `prev`. The diff is a flat map suitable for
 * generating a `:root { ... }` CSS block.
 */
export function diffVariables(
  prev: VariableSnapshot,
  next: VariableSnapshot,
): { diff: VariableSnapshot; changedKeys: string[] } {
  const diff: VariableSnapshot = {};
  const changedKeys: string[] = [];

  for (const [key, value] of Object.entries(next)) {
    if (prev[key] !== value) {
      diff[key] = value;
      changedKeys.push(key);
    }
  }

  // Detect removed variables (present in prev but absent in next).
  // These are included with an empty value so the CDP side can call
  // style.removeProperty() to clear them.
  for (const key of Object.keys(prev)) {
    if (!(key in next) && !changedKeys.includes(key)) {
      diff[key] = '';
      changedKeys.push(key);
    }
  }

  return { diff, changedKeys };
}

/**
 * Build a CDP evaluate expression that applies variable overrides to
 * `:root`. Removed variables (empty value) are cleared via
 * `removeProperty`.
 *
 * The expression returns `'ok'` on success or throws (caught by the
 * session layer).
 */
export function buildVariableApplyExpression(diff: VariableSnapshot): string {
  const sets: string[] = [];
  const removes: string[] = [];

  for (const [key, value] of Object.entries(diff)) {
    if (value === '') {
      removes.push(`root.style.removeProperty('${key}');`);
    } else {
      // Escape single quotes in value to prevent expression injection.
      const safeValue = value.replace(/'/g, "\\'");
      sets.push(`root.style.setProperty('${key}', '${safeValue}');`);
    }
  }

  return `(() => {
    const root = document.documentElement;
    if (!root) return 'err:no-root';
    ${sets.join('\n    ')}
    ${removes.join('\n    ')}
    return 'ok';
  })()`;
}

/**
 * Read the palette CSS file and parse its variables.
 * Returns an empty snapshot on read error (caller decides handling).
 */
export function readPaletteVariables(palettePath: string): VariableSnapshot {
  try {
    const text = fs.readFileSync(palettePath, 'utf8');
    return parseVariables(text);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

/**
 * Create a debounced wrapper around `fn`. Rapid calls within `delayMs`
 * reset the timer; only the final call within the window fires `fn`.
 *
 * The returned function is cancelable via `.cancel()`.
 */
export type Debouncer = { (): void; cancel: () => void };

export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

/**
 * Watches a theme's palette CSS file and applies incremental updates
 * to a target agent via CDP.
 *
 * Lifecycle:
 *   - Construct with palette path + CDP session.
 *   - Call `start()` to begin watching.
 *   - Call `stop()` to cease watching and release the file handle.
 *   - Call `dispose()` to stop + cancel any pending debounce timer.
 */
export class ThemeHotReloader {
  private watcher: fs.FSWatcher | null = null;
  private currentSnapshot: VariableSnapshot;
  private pendingDebounce: Debouncer | null = null;
  private rollbackSnapshot: VariableSnapshot | null = null;
  private active = false;

  constructor(private readonly options: ThemeHotReloadOptions) {
    this.currentSnapshot = options.initialSnapshot ?? {};
  }

  /**
   * Start watching the palette file for changes.
   *
   * If no initial snapshot was provided, reads the current file content
   * to establish a baseline. Subsequent changes are diffed against this
   * baseline.
   */
  start(): void {
    if (this.active) return;

    // Establish baseline if not provided.
    if (Object.keys(this.currentSnapshot).length === 0) {
      this.currentSnapshot = readPaletteVariables(this.options.palettePath);
    }

    this.active = true;
    this.installWatcher();
  }

  /**
   * Stop watching the palette file. Does not cancel pending debounce
   * timers — use `dispose()` for full cleanup.
   */
  stop(): void {
    this.active = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Full cleanup: stop watching and cancel any pending debounce timer.
   */
  dispose(): void {
    this.stop();
    this.pendingDebounce?.cancel();
    this.pendingDebounce = null;
  }

  /**
   * Manually trigger a reload (bypasses file watcher). Useful for
   * programmatic updates from the Studio UI.
   *
   * Returns the result of the reload attempt.
   */
  async reloadNow(): Promise<HotReloadResult> {
    return this.performReload();
  }

  /** Get the current variable snapshot (for testing / diagnostics). */
  getSnapshot(): VariableSnapshot {
    return { ...this.currentSnapshot };
  }

  /** Whether the watcher is currently active. */
  isActive(): boolean {
    return this.active;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Install the fs.watch handler on the palette file's directory.
   *
   * We watch the *directory* (not the file directly) because some
   * editors do atomic writes (rename tempfile → target) which would
   * invalidate a file-level watch handle on Windows. The callback
   * filters events by filename to react only to our palette file.
   */
  private installWatcher(): void {
    const dir = path.dirname(this.options.palettePath);
    const fileName = path.basename(this.options.palettePath);

    try {
      this.watcher = fs.watch(dir, (_eventType, filename) => {
        if (filename !== fileName) return;
        this.onFileChanged();
      });
    } catch (error) {
      mainWarn('ThemeHotReload', `fs.watch failed: ${toMessage(error)}`);
    }
  }

  /**
   * Called when the palette file changes. Debounces the actual reload.
   */
  private onFileChanged(): void {
    this.pendingDebounce?.cancel();
    this.pendingDebounce = createDebouncer(() => {
      this.pendingDebounce = null;
      void this.performReload();
    }, HOT_RELOAD_DEBOUNCE_MS);
    // Trigger the debounced call.
    this.pendingDebounce?.();
  }

  /**
   * Core reload logic: read → diff → CDP apply → verify → commit/rollback.
   */
  private async performReload(): Promise<HotReloadResult> {
    const nextSnapshot = readPaletteVariables(this.options.palettePath);

    // Short-circuit: file read failure → report error.
    if (Object.keys(nextSnapshot).length === 0 && Object.keys(this.currentSnapshot).length > 0) {
      mainWarn('ThemeHotReload', 'palette file read returned empty — skipping reload');
      return {
        success: false,
        changedCount: 0,
        changedKeys: [],
        noOp: false,
        error: 'Failed to read palette file',
      };
    }

    const { diff, changedKeys } = diffVariables(this.currentSnapshot, nextSnapshot);

    // Short-circuit: no changes detected.
    if (changedKeys.length === 0) {
      return { success: true, changedCount: 0, changedKeys: [], noOp: true };
    }

    // Build the CDP expression.
    const expression = buildVariableApplyExpression(diff);

    // Save current snapshot for potential rollback.
    this.rollbackSnapshot = { ...this.currentSnapshot };

    try {
      const result = await this.options.session.evaluate(expression);

      if (result !== 'ok') {
        // CDP returned a non-ok result → attempt rollback.
        mainWarn('ThemeHotReload', `CDP returned non-ok: ${result}`);
        await this.rollback();
        return {
          success: false,
          changedCount: changedKeys.length,
          changedKeys,
          noOp: false,
          error: `CDP evaluate returned: ${result}`,
        };
      }

      // Commit: update the current snapshot.
      this.currentSnapshot = nextSnapshot;
      this.rollbackSnapshot = null;

      return {
        success: true,
        changedCount: changedKeys.length,
        changedKeys,
        noOp: false,
      };
    } catch (error) {
      // CDP evaluate threw → attempt rollback.
      mainWarn('ThemeHotReload', `CDP evaluate failed: ${toMessage(error)}`);
      await this.rollback();
      return {
        success: false,
        changedCount: changedKeys.length,
        changedKeys,
        noOp: false,
        error: toMessage(error),
      };
    }
  }

  /**
   * Roll back to the snapshot saved before the failed reload.
   * Best-effort: if rollback also fails, the agent may be in an
   * inconsistent state, but we log and move on.
   */
  private async rollback(): Promise<void> {
    if (!this.rollbackSnapshot) return;

    const expression = buildVariableApplyExpression(this.rollbackSnapshot);
    try {
      await this.options.session.evaluate(expression);
      this.currentSnapshot = this.rollbackSnapshot;
      mainWarn('ThemeHotReload', 'rollback succeeded');
    } catch (error) {
      mainWarn('ThemeHotReload', `rollback also failed: ${toMessage(error)}`);
    } finally {
      this.rollbackSnapshot = null;
    }
  }
}
