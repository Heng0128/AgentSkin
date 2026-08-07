// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../../adapters/base';
import type { AgentId } from '../../shared/types';
import { type AgentProcessEvent, AgentProcessMonitor } from './agent-process-monitor';

// ---------------------------------------------------------------------------
// Fakes & helpers
// ---------------------------------------------------------------------------

function makeAdapter(pids: number[]): ApplicationAdapter {
  return {
    findRunningPids: vi.fn().mockResolvedValue(pids),
  } as unknown as ApplicationAdapter;
}

/** The monitor's first tick is fire-and-forget; flush microtasks so it finishes. */
async function flushTick() {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentProcessMonitor', () => {
  let monitor: AgentProcessMonitor;
  let adapterMock: ReturnType<typeof makeAdapter>;
  let events: AgentProcessEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    adapterMock = makeAdapter([]);
    monitor = new AgentProcessMonitor({
      adapter: () => adapterMock,
      platform: 'win32',
      onEvent: (e) => events.push(e),
      pollIntervalMs: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts watching an agent and emits nothing on first idle state', async () => {
    adapterMock.findRunningPids = vi.fn().mockResolvedValue([]);
    monitor.start('traework' as AgentId);
    await flushTick();
    expect(events).toHaveLength(0);
    expect(monitor.watchedApps()).toContain('traework');
  });

  it('emits agent_started when PIDs appear on the next tick', async () => {
    adapterMock.findRunningPids = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([1234]);
    monitor.start('traework' as AgentId);
    await flushTick(); // immediate first tick → no emit

    await vi.advanceTimersByTimeAsync(1000); // next poll → PIDs appeared
    await flushTick();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'agent_started', agentId: 'traework', pids: [1234] });
  });

  it('emits agent_exited when PIDs vanish', async () => {
    adapterMock.findRunningPids = vi
      .fn()
      .mockResolvedValueOnce([1234]) // first immediate tick → running
      .mockResolvedValueOnce([1234]) // second tick (still running, no emit)
      .mockResolvedValue([]); // third tick → exited
    monitor.start('traework' as AgentId);
    await flushTick();

    await vi.advanceTimersByTimeAsync(1000);
    await flushTick();
    await vi.advanceTimersByTimeAsync(1000);
    await flushTick();

    const exitEvents = events.filter((e) => e.type === 'agent_exited');
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0]).toMatchObject({ agentId: 'traework', lastPids: [1234] });
  });

  it('emits agent_restarted when PIDs change while still alive', async () => {
    adapterMock.findRunningPids = vi
      .fn()
      .mockResolvedValueOnce([100]) // immediate → no prev → no emit
      .mockResolvedValueOnce([100]) // steady → no emit
      .mockResolvedValue([200]); // PID changed → restarted
    monitor.start('traework' as AgentId);
    await flushTick();

    await vi.advanceTimersByTimeAsync(1000);
    await flushTick();
    await vi.advanceTimersByTimeAsync(1000);
    await flushTick();

    const restartEvents = events.filter((e) => e.type === 'agent_restarted');
    expect(restartEvents).toHaveLength(1);
    expect(restartEvents[0]).toMatchObject({
      agentId: 'traework',
      prevPids: [100],
      nextPids: [200],
    });
  });

  it('stops cleanly and clears state', async () => {
    monitor.start('traework' as AgentId);
    await flushTick();
    monitor.stop('traework' as AgentId);
    expect(monitor.watchedApps()).toHaveLength(0);
    expect(monitor.snapshot('traework' as AgentId)).toBeNull();
  });

  it('stopAll clears every watcher', async () => {
    monitor.start('traework' as AgentId);
    monitor.start('workbuddy' as AgentId);
    expect(monitor.watchedApps()).toHaveLength(2);
    monitor.stopAll();
    expect(monitor.watchedApps()).toHaveLength(0);
  });

  it('gracefully emits monitor_error when adapter throws', async () => {
    adapterMock.findRunningPids = vi.fn().mockRejectedValue(new Error('access denied'));
    monitor.start('traework' as AgentId);
    await flushTick();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent_monitor_error');
  });

  it('bumping epoch kills stale timer (no double-emit)', async () => {
    // Same app starts twice — latest epoch wins, and since findRunningPids
    // returns [] throughout, no events fire regardless of ephemeral timers.
    monitor.start('traework' as AgentId);
    monitor.start('traework' as AgentId);
    await vi.advanceTimersByTimeAsync(5000);
    await flushTick();
    expect(events).toHaveLength(0);
  });
});
