// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for wallpaper-self-heal.ts
 *
 * Covers: failure threshold triggering, cooldown window enforcement,
 * concurrent self-heal guard, counter reset on success, and lifecycle cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock console.warn to suppress self-heal trigger logs during tests
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

// All module state mutations need cleanup between tests
async function importSelfHeal() {
  return import('./wallpaper-self-heal');
}

describe('wallpaper-self-heal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module state by re-importing with cache bust
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordInjectionSuccess', () => {
    it('resets consecutive failure counter to zero', async () => {
      const mod = await importSelfHeal();

      // Build up some failures
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      // Success should reset
      mod.recordInjectionSuccess('traework');

      // Two more failures should NOT trigger (must reach 3 again)
      const thunk1 = await mod.recordInjectionFailure('traework');
      expect(thunk1).toBeNull();
      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).toBeNull();
    });

    it('clears cooldown timestamp so next failure streak can trigger immediately', async () => {
      const mod = await importSelfHeal();
      const mockCb = vi.fn().mockResolvedValue(() => Promise.resolve());
      mod.setSelfHealCallback(mockCb);

      // Trigger self-heal once (3 failures)
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      expect(mockCb).toHaveBeenCalledTimes(1);

      // Success clears cooldown
      mod.recordInjectionSuccess('traework');

      // Next 3 failures should trigger again (cooldown cleared)
      mockCb.mockClear();
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk = await mod.recordInjectionFailure('traework');
      expect(thunk).not.toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordInjectionFailure threshold logic', () => {
    it('does NOT trigger self-heal before reaching FAILURE_THRESHOLD (3)', async () => {
      const mod = await importSelfHeal();
      const mockCb = vi.fn().mockResolvedValue(() => Promise.resolve());
      mod.setSelfHealCallback(mockCb);

      const thunk1 = await mod.recordInjectionFailure('traework');
      expect(thunk1).toBeNull();
      expect(mockCb).not.toHaveBeenCalled();

      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).toBeNull();
      expect(mockCb).not.toHaveBeenCalled();
    });

    it('triggers self-heal on exactly the 3rd consecutive failure', async () => {
      const mod = await importSelfHeal();
      const mockCb = vi.fn().mockResolvedValue(() => Promise.resolve());
      mod.setSelfHealCallback(mockCb);

      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk = await mod.recordInjectionFailure('traework');

      expect(thunk).not.toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1);
      expect(mockCb).toHaveBeenCalledWith('traework');
    });

    it('does NOT trigger self-heal when callback is not set', async () => {
      const mod = await importSelfHeal();
      // No setSelfHealCallback call

      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      const thunk = await mod.recordInjectionFailure('traework');

      expect(thunk).toBeNull();
    });

    it('resets counter after trigger so subsequent failures must build fresh streak', async () => {
      const mod = await importSelfHeal();
      let callCount = 0;
      mod.setSelfHealCallback(() => {
        callCount++;
        return Promise.resolve(() => Promise.resolve());
      });

      // First trigger at 3 failures
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');
      const thunk1 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk1).not.toBeNull();
      expect(callCount).toBe(1);

      // Next 2 failures should NOT trigger (counter was reset to 0)
      const thunk2 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk2).toBeNull();
      expect(callCount).toBe(1);
      const thunk3 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk3).toBeNull();
      expect(callCount).toBe(1);

      // 3rd failure after reset triggers again
      const thunk4 = await mod.recordInjectionFailure('qoderwork');
      expect(thunk4).not.toBeNull();
      expect(callCount).toBe(2);
    });
  });

  describe('cooldown window enforcement', () => {
    it('suppresses re-trigger within the 5-minute cooldown window', async () => {
      const mod = await importSelfHeal();
      const originalDateNow = Date.now;
      let mockTime = 1_000_000_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const mockCb = vi.fn().mockResolvedValue(() => Promise.resolve());
      mod.setSelfHealCallback(mockCb);

      // First trigger
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk1 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk1).not.toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1);

      // Advance time by 2 minutes (within 5-min cooldown)
      mockTime += 2 * 60 * 1000;

      // Build new failure streak — should be suppressed by cooldown
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk2 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk2).toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1); // Still 1, not 2

      // Advance past cooldown (total 6 minutes from first trigger)
      mockTime += 4 * 60 * 1000;

      // New streak should now trigger
      mockCb.mockClear();
      await mod.recordInjectionFailure('workbuddy');
      await mod.recordInjectionFailure('workbuddy');
      const thunk3 = await mod.recordInjectionFailure('workbuddy');
      expect(thunk3).not.toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1);

      Date.now = originalDateNow;
    });
  });

  describe('concurrent self-heal guard', () => {
    it('prevents concurrent self-heal for the same agent', async () => {
      const mod = await importSelfHeal();
      let resolveFirst: (() => void) | null = null;
      const mockCb = vi.fn().mockImplementation(
        () =>
          new Promise<() => Promise<void>>((resolve) => {
            const thunk = async () => {
              return new Promise<void>((r) => {
                resolveFirst = r;
              });
            };
            resolve(() => thunk());
          }),
      );
      mod.setSelfHealCallback(mockCb);

      // First trigger — callback returns a thunk that blocks
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      const thunk1 = await mod.recordInjectionFailure('doubao');
      expect(thunk1).not.toBeNull();

      // While first self-heal is pending, more failures should be suppressed
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      // The callback was only called once (concurrent guard blocks re-entry)
      expect(mockCb).toHaveBeenCalledTimes(1);

      // Resolve the pending self-heal
      resolveFirst?.();
      await thunk1?.();
      await new Promise((r) => setTimeout(r, 0)); // Let async cleanup run

      // After thunk settles, new failures can re-trigger
      mockCb.mockClear();
      await mod.recordInjectionFailure('doubao');
      await mod.recordInjectionFailure('doubao');
      const thunk2 = await mod.recordInjectionFailure('doubao');
      expect(thunk2).not.toBeNull();
      expect(mockCb).toHaveBeenCalledTimes(1);
    });

    it('tracks self-healing agents via getSelfHealingAgentsSize', async () => {
      const mod = await importSelfHeal();
      expect(mod.getSelfHealingAgentsSize()).toBe(0);

      let resolveThunk: (() => void) | null = null;
      mod.setSelfHealCallback(
        () =>
          new Promise((resolve) => {
            resolve(
              () =>
                new Promise<void>((r) => {
                  resolveThunk = r;
                }),
            );
          }),
      );

      await mod.recordInjectionFailure('codex');
      await mod.recordInjectionFailure('codex');
      const thunk = await mod.recordInjectionFailure('codex');

      expect(mod.getSelfHealingAgentsSize()).toBe(1);

      // Invoke the thunk — it will block
      const invokePromise = thunk?.();
      expect(mod.getSelfHealingAgentsSize()).toBe(1);

      // Resolve
      resolveThunk?.();
      await invokePromise;
      await new Promise((r) => setTimeout(r, 0));

      expect(mod.getSelfHealingAgentsSize()).toBe(0);
    });
  });

  describe('callback error handling', () => {
    it('returns null when callback throws, and releases guard', async () => {
      const mod = await importSelfHeal();
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
      const mod = await importSelfHeal();
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
      const mod = await importSelfHeal();

      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');

      mod.cleanupSelfHealForAgent('traework');

      // traework state cleared — 3 new failures needed to trigger
      // qoderwork still has 2 failures recorded
      mod.setSelfHealCallback(() => Promise.resolve(() => Promise.resolve()));

      // traework: needs 3 failures
      const t1 = await mod.recordInjectionFailure('traework');
      expect(t1).toBeNull(); // state was cleared
    });

    it('disposeSelfHealState clears all module state', async () => {
      const mod = await importSelfHeal();
      mod.setSelfHealCallback(() => Promise.resolve(() => Promise.resolve()));

      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      mod.disposeSelfHealState();

      expect(mod.getSelfHealingAgentsSize()).toBe(0);

      // After dispose, 2 more failures should NOT trigger (state cleared)
      const thunk = await mod.recordInjectionFailure('traework');
      expect(thunk).toBeNull();
    });
  });

  describe('multi-agent isolation', () => {
    it('tracks failures independently per agent', async () => {
      const mod = await importSelfHeal();
      mod.setSelfHealCallback(() => Promise.resolve(() => Promise.resolve()));

      // traework: 2 failures (not enough)
      await mod.recordInjectionFailure('traework');
      await mod.recordInjectionFailure('traework');

      // qoderwork: 3 failures (triggers)
      await mod.recordInjectionFailure('qoderwork');
      await mod.recordInjectionFailure('qoderwork');
      const thunk = await mod.recordInjectionFailure('qoderwork');

      expect(thunk).not.toBeNull();

      // traework still has its 2 failures counted
      // One more should trigger
      const thunk2 = await mod.recordInjectionFailure('traework');
      expect(thunk2).not.toBeNull();
    });
  });
});
