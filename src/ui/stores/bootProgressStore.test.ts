// SPDX-License-Identifier: MPL-2.0

/**
 * # bootProgressStore tests — early-return / scheme_sync guards
 *
 * Verifies the pure-reducer logic of `applyLine`:
 * - When progress data is unchanged (phase/progress/reason/subPhase), the
 *   existing Map reference is returned so downstream subscribers short-circuit.
 * - When data changes, a new Map is created.
 * - `scheme_sync` never creates a new entry from scratch.
 * - `scheme_sync` never regresses a terminal state (done/failed).
 *
 * No external dependencies need mocking — `bootProgressStore` is self-contained.
 * `Date.now()` is spied on for deterministic `updatedAt`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STRUCTURED_PREFIX = '[STRUCTURED]|';

/** Wrap a StructuredEvent JSON in the log-line envelope that parseStructured expects. */
function line(event: Record<string, unknown>): string {
  return `${STRUCTURED_PREFIX}${JSON.stringify(event)}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bootProgressStore — applyLine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset store to pristine state before each test.
    useBootProgressStore.setState({ progress: new Map() });
    // Deterministic timestamp.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  // -----------------------------------------------------------------------
  // Test 1: same progress event twice → Map reference unchanged (early return)
  // -----------------------------------------------------------------------

  it('returns the same Map reference when an identical event is applied twice', () => {
    const ev = line({
      type: 'boot_agent_start',
      agentId: 'traework',
      timestamp: '2025-01-01T00:00:00Z',
    });

    // First call creates the entry.
    useBootProgressStore.getState().applyLine(ev);
    const mapAfterFirst = useBootProgressStore.getState().progress;
    expect(mapAfterFirst.size).toBe(1);

    // Second call with identical data → early return.
    useBootProgressStore.getState().applyLine(ev);
    const mapAfterSecond = useBootProgressStore.getState().progress;

    // The critical assertion: reference identity is preserved.
    expect(mapAfterSecond).toBe(mapAfterFirst);
    expect(mapAfterSecond.size).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Test 2: different progress event → Map reference changes
  // -----------------------------------------------------------------------

  it('creates a new Map reference when progress data actually changes', () => {
    const first = line({
      type: 'boot_agent_start',
      agentId: 'traework',
      timestamp: '2025-01-01T00:00:00Z',
      progress: 10,
    });

    const second = line({
      type: 'cdp_ready',
      agentId: 'traework',
      timestamp: '2025-01-01T00:00:01Z',
      progress: 50,
    });

    useBootProgressStore.getState().applyLine(first);
    const mapBefore = useBootProgressStore.getState().progress;
    expect(mapBefore.get('traework')?.phase).toBe('boot_start');
    expect(mapBefore.get('traework')?.progress).toBe(10);

    useBootProgressStore.getState().applyLine(second);
    const mapAfter = useBootProgressStore.getState().progress;

    // New Map reference, updated values.
    expect(mapAfter).not.toBe(mapBefore);
    expect(mapAfter.get('traework')?.phase).toBe('cdp_ready');
    expect(mapAfter.get('traework')?.progress).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Test 3: scheme_sync does not create a new entry when none exists
  // -----------------------------------------------------------------------

  it('scheme_sync does not create a new entry when the agent is unknown', () => {
    const syncEvent = line({
      type: 'scheme_sync',
      agentId: 'codex',
      timestamp: '2025-01-01T00:00:00Z',
      phase: 'start',
    });

    // Map starts empty; reference captured.
    const mapBefore = useBootProgressStore.getState().progress;
    expect(mapBefore.size).toBe(0);

    useBootProgressStore.getState().applyLine(syncEvent);
    const mapAfter = useBootProgressStore.getState().progress;

    // No entry created, reference unchanged.
    expect(mapAfter).toBe(mapBefore);
    expect(mapAfter.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 4: scheme_sync does not regress a terminal state (done/failed)
  // -----------------------------------------------------------------------

  it('scheme_sync does not overwrite a terminal phase (done → scheme_sync)', () => {
    // First: mark agent as done.
    const doneEvent = line({
      type: 'boot_agent_done',
      agentId: 'traework',
      timestamp: '2025-01-01T00:00:00Z',
    });

    useBootProgressStore.getState().applyLine(doneEvent);
    const mapAfterDone = useBootProgressStore.getState().progress;
    expect(mapAfterDone.get('traework')?.phase).toBe('done');

    // Second: scheme_sync arrives after completion → must be ignored.
    const syncEvent = line({
      type: 'scheme_sync',
      agentId: 'traework',
      timestamp: '2025-01-01T00:00:01Z',
      phase: 'drifted',
    });

    useBootProgressStore.getState().applyLine(syncEvent);
    const mapAfterSync = useBootProgressStore.getState().progress;

    // Map reference is identical (early return), phase stays 'done'.
    expect(mapAfterSync).toBe(mapAfterDone);
    expect(mapAfterSync.get('traework')?.phase).toBe('done');
    expect(mapAfterSync.get('traework')?.subPhase).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Import AFTER any vi.mock calls (none here, but keeps pattern consistent)
// ---------------------------------------------------------------------------
import { useBootProgressStore } from '@/stores/bootProgressStore';
