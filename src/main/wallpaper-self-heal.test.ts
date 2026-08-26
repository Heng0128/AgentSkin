// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for wallpaper-self-heal.ts
 *
 * Covers: failure threshold triggering, cooldown window enforcement,
 * concurrent self-heal guard, counter reset on success, and lifecycle cleanup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('wallpaper-self-heal', () => {
  let mod: typeof import('./wallpaper-self-heal');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (!mod) {
      mod = await import('./wallpaper-self-heal');
    }
    // Reset ALL module-level state between tests
    mod.disposeSelfHealState();
    // Default callback: returns a resolved thunk
    mod.setSelfHealCallback(() => Promise.resolve(() => Promise.resolve()));
  });

  describe('recordInjectionSuccess', () => {
    it('resets consecutive failure counter to zero', async () => {
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      mod.recordInjectionSuccess('traework');

      // Two more failures should NOT trigger (must reach 3 again)
      const thunk1 = await mod.recordInjectionFailure('traework');
      expect(thunk1).toBeNull();
      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).toBeNull();
    });

    it('clears cooldown timestamp so next failure streak can trigger immediately', async () => {
      // First trigger (3 failures)
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk1 = await mod.recordInjectionFailure('traework');
      expect(thunk1).not.toBeNull();
      // Invoke the thunk to release the concurrent guard
      await thunk1?.();

      // Success clears cooldown AND resets counter
      mod.recordInjectionSuccess('traework');

      // Next 3 failures should trigger again (cooldown cleared)
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).not.toBeNull();
    });
  });

  describe('recordInjectionFailure threshold logic', () => {
    it('does NOT trigger self-heal before reaching FAILURE_THRESHOLD (3)', async () => {
      const thunk1 = await mod.recordInjectionFailure('traework');
      expect(thunk1).toBeNull();

      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).toBeNull();
    });

    it('triggers self-heal on exactly the 3rd consecutive failure', async () => {
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk = await mod.recordInjectionFailure('traework');

      expect(thunk).not.toBeNull();
    });

    it('does NOT trigger self-heal when callback declines (returns null)', async () => {
      mod.setSelfHealCallback(() => Promise.resolve(null));

      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk = await mod.recordInjectionFailure('traework');

      expect(thunk).toBeNull();
    });

    it('resets counter after trigger so subsequent failures must build fresh streak', async () => {
      // First trigger at 3 failures
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');
      const thunk1 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk1).not.toBeNull();
      // Invoke the thunk to release the guard
      await thunk1?.();

      // Next 2 failures should NOT trigger (counter was reset to 0)
      const thunk2 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk2).toBeNull();
      const thunk3 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk3).toBeNull();

      // Advance time past cooldown (6 minutes) to allow re-trigger
      const originalDateNow = Date.now;
      let mockTime = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => {
        mockTime += 6 * 60 * 1000; // Advance 6 minutes
        return mockTime;
      });

      // 3rd failure after reset triggers again (cooldown expired)
      const thunk4 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk4).not.toBeNull();

      // Restore
      Date.now = originalDateNow;
    });
  });

  describe('cooldown window enforcement', () => {
    it('suppresses re-trigger within the 5-minute cooldown window', async () => {
      // First trigger
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk1 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk1).not.toBeNull();
      // Invoke the thunk to release the guard
      await thunk1?.();

      // Immediately after trigger, new failures should be suppressed by cooldown
      // (cooldown is set to the time of the first trigger)
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk2 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk2).toBeNull();
    });

    it('allows re-trigger after cooldown expires', async () => {
      // Use a mutable time that we can advance
      let currentTime = 1_000_000_000_000;
      const originalDateNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First trigger
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk1 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk1).not.toBeNull();
      await thunk1?.();

      // Advance time past the 5-minute cooldown
      currentTime += 6 * 60 * 1000;

      // New streak should now trigger (cooldown expired)
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk2 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk2).not.toBeNull();

      // Restore
      Date.now = originalDateNow;
    });
  });

  describe('concurrent self-heal guard', () => {
    it('prevents concurrent self-heal for the same agent', async () => {
      // Use a mutable container to capture the resolver across async boundaries
      const resolver: { fn: (() => void) | null } = { fn: null };
      mod.setSelfHealCallback(() =>
        Promise.resolve(
          () =>
            new Promise<void>((r) => {
              resolver.fn = r;
            }),
        ),
      );

      // First trigger — callback returns a thunk that blocks
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      const thunk1 = await mod.recordInjectionFailure('doubao');
      expect(thunk1).not.toBeNull();

      // Start the thunk (it will block on the inner promise)
      const thunkPromise = thunk1!();

      // While first self-heal is pending, more failures should be suppressed
      // (concurrent guard blocks re-entry)
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      const concurrentThunk = await mod.recordInjectionFailure('doubao');
      expect(concurrentThunk).toBeNull();

      // Resolve the inner promise to complete the self-heal and release the guard
      resolver.fn?.();
      await thunkPromise;
      // Allow async cleanup to complete
      await new Promise((r) => setTimeout(r, 10));

      // After resolving, the guard is released
      expect(mod.getSelfHealingAgentsSize()).toBe(0);
    });

    it('tracks self-healing agents via getSelfHealingAgentsSize', async () => {
      expect(mod.getSelfHealingAgentsSize()).toBe(0);

      const resolver: { fn: (() => void) | null } = { fn: null };
      mod.setSelfHealCallback(() =>
        Promise.resolve(
          () =>
            new Promise<void>((r) => {
              resolver.fn = r;
            }),
        ),
      );

      await mod.recordInjectionFailure('codex');
      await mod.recordInjectionFailure('codex');
      const thunk = await mod.recordInjectionFailure('codex');

      // Self-heal is triggered but not yet invoked (guard is active)
      expect(mod.getSelfHealingAgentsSize()).toBe(1);

      // Invoke the thunk — it will block
      const invokePromise = thunk?.();
      expect(mod.getSelfHealingAgentsSize()).toBe(1);

      // Resolve the inner promise to complete the self-heal and release the guard
      resolver.fn?.();
      await invokePromise;
      await new Promise((r) => setTimeout(r, 10));

      expect(mod.getSelfHealingAgentsSize()).toBe(0);
    });
  });

  describe('callback error handling', () => {
    it('returns null when callback throws, and releases guard', async () => {
      mod.setSelfHealCallback(() => {
        throw new Error('callback error');
      });

      await mod.recordInjectionFailure('zcode');
      await mod.recordInjectionFailure('zcode');
      const thunk = await mod.recordInjectionFailure('zcode');

      expect(thunk).toBeNull();
      expect(mod.getSelfHealingAgentsSize()).toBe(0);
    });

    it('returns null when callback resolves to null (declines to act)', async () => {
      mod.setSelfHealCallback(() => Promise.resolve(null));

      await mod.recordInjectionFailure('zcode');
      await mod.recordInjectionFailure('zcode');
      const thunk = await mod.recordInjectionFailure('zcode');

      expect(thunk).toBeNull();
      expect(mod.getSelfHealingAgentsSize()).toBe(0);
    });
  });

  describe('lifecycle cleanup', () => {
    it('cleanupSelfHealForAgent removes state for one agent only', async () => {
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');

      mod.cleanupSelfHealForAgent('traework');

      const t1 = await mod.recordInjectionFailure('traework');
      expect(t1).toBeNull();
    });

    it('disposeSelfHealState clears all module state', async () => {
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      mod.disposeSelfHealState();

      expect(mod.getSelfHealingAgentsSize()).toBe(0);

      const thunk = await mod.recordInjectionFailure('traework');
      expect(thunk).toBeNull();
    });
  });

  describe('multi-agent isolation', () => {
    it('tracks failures independently per agent', async () => {
      // traework: 2 failures (not enough)
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      // qoderwork: 3 failures (triggers)
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');
      const thunk = await mod.recordInjectionFailure('qoderwork');

      expect(thunk).not.toBeNull();
      // Invoke to release guard
      await thunk?.();

      // traework still has its 2 failures counted, one more triggers
      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).not.toBeNull();
    });
  });
});
