// SPDX-License-Identifier: MPL-2.0

/**
 * # Agent Type Guard Tests
 *
 * Tests for isAgentId and isAnyAgentId type guard functions.
 * These guards are critical for IPC boundary validation — they prevent
 * experimental adapters from being operated on as production products.
 */

import { describe, expect, it } from 'vitest';
import { isAgentId, isAnyAgentId } from './agent';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const VALID_AGENT_IDS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
const INVALID_IDS = ['', 'unknown', 'test', 'demo', 'preview', 'AGENTSkin', 'TRAework', 'Codex123', 'agentskin-preview'];

// ---------------------------------------------------------------------------
// isAgentId tests
// ---------------------------------------------------------------------------

describe('isAgentId', () => {
  it('returns true for all valid production agent ids', () => {
    for (const id of VALID_AGENT_IDS) {
      expect(isAgentId(id), `Expected '${id}' to be a valid agent id`).toBe(true);
    }
  });

  it('returns false for experimental adapter ids', () => {
    expect(isAgentId('agentskin-preview')).toBe(false);
  });

  it('returns false for invalid strings', () => {
    for (const id of INVALID_IDS) {
      expect(isAgentId(id), `Expected '${id}' to be an invalid agent id`).toBe(false);
    }
  });

  it('returns false for empty string', () => {
    expect(isAgentId('')).toBe(false);
  });

  it('returns false for case variations of valid ids', () => {
    // Agent ids are lowercase-only — case variations should be rejected
    expect(isAgentId('Traework')).toBe(false);
    expect(isAgentId('CODEX')).toBe(false);
    expect(isAgentId('WorkBuddy')).toBe(false);
  });

  it('returns false for whitespace-padded ids', () => {
    expect(isAgentId(' traework')).toBe(false);
    expect(isAgentId('traework ')).toBe(false);
    expect(isAgentId(' traework ')).toBe(false);
  });

  it('returns false for numeric strings', () => {
    expect(isAgentId('123')).toBe(false);
    expect(isAgentId('0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAnyAgentId tests
// ---------------------------------------------------------------------------

describe('isAnyAgentId', () => {
  it('returns true for all valid production agent ids', () => {
    for (const id of VALID_AGENT_IDS) {
      expect(isAnyAgentId(id), `Expected '${id}' to be a valid any agent id`).toBe(true);
    }
  });

  it('returns false for experimental adapter ids (none currently defined)', () => {
    // ExperimentalAgentId = never, so no experimental ids exist yet
    expect(isAnyAgentId('agentskin-preview')).toBe(false);
  });

  it('returns false for invalid strings', () => {
    for (const id of INVALID_IDS) {
      expect(isAnyAgentId(id), `Expected '${id}' to be an invalid any agent id`).toBe(false);
    }
  });

  it('returns false for empty string', () => {
    expect(isAnyAgentId('')).toBe(false);
  });

  it('returns false for case variations', () => {
    expect(isAnyAgentId('Traework')).toBe(false);
    expect(isAnyAgentId('CODEX')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type narrowing verification
// ---------------------------------------------------------------------------

describe('type narrowing', () => {
  it('isAgentId narrows string to AgentId type', () => {
    const input: string = 'traework';
    if (isAgentId(input)) {
      // After narrowing, input should be typed as AgentId
      // This is a compile-time check — if the guard doesn't narrow correctly,
      // TypeScript will report an error here.
      const _agentId: import('./agent').AgentId = input;
      expect(_agentId).toBe('traework');
    }
  });

  it('isAnyAgentId narrows string to AnyAgentId type', () => {
    const input: string = 'codex';
    if (isAnyAgentId(input)) {
      // After narrowing, input should be typed as AnyAgentId
      const _anyAgentId: import('./agent').AnyAgentId = input;
      expect(_anyAgentId).toBe('codex');
    }
  });
});
