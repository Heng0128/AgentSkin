// SPDX-License-Identifier: MPL-2.0

/**
 * InjectionSessionManager unit tests.
 *
 * Covers: registration, query, handoff, release, concurrent safety,
 * and lifecycle transitions for the enhanced single-instance guardian.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  InjectionSessionManager,
} from '../../src/main/injection/injection-session-manager';
import type { AgentId } from '../../src/shared/types/agent';

describe('InjectionSessionManager', () => {
  let manager: InjectionSessionManager;

  beforeEach(() => {
    manager = new InjectionSessionManager();
  });

  // ── Test 1: registerSession creates active session ─────────────────────

  it('should register a new session and set state to ACTIVE', () => {
    const result = manager.registerSession('doubao', 9222, 'engine-strategy:apply:theme-1');

    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session!.adapterId).toBe('doubao');
    expect(result.session!.port).toBe(9222);
    expect(result.session!.state).toBe('ACTIVE');
    expect(result.session!.owner).toBe('engine-strategy:apply:theme-1');
    expect(result.session!.handoffCount).toBe(0);
    expect(result.session!.id).toMatch(/^sess-\d+-\d+$/);
  });

  // ── Test 2: getActiveSession returns the correct session ────────────────

  it('should retrieve the active session via getActiveSession', () => {
    manager.registerSession('traework', 9223, 'engine-strategy:apply:theme-a');

    const active = manager.getActiveSession('traework');

    expect(active).not.toBeNull();
    expect(active!.adapterId).toBe('traework');
    expect(active!.port).toBe(9223);
    expect(active!.owner).toBe('engine-strategy:apply:theme-a');
    expect(active!.state).toBe('ACTIVE');
  });

  // ── Test 3: getActiveSession returns null when no session ───────────────

  it('should return null from getActiveSession when no session exists', () => {
    const active = manager.getActiveSession('workbuddy');
    expect(active).toBeNull();
  });

  // ── Test 4: handoffSession transfers ownership ─────────────────────────

  it('should transfer session ownership via handoffSession', () => {
    manager.registerSession('doubao', 9222, 'owner-a');

    const result = manager.handoffSession('doubao', 'owner-b');

    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session!.owner).toBe('owner-b');
    expect(result.session!.handoffCount).toBe(1);
    expect(result.session!.state).toBe('ACTIVE');
  });

  // ── Test 5: releaseSession transitions to RELEASED ─────────────────────

  it('should release session and transition to RELEASED state', () => {
    manager.registerSession('codex', 9224, 'owner-x');

    const result = manager.releaseSession('codex');

    expect(result.success).toBe(true);

    // After release, getActiveSession should return null
    const active = manager.getActiveSession('codex');
    expect(active).toBeNull();

    // But getSession should still return the (released) session
    const session = manager.getSession('codex');
    expect(session).not.toBeNull();
    expect(session!.state).toBe('RELEASED');
  });

  // ── Test 6: registerSession rejects duplicate for active agent ─────────

  it('should reject registration when agent already has ACTIVE session', () => {
    const first = manager.registerSession('doubao', 9222, 'owner-a');
    expect(first.success).toBe(true);

    const second = manager.registerSession('doubao', 9222, 'owner-b');
    expect(second.success).toBe(false);
    expect(second.reason).toBe('duplicate_agent');
    expect(second.existingSession).toBe(first.session);
  });

  // ── Test 7: handoffSession fails when no session exists ────────────────

  it('should fail handoff when no session exists for agent', () => {
    const result = manager.handoffSession('workbuddy', 'new-owner');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_session');
  });

  // ── Test 8: releaseSession fails when not active ──────────────────────

  it('should fail release when session is not ACTIVE', () => {
    manager.registerSession('doubao', 9222, 'owner-a');
    manager.releaseSession('doubao');

    // Second release should fail
    const secondRelease = manager.releaseSession('doubao');
    expect(secondRelease.success).toBe(false);
    expect(secondRelease.reason).toBe('not_active');
  });

  // ── Test 9: hasActiveSession reflects current state ────────────────────

  it('should correctly report hasActiveSession across lifecycle', () => {
    expect(manager.hasActiveSession('doubao')).toBe(false);

    manager.registerSession('doubao', 9222, 'owner-a');
    expect(manager.hasActiveSession('doubao')).toBe(true);

    manager.releaseSession('doubao');
    expect(manager.hasActiveSession('doubao')).toBe(false);
  });

  // ── Test 10: getAllActiveSessions returns only active ──────────────────

  it('should return only active sessions from getAllActiveSessions', () => {
    manager.registerSession('doubao', 9222, 'owner-a');
    manager.registerSession('traework', 9223, 'owner-b');
    manager.registerSession('codex', 9224, 'owner-c');

    // Release one
    manager.releaseSession('traework');

    const active = manager.getAllActiveSessions();
    expect(active).toHaveLength(2);
    const activeIds = active.map((s) => s.adapterId);
    expect(activeIds).toContain('doubao');
    expect(activeIds).toContain('codex');
    expect(activeIds).not.toContain('traework');
  });

  // ── Test 11: concurrent register attempts serialize correctly ──────────

  it('should handle concurrent registrations for different agents safely', () => {
    const agents: AgentId[] = ['doubao', 'traework', 'workbuddy', 'codex', 'qoderwork', 'zcode'];
    let successCount = 0;

    for (const agent of agents) {
      const result = manager.registerSession(agent, 9222, `owner-${agent}`);
      if (result.success) successCount++;
    }

    expect(successCount).toBe(6);
    expect(manager.getAllActiveSessions()).toHaveLength(6);
    expect(manager.sessionCount).toBe(6);
  });

  // ── Test 12: handoff transfers ownership but preserves session identity ─

  it('should preserve session ID across handoffs', () => {
    const reg = manager.registerSession('doubao', 9222, 'owner-a');
    const originalId = reg.session!.id;

    const firstHandoff = manager.handoffSession('doubao', 'owner-b');
    expect(firstHandoff.session!.id).toBe(originalId);
    expect(firstHandoff.session!.handoffCount).toBe(1);
    expect(firstHandoff.session!.owner).toBe('owner-b');

    const secondHandoff = manager.handoffSession('doubao', 'owner-c');
    expect(secondHandoff.session!.id).toBe(originalId);
    expect(secondHandoff.session!.handoffCount).toBe(2);
    expect(secondHandoff.session!.owner).toBe('owner-c');

    // The active session should be the same object (same ID) across all handoffs
    const finalActive = manager.getActiveSession('doubao');
    expect(finalActive!.id).toBe(originalId);
    expect(finalActive!.handoffCount).toBe(2);
  });

  // ── Test 13: handoff fails for same owner ──────────────────────────────

  it('should reject handoff to the same owner', () => {
    manager.registerSession('doubao', 9222, 'owner-a');

    const result = manager.handoffSession('doubao', 'owner-a');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('same_owner');
  });

  // ── Test 14: register replaces released session ────────────────────────

  it('should allow re-registration after release', () => {
    const first = manager.registerSession('doubao', 9222, 'owner-a');
    expect(first.success).toBe(true);
    const firstId = first.session!.id;

    manager.releaseSession('doubao');

    const second = manager.registerSession('doubao', 9222, 'owner-b');
    expect(second.success).toBe(true);
    expect(second.session!.id).not.toBe(firstId);
    expect(second.session!.owner).toBe('owner-b');
  });

  // ── Test 15: sessionCount tracks all sessions ───────────────────────────

  it('should track session count including released sessions', () => {
    expect(manager.sessionCount).toBe(0);

    manager.registerSession('doubao', 9222, 'owner-a');
    manager.registerSession('codex', 9224, 'owner-b');
    expect(manager.sessionCount).toBe(2);

    manager.releaseSession('doubao');
    // Released session is still tracked
    expect(manager.sessionCount).toBe(2);
  });
});

describe('InjectionSessionManager — __test_reset', () => {
  it('should clear all sessions and reset ID counter', () => {
    const manager = new InjectionSessionManager();

    manager.registerSession('doubao', 9222, 'owner-a');
    manager.registerSession('codex', 9224, 'owner-b');
    expect(manager.sessionCount).toBe(2);

    (manager as unknown as { __test_reset(): void }).__test_reset();

    expect(manager.sessionCount).toBe(0);
    expect(manager.getActiveSession('doubao')).toBeNull();
    expect(manager.getActiveSession('codex')).toBeNull();
  });
});
