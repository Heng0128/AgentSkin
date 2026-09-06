// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  type AgentWatchdogState,
  type WatchdogConfig,
  type WatchdogEventRecord,
  type WatchdogEventType,
  WatchdogRecoveryLevel,
} from '../../../src/shared/types/adapter-watchdog';

// ---------------------------------------------------------------------------
// Type contract tests — verify the exported types have the expected shape.
// These tests are compile-time checks (TypeScript) with runtime assertions
// for the const enum-like object.
// ---------------------------------------------------------------------------

describe('adapter-watchdog types — WatchdogConfig', () => {
  it('accepts a valid WatchdogConfig object', () => {
    const config: WatchdogConfig = {
      checkIntervalMs: 10_000,
      maxConsecutiveFailures: 3,
      enabled: true,
    };
    expect(config.checkIntervalMs).toBe(10_000);
    expect(config.maxConsecutiveFailures).toBe(3);
    expect(config.enabled).toBe(true);
  });

  it('allows partial config (all fields optional via Partial<>)', () => {
    const partial: Partial<WatchdogConfig> = { enabled: false };
    expect(partial.enabled).toBe(false);
  });
});

describe('adapter-watchdog types — AgentWatchdogState', () => {
  it('accepts a valid AgentWatchdogState object', () => {
    const state: AgentWatchdogState = {
      agentId: 'doubao',
      consecutiveFailures: 2,
      lastCheckAt: 1700000000000,
      lastRecoveryAt: 1700000005000,
      isPaused: false,
      currentLevel: 1,
    };
    expect(state.agentId).toBe('doubao');
    expect(state.consecutiveFailures).toBe(2);
    expect(state.currentLevel).toBe(1);
  });

  it('allows lastRecoveryAt to be null', () => {
    const state: AgentWatchdogState = {
      agentId: 'codex',
      consecutiveFailures: 0,
      lastCheckAt: 0,
      lastRecoveryAt: null,
      isPaused: false,
      currentLevel: 0,
    };
    expect(state.lastRecoveryAt).toBeNull();
  });

  it('restricts currentLevel to 0-4', () => {
    // Compile-time check: these are the only valid values
    const levels: AgentWatchdogState['currentLevel'][] = [0, 1, 2, 3, 4];
    expect(levels).toHaveLength(5);
  });
});

describe('adapter-watchdog types — WatchdogRecoveryLevel', () => {
  it('exports the expected const values', () => {
    expect(WatchdogRecoveryLevel.Normal).toBe(0);
    expect(WatchdogRecoveryLevel.Incremental).toBe(1);
    expect(WatchdogRecoveryLevel.FullReinject).toBe(2);
    expect(WatchdogRecoveryLevel.PageReload).toBe(3);
    expect(WatchdogRecoveryLevel.ProcessRestart).toBe(4);
  });

  it('is a frozen const object', () => {
    expect(Object.isFrozen(WatchdogRecoveryLevel)).toBe(true);
  });
});

describe('adapter-watchdog types — WatchdogEventType', () => {
  it('accepts all valid event type literals', () => {
    const types: WatchdogEventType[] = ['check', 'recovery', 'pause', 'resume', 'failure'];
    expect(types).toHaveLength(5);
  });
});

describe('adapter-watchdog types — WatchdogEventRecord', () => {
  it('accepts a check event (no extra fields)', () => {
    const event: WatchdogEventRecord = {
      type: 'check',
      agentId: 'doubao',
      timestamp: Date.now(),
    };
    expect(event.type).toBe('check');
    expect(event.level).toBeUndefined();
  });

  it('accepts a recovery event with level and success', () => {
    const event: WatchdogEventRecord = {
      type: 'recovery',
      agentId: 'doubao',
      timestamp: Date.now(),
      level: WatchdogRecoveryLevel.Incremental,
      success: true,
    };
    expect(event.level).toBe(1);
    expect(event.success).toBe(true);
  });

  it('accepts a failure event with error message', () => {
    const event: WatchdogEventRecord = {
      type: 'failure',
      agentId: 'codex',
      timestamp: Date.now(),
      error: 'All recovery levels exhausted',
    };
    expect(event.error).toBe('All recovery levels exhausted');
  });

  it('accepts pause and resume events', () => {
    const pauseEvent: WatchdogEventRecord = {
      type: 'pause',
      agentId: 'workbuddy',
      timestamp: Date.now(),
    };
    const resumeEvent: WatchdogEventRecord = {
      type: 'resume',
      agentId: 'workbuddy',
      timestamp: Date.now(),
    };
    expect(pauseEvent.type).toBe('pause');
    expect(resumeEvent.type).toBe('resume');
  });
});
