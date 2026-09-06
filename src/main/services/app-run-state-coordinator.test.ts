// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRunState } from '../../shared/types/agent';
import { AppRunStateCoordinator, type StatusChangeEvent } from './app-run-state-coordinator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh coordinator instance for test isolation. */
function createCoordinator(opts?: ConstructorParameters<typeof AppRunStateCoordinator>[0]) {
  return new AppRunStateCoordinator(opts);
}

/** Build a minimal valid AppRunState. */
function makeState(overrides: Partial<AppRunState> = {}): AppRunState {
  return {
    running: false,
    pid: 0,
    port: null,
    debugReady: false,
    updatedAt: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppRunStateCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // updateState()
  // -------------------------------------------------------------------------

  describe('updateState()', () => {
    it('sets initial state when prev is null', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234, port: 9222 });

      const state = coord.getState('workbuddy');
      expect(state).not.toBeNull();
      expect(state?.running).toBe(true);
      expect(state?.pid).toBe(1234);
      expect(state?.port).toBe(9222);
      expect(state?.debugReady).toBe(false);
      coord.dispose();
    });

    it('updates existing app state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 100 });
      coord.updateState('workbuddy', { running: true, pid: 200 });

      const state = coord.getState('workbuddy');
      expect(state?.pid).toBe(200);
      coord.dispose();
    });

    it('skips emit when all runtime fields are unchanged', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 100, port: 9222, debugReady: true });

      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      // Update with same runtime fields (only updatedAt differs)
      coord.updateState('workbuddy', { running: true, pid: 100, port: 9222, debugReady: true });

      expect(events).toHaveLength(0);
      coord.dispose();
    });

    it('triggers emit when any field changes', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 100 });

      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: false });

      expect(events).toHaveLength(1);
      expect(events[0].appId).toBe('workbuddy');
      expect(events[0].state.running).toBe(false);
      expect(events[0].prevState?.running).toBe(true);
      coord.dispose();
    });

    it('performs partial merge — omitted fields retain previous value', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234, port: 9222 });

      // Only update pid; running and port should persist
      coord.updateState('workbuddy', { pid: 5678 });

      const state = coord.getState('workbuddy');
      expect(state?.running).toBe(true);
      expect(state?.pid).toBe(5678);
      expect(state?.port).toBe(9222);
      expect(state?.debugReady).toBe(false);
      coord.dispose();
    });

    it('sets updatedAt to current time on each update', () => {
      const coord = createCoordinator();

      vi.setSystemTime(1000);
      coord.updateState('workbuddy', { running: true });
      expect(coord.getState('workbuddy')?.updatedAt).toBe(1000);

      vi.setSystemTime(2000);
      coord.updateState('workbuddy', { pid: 42 });
      expect(coord.getState('workbuddy')?.updatedAt).toBe(2000);
      coord.dispose();
    });

    it('updates updatedAt even when runtime fields are unchanged', () => {
      const coord = createCoordinator();

      vi.setSystemTime(1000);
      coord.updateState('workbuddy', { running: true, pid: 100 });
      expect(coord.getState('workbuddy')?.updatedAt).toBe(1000);

      vi.setSystemTime(2000);
      coord.updateState('workbuddy', { running: true, pid: 100 });
      // Even though emit is skipped, updatedAt is refreshed on the stored object
      expect(coord.getState('workbuddy')?.updatedAt).toBe(2000);
      coord.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // onStatusChange()
  // -------------------------------------------------------------------------

  describe('onStatusChange()', () => {
    it('subscribes and returns an unsubscribe function', () => {
      const coord = createCoordinator();
      const events: StatusChangeEvent[] = [];
      const unsub = coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });
      expect(events).toHaveLength(1);

      unsub();
      coord.updateState('workbuddy', { running: false });
      // Still 1 — unsubscribed
      expect(events).toHaveLength(1);
      coord.dispose();
    });

    it('does not receive events after unsubscribe', () => {
      const coord = createCoordinator();
      const events: StatusChangeEvent[] = [];
      const unsub = coord.onStatusChange((e) => events.push(e));

      coord.updateState('app-a', { running: true });
      unsub();
      coord.updateState('app-b', { running: true });

      // Only app-A event captured before unsubscribe
      expect(events).toHaveLength(1);
      expect(events[0].appId).toBe('app-a');
      coord.dispose();
    });

    it('delivers events to multiple subscribers', () => {
      const coord = createCoordinator();
      const eventsA: StatusChangeEvent[] = [];
      const eventsB: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => eventsA.push(e));
      coord.onStatusChange((e) => eventsB.push(e));

      coord.updateState('workbuddy', { running: true });

      expect(eventsA).toHaveLength(1);
      expect(eventsB).toHaveLength(1);
      expect(eventsA[0].appId).toBe('workbuddy');
      expect(eventsB[0].appId).toBe('workbuddy');
      coord.dispose();
    });

    it('provides prevState=null on first update for an app', () => {
      const coord = createCoordinator();
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });

      expect(events[0].prevState).toBeNull();
      coord.dispose();
    });

    it('provides prevState with previous values on subsequent updates', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 100 });

      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { pid: 200 });

      expect(events[0].prevState).not.toBeNull();
      expect(events[0].prevState?.pid).toBe(100);
      expect(events[0].prevState?.running).toBe(true);
      coord.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getState()
  // -------------------------------------------------------------------------

  describe('getState()', () => {
    it('returns a copy of the state for an existing app', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234 });

      const state = coord.getState('workbuddy');
      expect(state).toEqual(expect.objectContaining({ running: true, pid: 1234 }));
      coord.dispose();
    });

    it('returns null for an unknown app', () => {
      const coord = createCoordinator();
      expect(coord.getState('nonexistent')).toBeNull();
      coord.dispose();
    });

    it('returns a shallow copy — mutating result does not affect internal state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234 });

      const state = coord.getState('workbuddy');
      state!.pid = 9999;

      // Internal state unchanged
      expect(coord.getState('workbuddy')?.pid).toBe(1234);
      coord.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getSnapshot()
  // -------------------------------------------------------------------------

  describe('getSnapshot()', () => {
    it('returns a deep copy of all states', () => {
      const coord = createCoordinator();
      coord.updateState('app-a', { running: true, pid: 100 });
      coord.updateState('app-b', { running: false, pid: 200 });

      const snapshot = coord.getSnapshot();
      expect(snapshot.size).toBe(2);
      expect(snapshot.get('app-a')?.pid).toBe(100);
      expect(snapshot.get('app-b')?.pid).toBe(200);
      coord.dispose();
    });

    it('returns an empty Map for a fresh coordinator', () => {
      const coord = createCoordinator();
      const snapshot = coord.getSnapshot();
      expect(snapshot.size).toBe(0);
      coord.dispose();
    });

    it('returns a deep copy — mutating the Map or values does not affect internal state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234 });

      const snapshot = coord.getSnapshot();

      // Mutate the returned Map
      snapshot.delete('workbuddy');
      snapshot.set('injected', makeState({ running: true }));

      // Mutate a value in the returned Map
      const state = snapshot.get('workbuddy');
      if (state) state.pid = 9999;

      // Internal state unchanged
      expect(coord.getState('workbuddy')?.pid).toBe(1234);
      expect(coord.getState('injected')).toBeNull();
      coord.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // removeState()
  // -------------------------------------------------------------------------

  describe('removeState()', () => {
    it('removes an existing app state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 1234 });

      coord.removeState('workbuddy');

      expect(coord.getState('workbuddy')).toBeNull();
      coord.dispose();
    });

    it('clears idle timer when removing state', () => {
      const coord = createCoordinator({ idleTTL: 5000 });
      coord.onStatusChange(() => {});
      coord.updateState('workbuddy', { running: true, pid: 1234 });

      coord.removeState('workbuddy');

      // Advance past the TTL — no event should fire
      vi.advanceTimersByTime(10_000);

      // The app was removed; its running state should not have been changed to false
      expect(coord.getState('workbuddy')).toBeNull();
      coord.dispose();
    });

    it('is a no-op for non-existent app', () => {
      const coord = createCoordinator();
      expect(() => coord.removeState('nonexistent')).not.toThrow();
      coord.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // dispose()
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('clears all state', () => {
      const coord = createCoordinator();
      coord.updateState('app-a', { running: true });
      coord.updateState('app-b', { running: false });

      coord.dispose();

      expect(coord.getState('app-a')).toBeNull();
      expect(coord.getState('app-b')).toBeNull();
      expect(coord.getSnapshot().size).toBe(0);
    });

    it('clears all timers', () => {
      const coord = createCoordinator({ idleTTL: 5000 });

      coord.updateState('app-a', { running: true });
      coord.updateState('app-b', { running: true });

      // Subscribe only to capture post-dispose events
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.dispose();

      // Advance past TTL — no idle-timeout events should fire
      vi.advanceTimersByTime(10_000);
      expect(events).toHaveLength(0);
    });

    it('removes all listeners', () => {
      const coord = createCoordinator();
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });
      expect(events).toHaveLength(1);

      coord.dispose();
      coord.updateState('workbuddy', { running: false });

      // No new events after dispose
      expect(events).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // idle TTL behavior
  // -------------------------------------------------------------------------

  describe('idle TTL', () => {
    it('does not start a timer when idleTTL is 0 (default)', () => {
      const coord = createCoordinator();

      coord.updateState('workbuddy', { running: true });

      // Subscribe only to capture post-setup idle events
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      // Advance far beyond any default timeout
      vi.advanceTimersByTime(60_000);

      // No auto-running=false event (idleTTL=0 means disabled)
      expect(events).toHaveLength(0);
      expect(coord.getState('workbuddy')?.running).toBe(true);
      coord.dispose();
    });

    it('starts a timer when custom idleTTL is set', () => {
      const coord = createCoordinator({ idleTTL: 5000 });
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });

      // Not yet expired
      vi.advanceTimersByTime(4999);
      const filteredBefore = events.filter(
        (e) => e.appId === 'workbuddy' && e.state.running === false,
      );
      expect(filteredBefore).toHaveLength(0);

      // Expire
      vi.advanceTimersByTime(1);
      const filteredAfter = events.filter(
        (e) => e.appId === 'workbuddy' && e.state.running === false,
      );
      expect(filteredAfter).toHaveLength(1);
      expect(coord.getState('workbuddy')?.running).toBe(false);
      coord.dispose();
    });

    it('auto-marks running=false after TTL expires', () => {
      const coord = createCoordinator({ idleTTL: 3000 });
      coord.updateState('workbuddy', { running: true, debugReady: true });

      vi.advanceTimersByTime(3000);

      const state = coord.getState('workbuddy');
      expect(state?.running).toBe(false);
      expect(state?.debugReady).toBe(false);
      coord.dispose();
    });

    it('resets timer on subsequent updateState calls', () => {
      const coord = createCoordinator({ idleTTL: 5000 });
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });

      // Advance 4s (1s before TTL)
      vi.advanceTimersByTime(4000);

      // Reset timer by updating again
      coord.updateState('workbuddy', { running: true, pid: 999 });

      // Advance another 4s (original timer would have fired, but reset prevents it)
      vi.advanceTimersByTime(4000);

      const idleEvents = events.filter((e) => e.appId === 'workbuddy' && e.state.running === false);
      expect(idleEvents).toHaveLength(0);
      expect(coord.getState('workbuddy')?.running).toBe(true);
      coord.dispose();
    });

    it('clears timer when running=false is set manually', () => {
      const coord = createCoordinator({ idleTTL: 5000 });
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: true });
      coord.updateState('workbuddy', { running: false });

      // Advance past TTL — no additional events
      vi.advanceTimersByTime(10_000);

      // Only the manual running=false event, no idle-timeout event
      const idleEvents = events.filter((e) => e.appId === 'workbuddy' && e.state.running === false);
      expect(idleEvents).toHaveLength(1);
      coord.dispose();
    });

    it('clears timer on dispose even if still running', () => {
      const coord = createCoordinator({ idleTTL: 5000 });
      coord.updateState('workbuddy', { running: true });

      coord.dispose();

      // Timers cleared by dispose — advancing should cause nothing
      vi.advanceTimersByTime(10_000);
      // No crash, no state change (disposed)
      expect(coord.getState('workbuddy')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Log sink
  // ---------------------------------------------------------------------------

  describe('log sink', () => {
    it('calls log on removeState', () => {
      const log = vi.fn();
      const coord = createCoordinator({ log });
      coord.updateState('workbuddy', { running: true });
      coord.removeState('workbuddy');

      expect(log).toHaveBeenCalledWith('[AppRunStateCoordinator] removed: workbuddy');
      coord.dispose();
    });

    it('calls log on dispose', () => {
      const log = vi.fn();
      const coord = createCoordinator({ log });
      coord.dispose();

      expect(log).toHaveBeenCalledWith('[AppRunStateCoordinator] disposed');
    });

    it('calls log on idle timeout', () => {
      const log = vi.fn();
      const coord = createCoordinator({ idleTTL: 1000, log });
      coord.updateState('workbuddy', { running: true });

      vi.advanceTimersByTime(1000);

      expect(log).toHaveBeenCalledWith('[AppRunStateCoordinator] idle timeout: workbuddy');
      coord.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles multiple apps independently', () => {
      const coord = createCoordinator();

      coord.updateState('app-a', { running: true, pid: 100 });
      coord.updateState('app-b', { running: false, pid: 200 });
      coord.updateState('app-c', { running: true, pid: 300, port: 9222 });

      expect(coord.getState('app-a')?.pid).toBe(100);
      expect(coord.getState('app-b')?.running).toBe(false);
      expect(coord.getState('app-c')?.port).toBe(9222);

      coord.removeState('app-b');
      expect(coord.getState('app-b')).toBeNull();
      expect(coord.getState('app-a')).not.toBeNull();
      coord.dispose();
    });

    it('handles rapid successive updates to the same app', () => {
      const coord = createCoordinator();
      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      for (let i = 1; i <= 5; i++) {
        coord.updateState('workbuddy', { running: true, pid: i * 100 });
      }

      expect(events).toHaveLength(5);
      expect(coord.getState('app-a')).toBeNull();
      expect(coord.getState('workbuddy')?.pid).toBe(500);
      coord.dispose();
    });

    it('handles update after remove as fresh state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, pid: 100 });
      coord.removeState('workbuddy');

      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { running: false, pid: 0 });

      expect(events).toHaveLength(1);
      expect(events[0].prevState).toBeNull(); // treated as new
      expect(events[0].state.running).toBe(false);
      coord.dispose();
    });

    it('handles port changing from one number to another', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', { running: true, port: 9222 });

      const events: StatusChangeEvent[] = [];
      coord.onStatusChange((e) => events.push(e));

      coord.updateState('workbuddy', { port: 9223 });

      expect(events).toHaveLength(1);
      expect(events[0].state.port).toBe(9223);
      expect(events[0].prevState?.port).toBe(9222);
      coord.dispose();
    });

    it('uses defaults for fields not provided and no previous state', () => {
      const coord = createCoordinator();
      coord.updateState('workbuddy', {});

      const state = coord.getState('workbuddy');
      expect(state?.running).toBe(false);
      expect(state?.pid).toBe(0);
      expect(state?.port).toBeNull();
      expect(state?.debugReady).toBe(false);
      coord.dispose();
    });

    it('singleton returns shared instance', async () => {
      // Use dynamic import to test singleton without leaking state
      const mod = await import('./app-run-state-coordinator');
      const a = mod.getAppRunStateCoordinator();
      const b = mod.getAppRunStateCoordinator();
      expect(a).toBe(b);
    });
  });
});
