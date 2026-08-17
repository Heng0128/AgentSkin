// SPDX-License-Identifier: MPL-2.0

/**
 * diagnostics-kill-switch.mjs 单测（审计 A-18 / R-23）
 *
 * 纯函数验证——无 DOM / CDP 依赖。断言 per-Agent 诊断开关的读取语义。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_KILL_SWITCH,
  isDiagnosticsEnabled,
  diagnosticsKillReason,
} from './diagnostics-kill-switch.mjs';

afterEach(() => {
  for (const key of Object.keys(DIAGNOSTICS_KILL_SWITCH)) {
    delete DIAGNOSTICS_KILL_SWITCH[key];
  }
});

describe('isDiagnosticsEnabled', () => {
  it('defaults to enabled when the agent is not registered', () => {
    expect(isDiagnosticsEnabled('traework', 'styleSampling')).toBe(true);
    expect(isDiagnosticsEnabled('not-an-agent', 'any')).toBe(true);
  });

  it('enables when a registered agent has no entry for the feature', () => {
    DIAGNOSTICS_KILL_SWITCH.codex = {};
    expect(isDiagnosticsEnabled('codex', 'styleSampling')).toBe(true);
  });

  it('disables all features when the entry is `true` (emergency switch)', () => {
    DIAGNOSTICS_KILL_SWITCH.zcode = true;
    expect(isDiagnosticsEnabled('zcode', 'styleSampling')).toBe(false);
    expect(isDiagnosticsEnabled('zcode', 'anyFutureFeature')).toBe(false);
  });

  it('disables only the listed feature for fine-grained control', () => {
    DIAGNOSTICS_KILL_SWITCH.doubao = { styleSampling: true };
    expect(isDiagnosticsEnabled('doubao', 'styleSampling')).toBe(false);
    // 其它未列 feature 不受影响
    expect(isDiagnosticsEnabled('doubao', 'somethingElse')).toBe(true);
  });
});

describe('diagnosticsKillReason', () => {
  it('returns null when enabled', () => {
    expect(diagnosticsKillReason('traework', 'styleSampling')).toBeNull();
  });

  it('reports the kill-switch scope when disabled', () => {
    DIAGNOSTICS_KILL_SWITCH.zcode = true;
    expect(diagnosticsKillReason('zcode', 'styleSampling')).toBe('kill-switch:all');

    DIAGNOSTICS_KILL_SWITCH.doubao = { styleSampling: true };
    expect(diagnosticsKillReason('doubao', 'styleSampling')).toBe('kill-switch:styleSampling');
  });
});