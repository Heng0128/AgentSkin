// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../shared/types';
import { EpochManager } from './epoch-manager';

// ---------------------------------------------------------------------------
// EpochManager is intentionally small (a thin wrapper around a Map) because
// it guards *all* CDP target manipulation — any bug here would silently
// disable epoch cancellation across hardening, scheme-sync, and wallpaper
// injection. Isolated tests verify the bump → capture → cancel invariant
// without needing to stand up the full orchestrator.
// ---------------------------------------------------------------------------

const APP_A: AgentId = 'workbuddy';
const APP_B: AgentId = 'qoderwork';

let mgr: EpochManager;

beforeEach(() => {
  mgr = new EpochManager();
});

describe('EpochManager.bumpEpoch', () => {
  it('starts at epoch 1 for an agent that has never been bumped', () => {
    expect(mgr.bumpEpoch(APP_A)).toBe(1);
  });

  it('monotonically increments for the same agent across bump calls', () => {
    expect(mgr.bumpEpoch(APP_A)).toBe(1);
    expect(mgr.bumpEpoch(APP_A)).toBe(2);
    expect(mgr.bumpEpoch(APP_A)).toBe(3);
    expect(mgr.bumpEpoch(APP_A)).toBe(4);
  });

  it('isolates epochs between different agents (no cross-agent interference)', () => {
    // Agent A bumps independently of agent B.
    mgr.bumpEpoch(APP_A); // 1
    mgr.bumpEpoch(APP_A); // 2
    const a3 = mgr.bumpEpoch(APP_A); // 3

    const b1 = mgr.bumpEpoch(APP_B); // 1 (not 4)
    const b2 = mgr.bumpEpoch(APP_B); // 2

    expect(a3).toBe(3);
    expect(b1).toBe(1);
    expect(b2).toBe(2);
  });
});

describe('EpochManager.isEpochCurrent', () => {
  it('returns false for an agent that has never been bumped (implicit epoch 0)', () => {
    // Never bumped → stored epoch is 0. A caller holding "captured = 0"
    // should see it as current, captured = 1 should not.
    expect(mgr.isEpochCurrent(APP_A, 0)).toBe(true);
    expect(mgr.isEpochCurrent(APP_A, 1)).toBe(false);
  });

  it('returns true immediately after a bump (the caller holds the new epoch)', () => {
    const e1 = mgr.bumpEpoch(APP_A);
    expect(mgr.isEpochCurrent(APP_A, e1)).toBe(true);

    const e2 = mgr.bumpEpoch(APP_A);
    expect(mgr.isEpochCurrent(APP_A, e2)).toBe(true);
  });

  it('returns false for a stale captured epoch after a newer bump', () => {
    const captured = mgr.bumpEpoch(APP_A);
    // Simulate a new operation (apply / restore / reapply) that bumps epoch.
    mgr.bumpEpoch(APP_A);
    // The old captured epoch is now stale.
    expect(mgr.isEpochCurrent(APP_A, captured)).toBe(false);
  });

  it('returns false only for the agent whose epoch changed (per-agent)', () => {
    const aCaptured = mgr.bumpEpoch(APP_A);
    const bCaptured = mgr.bumpEpoch(APP_B);

    // Only bump agent B.
    mgr.bumpEpoch(APP_B);

    // Agent A's captured epoch is still current.
    expect(mgr.isEpochCurrent(APP_A, aCaptured)).toBe(true);
    // Agent B's was superseded.
    expect(mgr.isEpochCurrent(APP_B, bCaptured)).toBe(false);
  });

  it('survives many bumps without integer wrapping bugs', () => {
    for (let i = 0; i < 1000; i++) mgr.bumpEpoch(APP_A);
    const captured = mgr.bumpEpoch(APP_A);
    expect(captured).toBe(1001);
    expect(mgr.isEpochCurrent(APP_A, captured)).toBe(true);

    mgr.bumpEpoch(APP_A);
    expect(mgr.isEpochCurrent(APP_A, captured)).toBe(false);
  });
});

describe('EpochManager.clear', () => {
  it('removes all epoch entries for every agent', () => {
    mgr.bumpEpoch(APP_A);
    mgr.bumpEpoch(APP_A);
    mgr.bumpEpoch(APP_B);

    mgr.clear();

    // After clear, all agents revert to implicit epoch 0
    expect(mgr.isEpochCurrent(APP_A, 0)).toBe(true);
    expect(mgr.isEpochCurrent(APP_B, 0)).toBe(true);
  });

  it('allows epoch counting to restart from 1 after clear', () => {
    mgr.bumpEpoch(APP_A);
    mgr.bumpEpoch(APP_A);
    mgr.clear();

    // Next bump should start from 1 again
    expect(mgr.bumpEpoch(APP_A)).toBe(1);
    expect(mgr.isEpochCurrent(APP_A, 1)).toBe(true);
  });
});
