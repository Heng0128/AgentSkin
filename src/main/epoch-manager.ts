// SPDX-License-Identifier: MPL-2.0

/**
 * # Epoch Manager
 *
 * Extracted from `AgentEngineService` (P2-a of the god-object teardown).
 *
 * Monotonic epoch per agent — bumped at the start of every apply / restore
 * / reapply. Background tasks (hardening, scheme-sync, secondary-inject,
 * secondary-remove, scheme-restore) capture the epoch when they start and
 * abort early if it changes, so a stale background task from a previous
 * operation can never race the next operation's CDP target manipulation.
 *
 * This covers the gap left by `applyingTheme`: the lock only guards
 * `adapter.applyTheme` / `adapter.restoreTheme`, but the real theme
 * lifecycle includes non-blocking follow-ups (secondary inject, hardening,
 * scheme stability window up to 10s) that keep touching the CDP target
 * after the lock is released. Epoch cancellation makes those follow-ups
 * self-terminate the moment a newer operation supersedes them.
 *
 * ## Why a separate class?
 *
 * The epoch state is accessed by multiple extracted sub-modules
 * (`scheme-sync`, `wallpaper-injector`, `cdp-fanout`) via `*Deps`
 * interfaces. Encapsulating it in a dedicated class:
 *  1. Keeps the state management logic in one testable place.
 *  2. Makes the `AgentEngineService` leaner (one fewer field + two fewer
 *     methods).
 *  3. Allows unit-testing epoch cancellation in isolation without standing
 *     up the full orchestrator.
 */

import type { AgentId } from '../shared/types';

export class EpochManager {
  private readonly epochs = new Map<AgentId, number>();

  /**
   * Bump the epoch for an agent. Returns the new value for the caller to
   * pass to background tasks so they can detect supersession.
   *
   * Called at the start of every apply / restore / reapply operation.
   */
  bumpEpoch(appId: AgentId): number {
    const next = (this.epochs.get(appId) ?? 0) + 1;
    this.epochs.set(appId, next);
    return next;
  }

  /**
   * True if `captured` is still the current epoch for `appId`. Background
   * tasks check this before each CDP touch and abort when it flips.
   *
   * This is the cancellation guard that prevents stale background tasks
   * from racing newer operations.
   */
  isEpochCurrent(appId: AgentId, captured: number): boolean {
    return (this.epochs.get(appId) ?? 0) === captured;
  }

  /**
   * Clear all epoch entries. Called during service disposal to release
   * the internal Map and allow GC of the EpochManager instance itself
   * when the service is torn down.
   */
  clear(): void {
    this.epochs.clear();
  }
}
