// SPDX-License-Identifier: MIT
//
// # agent-state-engine.test.ts — unit tests for the Agent State Awareness Engine.
//
// Validates:
//   - Session lifecycle: addSession, removeSession, getSession, getAllSessions
//   - State transitions: updateState, state priority resolution
//   - Active session filtering: getActiveSessions
//   - Event system: on, off, sessionAdd / stateChange / sessionRemove events
//   - Edge cases: empty engine, unknown session, state reversion, idempotency

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_STATES, AgentStateEngine } from '../../scripts/lib/agent-state-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEngine(): AgentStateEngine {
  return new AgentStateEngine();
}

// ---------------------------------------------------------------------------
// 1. AGENT_STATES constant
// ---------------------------------------------------------------------------

describe('AGENT_STATES', () => {
  it('contains exactly six states in correct order', () => {
    expect(AGENT_STATES).toEqual(['idle', 'thinking', 'working', 'error', 'completed', 'sleeping']);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(AGENT_STATES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. addSession
// ---------------------------------------------------------------------------

describe('addSession', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('creates a session with default idle state and returns its id', () => {
    const id = engine.addSession('traework');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const session = engine.getSession(id);
    expect(session).toBeDefined();
    expect(session?.agent).toBe('traework');
    expect(session?.state).toBe('idle');
    expect(session?.startTime).toBeTypeOf('number');
    expect(session?.lastUpdate).toBeTypeOf('number');
  });

  it('assigns unique ids to multiple sessions', () => {
    const id1 = engine.addSession('traework');
    const id2 = engine.addSession('codex');
    const id3 = engine.addSession('doubao');
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(engine.getAllSessions()).toHaveLength(3);
  });

  it('emits a sessionAdd event with the new session', () => {
    const handler = vi.fn();
    engine.on('sessionAdd', handler);

    const id = engine.addSession('workbuddy');
    const session = engine.getSession(id);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(session);
  });

  it('supports multiple agents with independent sessions', () => {
    const t1 = engine.addSession('traework');
    const t2 = engine.addSession('traework');

    expect(t1).not.toBe(t2);
    expect(engine.getAllSessions()).toHaveLength(2);
    expect(engine.getSession(t1)?.agent).toBe('traework');
    expect(engine.getSession(t2)?.agent).toBe('traework');
  });
});

// ---------------------------------------------------------------------------
// 3. updateState
// ---------------------------------------------------------------------------

describe('updateState', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('updates the session state from idle to working', () => {
    const id = engine.addSession('traework');
    engine.updateState(id, 'working');
    expect(engine.getSession(id)?.state).toBe('working');
  });

  it('throws when updating a non-existent session', () => {
    expect(() => engine.updateState('nonexistent', 'working')).toThrow(
      /session "nonexistent" not found/,
    );
  });

  it('updates lastUpdate timestamp on state change', () => {
    const id = engine.addSession('traework');
    const before = engine.getSession(id)!.lastUpdate;

    // Advance time enough to be detectable
    const result = vi.spyOn(Date, 'now').mockReturnValueOnce(before + 100);

    engine.updateState(id, 'thinking');
    expect(engine.getSession(id)!.lastUpdate).toBe(before + 100);

    result.mockRestore();
  });

  it('emits a stateChange event with session, prevState, and newState', () => {
    const id = engine.addSession('traework');
    const handler = vi.fn();
    engine.on('stateChange', handler);

    engine.updateState(id, 'thinking');

    expect(handler).toHaveBeenCalledTimes(1);
    const payload = handler.mock.calls[0][0];
    expect(payload.session.id).toBe(id);
    expect(payload.prevState).toBe('idle');
    expect(payload.newState).toBe('thinking');
  });

  it('does not emit stateChange when setting same state (heartbeats lastUpdate)', () => {
    const id = engine.addSession('traework');
    const handler = vi.fn();
    engine.on('stateChange', handler);

    engine.updateState(id, 'idle'); // already idle
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports full state transition sequence', () => {
    const id = engine.addSession('traework');
    const states = ['thinking', 'working', 'completed', 'idle'] as const;

    for (const state of states) {
      engine.updateState(id, state);
      expect(engine.getSession(id)?.state).toBe(state);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. getSession / getAllSessions
// ---------------------------------------------------------------------------

describe('getSession / getAllSessions', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('returns undefined for unknown session id', () => {
    expect(engine.getSession('does-not-exist')).toBeUndefined();
  });

  it('returns all added sessions in insertion order', () => {
    const id1 = engine.addSession('traework');
    const id2 = engine.addSession('codex');
    const all = engine.getAllSessions();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe(id1);
    expect(all[1].id).toBe(id2);
  });

  it('returns empty array when no sessions exist', () => {
    expect(engine.getAllSessions()).toEqual([]);
  });

  it('session object includes all required fields', () => {
    const id = engine.addSession('traework');
    const session = engine.getSession(id);
    expect(session).toHaveProperty('id');
    expect(session).toHaveProperty('agent');
    expect(session).toHaveProperty('state');
    expect(session).toHaveProperty('startTime');
    expect(session).toHaveProperty('lastUpdate');
    expect(session).toHaveProperty('metadata');
    expect(session?.metadata).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 5. getActiveSessions
// ---------------------------------------------------------------------------

describe('getActiveSessions', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('excludes idle and sleeping sessions', () => {
    const idle = engine.addSession('traework');
    const sleeping = engine.addSession('codex');
    const working = engine.addSession('doubao');

    engine.updateState(idle, 'idle');
    engine.updateState(sleeping, 'sleeping');
    engine.updateState(working, 'working');

    const active = engine.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(working);
  });

  it('includes thinking, working, error, and completed as active', () => {
    const thinking = engine.addSession('traework');
    const working = engine.addSession('codex');
    const error = engine.addSession('doubao');
    const completed = engine.addSession('qoderwork');

    engine.updateState(thinking, 'thinking');
    engine.updateState(working, 'working');
    engine.updateState(error, 'error');
    engine.updateState(completed, 'completed');

    const active = engine.getActiveSessions();
    expect(active).toHaveLength(4);
    const ids = active.map((s) => s.id);
    expect(ids).toContain(thinking);
    expect(ids).toContain(working);
    expect(ids).toContain(error);
    expect(ids).toContain(completed);
  });

  it('returns empty array when no sessions exist', () => {
    expect(engine.getActiveSessions()).toEqual([]);
  });

  it('returns empty array when all sessions are idle', () => {
    const id = engine.addSession('traework');
    engine.updateState(id, 'idle');
    expect(engine.getActiveSessions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. resolvePriorityState
// ---------------------------------------------------------------------------

describe('resolvePriorityState', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('returns idle when no sessions exist', () => {
    expect(engine.resolvePriorityState()).toBe('idle');
  });

  it('returns the state of a single session', () => {
    const id = engine.addSession('traework');
    engine.updateState(id, 'working');
    expect(engine.resolvePriorityState()).toBe('working');
  });

  it('resolves error as highest priority', () => {
    const working = engine.addSession('traework');
    const error = engine.addSession('codex');

    engine.updateState(working, 'working');
    engine.updateState(error, 'error');

    expect(engine.resolvePriorityState()).toBe('error');
  });

  it('resolves working over thinking', () => {
    const thinking = engine.addSession('traework');
    const working = engine.addSession('codex');

    engine.updateState(thinking, 'thinking');
    engine.updateState(working, 'working');

    expect(engine.resolvePriorityState()).toBe('working');
  });

  it('resolves thinking over completed', () => {
    const completed = engine.addSession('traework');
    const thinking = engine.addSession('codex');

    engine.updateState(completed, 'completed');
    engine.updateState(thinking, 'thinking');

    expect(engine.resolvePriorityState()).toBe('thinking');
  });

  it('resolves completed over idle', () => {
    const idle = engine.addSession('traework');
    const completed = engine.addSession('codex');

    engine.updateState(idle, 'idle');
    engine.updateState(completed, 'completed');

    expect(engine.resolvePriorityState()).toBe('completed');
  });

  it('resolves idle over sleeping', () => {
    const sleeping = engine.addSession('traework');
    const idle = engine.addSession('codex');

    engine.updateState(sleeping, 'sleeping');
    engine.updateState(idle, 'idle');

    expect(engine.resolvePriorityState()).toBe('idle');
  });

  it('resolves correctly with many sessions at different priorities', () => {
    const idle = engine.addSession('a');
    const sleeping = engine.addSession('b');
    const completed = engine.addSession('c');
    const thinking = engine.addSession('d');
    const working = engine.addSession('e');

    engine.updateState(idle, 'idle');
    engine.updateState(sleeping, 'sleeping');
    engine.updateState(completed, 'completed');
    engine.updateState(thinking, 'thinking');
    engine.updateState(working, 'working');

    expect(engine.resolvePriorityState()).toBe('working');
  });

  it('priority decreases when highest-priority session transitions away', () => {
    const error = engine.addSession('a');
    const working = engine.addSession('b');

    engine.updateState(error, 'error');
    engine.updateState(working, 'working');
    expect(engine.resolvePriorityState()).toBe('error');

    // Error session recovers to idle
    engine.updateState(error, 'idle');
    expect(engine.resolvePriorityState()).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// 7. removeSession
// ---------------------------------------------------------------------------

describe('removeSession', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('removes an existing session', () => {
    const id = engine.addSession('traework');
    expect(engine.getAllSessions()).toHaveLength(1);

    engine.removeSession(id);
    expect(engine.getSession(id)).toBeUndefined();
    expect(engine.getAllSessions()).toHaveLength(0);
  });

  it('is a silent no-op for non-existent session', () => {
    expect(() => engine.removeSession('nonexistent')).not.toThrow();
    expect(engine.getAllSessions()).toHaveLength(0);
  });

  it('emits a sessionRemove event with the removed session', () => {
    const id = engine.addSession('traework');
    const handler = vi.fn();
    engine.on('sessionRemove', handler);

    const session = engine.getSession(id);
    engine.removeSession(id);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(session);
  });

  it('does not emit sessionRemove for non-existent session', () => {
    const handler = vi.fn();
    engine.on('sessionRemove', handler);
    engine.removeSession('nonexistent');
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes only the targeted session when multiple exist', () => {
    const id1 = engine.addSession('traework');
    const id2 = engine.addSession('codex');

    engine.removeSession(id1);

    expect(engine.getSession(id1)).toBeUndefined();
    expect(engine.getSession(id2)).toBeDefined();
    expect(engine.getAllSessions()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Event system
// ---------------------------------------------------------------------------

describe('event system', () => {
  let engine: AgentStateEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('on() returns an unsubscribe function that removes the listener', () => {
    const handler = vi.fn();
    const unsubscribe = engine.on('stateChange', handler);

    const id = engine.addSession('traework');
    engine.updateState(id, 'thinking');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    engine.updateState(id, 'working');
    expect(handler).toHaveBeenCalledTimes(1); // no additional call
  });

  it('off() removes a specific listener without affecting others', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    engine.on('sessionAdd', handler1);
    engine.on('sessionAdd', handler2);

    engine.addSession('traework');
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    engine.off('sessionAdd', handler1);
    engine.addSession('codex');
    expect(handler1).toHaveBeenCalledTimes(1); // no additional
    expect(handler2).toHaveBeenCalledTimes(2);
  });

  it('supports multiple listeners on the same event', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    engine.on('sessionAdd', handler1);
    engine.on('sessionAdd', handler2);

    engine.addSession('traework');
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('listener errors do not break the engine or other listeners', () => {
    const badHandler = vi.fn(() => {
      throw new Error('listener crash');
    });
    const goodHandler = vi.fn();

    engine.on('sessionAdd', badHandler);
    engine.on('sessionAdd', goodHandler);

    expect(() => engine.addSession('traework')).not.toThrow();
    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('dispose() clears all listeners', () => {
    const handler = vi.fn();
    engine.on('sessionAdd', handler);

    engine.dispose();
    engine.addSession('traework');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. dispose and reuse
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('clears all sessions', () => {
    const engine = createEngine();
    engine.addSession('traework');
    engine.addSession('codex');
    expect(engine.getAllSessions()).toHaveLength(2);

    engine.dispose();
    expect(engine.getAllSessions()).toHaveLength(0);
  });

  it('engine can be reused after dispose', () => {
    const engine = createEngine();
    engine.addSession('traework');
    engine.dispose();

    const id = engine.addSession('codex');
    expect(engine.getSession(id)).toBeDefined();
    expect(engine.getAllSessions()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Multi-session tracking (integration scenarios)
// ---------------------------------------------------------------------------

describe('multi-session tracking', () => {
  it('tracks 6 concurrent agents with independent states', () => {
    const engine = createEngine();
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
    const ids: string[] = [];

    for (const agent of agents) {
      ids.push(engine.addSession(agent));
    }

    expect(engine.getAllSessions()).toHaveLength(6);

    // Set different states
    engine.updateState(ids[0], 'working');
    engine.updateState(ids[1], 'thinking');
    engine.updateState(ids[2], 'idle');
    engine.updateState(ids[3], 'error');
    engine.updateState(ids[4], 'completed');
    engine.updateState(ids[5], 'sleeping');

    // error should win as highest priority
    expect(engine.resolvePriorityState()).toBe('error');

    // working should be the only 'working' agent
    expect(engine.getSession(ids[0])?.state).toBe('working');

    // active sessions: all except idle and sleeping
    expect(engine.getActiveSessions()).toHaveLength(4);
  });

  it('handles session creation, update, and removal in rapid succession', () => {
    const engine = createEngine();

    const id1 = engine.addSession('a');
    const id2 = engine.addSession('b');
    const id3 = engine.addSession('c');

    engine.updateState(id1, 'working');
    engine.updateState(id2, 'error');
    engine.removeSession(id2);

    // error session removed, so working should be highest
    expect(engine.resolvePriorityState()).toBe('working');

    engine.updateState(id1, 'idle');
    engine.updateState(id3, 'thinking');
    expect(engine.resolvePriorityState()).toBe('thinking');
  });
});

// ---------------------------------------------------------------------------
// 11. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('session id is unique even when created in tight loop', () => {
    const engine = createEngine();
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      ids.add(engine.addSession('traework'));
    }

    expect(ids.size).toBe(100);
    expect(engine.getAllSessions()).toHaveLength(100);
  });

  it('state can revert from error back to working', () => {
    const engine = createEngine();
    const id = engine.addSession('traework');

    engine.updateState(id, 'error');
    expect(engine.resolvePriorityState()).toBe('error');

    engine.updateState(id, 'working');
    expect(engine.resolvePriorityState()).toBe('working');
    expect(engine.getSession(id)?.state).toBe('working');
  });

  it('startTime remains constant while lastUpdate changes', () => {
    const engine = createEngine();
    const id = engine.addSession('traework');
    const startTime = engine.getSession(id)!.startTime;

    engine.updateState(id, 'thinking');
    engine.updateState(id, 'working');

    expect(engine.getSession(id)!.startTime).toBe(startTime);
  });
});
