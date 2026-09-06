// SPDX-License-Identifier: MPL-2.0

import type { AgentId, ApplyResponse, SystemStatus } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { handleApplyResult } from './apply-result';

const appId: AgentId = 'traework';

const baseStatus: SystemStatus = {
  platform: 'win32',
  apps: [],
};

const ctx = { themeId: 'cyber-neon', themeName: 'Cyber Neon', appId };

describe('handleApplyResult', () => {
  it('returns "success" when status is "applied"', () => {
    const result: ApplyResponse = {
      status: 'applied',
      message: 'OK',
      system: baseStatus,
    };
    const outcome = handleApplyResult(result, ctx);
    expect(outcome).toEqual({ kind: 'success' });
  });

  it('returns "requires-restart" with context when status is "requires-restart"', () => {
    const result: ApplyResponse = {
      status: 'requires-restart',
      message: 'Restart needed',
      system: baseStatus,
      restartReason: 'no-cdp',
    };
    const outcome = handleApplyResult(result, ctx);
    expect(outcome).toEqual({
      kind: 'requires-restart',
      themeId: 'cyber-neon',
      themeName: 'Cyber Neon',
      appId: 'traework',
      restartReason: 'no-cdp',
    });
  });

  it('returns "requires-restart" with undefined restartReason when not provided', () => {
    const result: ApplyResponse = {
      status: 'requires-restart',
      message: 'Restart needed',
      system: baseStatus,
    };
    const outcome = handleApplyResult(result, ctx);
    expect(outcome.kind).toBe('requires-restart');
    if (outcome.kind === 'requires-restart') {
      expect(outcome.restartReason).toBeUndefined();
    }
  });

  it('returns "port-occupied" with message when status is "port-occupied"', () => {
    const result: ApplyResponse = {
      status: 'port-occupied',
      message: 'Port 9222 is in use',
      system: baseStatus,
    };
    const outcome = handleApplyResult(result, ctx);
    expect(outcome).toEqual({
      kind: 'port-occupied',
      message: 'Port 9222 is in use',
    });
  });

  it('passes through all restartReason variants', () => {
    const reasons: NonNullable<ApplyResponse['restartReason']>[] = [
      'not-installed',
      'not-running',
      'no-cdp',
      'spawn-failed',
      'singleton-lock',
      'cdp-timeout',
    ];
    for (const reason of reasons) {
      const result: ApplyResponse = {
        status: 'requires-restart',
        message: 'Restart',
        system: baseStatus,
        restartReason: reason,
      };
      const outcome = handleApplyResult(result, ctx);
      expect(outcome.kind).toBe('requires-restart');
      if (outcome.kind === 'requires-restart') {
        expect(outcome.restartReason).toBe(reason);
      }
    }
  });

  it('returns "unknown-status" (not success) for unrecognized status', () => {
    // Simulate a future main process returning an unknown status.
    const result = {
      status: 'new-unrecognized-status',
      message: 'Something unexpected',
      system: baseStatus,
    } as unknown as ApplyResponse;
    const outcome = handleApplyResult(result, ctx);
    expect(outcome.kind).toBe('unknown-status');
    if (outcome.kind === 'unknown-status') {
      expect(outcome.status).toBe('new-unrecognized-status');
      expect(outcome.message).toBeTruthy();
    }
  });
});
