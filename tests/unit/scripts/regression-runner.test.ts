// SPDX-License-Identifier: MPL-2.0

/**
 * regression-runner.mjs 聚合逻辑单测（审计 A-20 / R-22 / Q16）
 *
 * 纯函数验证——不执行阶段、不触达真实 Agent/CDP。断言多 Agent 失败隔离后的
 * 摘要与退出码语义。
 */

import { describe, expect, it } from 'vitest';
import { aggregateRegression } from '../../../scripts/regression-runner.mjs';

describe('aggregateRegression', () => {
  it('exit 0 when every agent passes', () => {
    const aggregate = aggregateRegression({
      traework: { agentId: 'traework', status: 'pass', phases: [] },
      codex: { agentId: 'codex', status: 'pass', phases: [] },
    });
    expect(aggregate.exitCode).toBe(0);
    expect(aggregate.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(aggregate.failedAgents).toEqual([]);
  });

  it('exit 2 and isolates the failing agents (one bad agent does not sink the rest)', () => {
    const aggregate = aggregateRegression({
      traework: { agentId: 'traework', status: 'pass', phases: [] },
      zcode: {
        agentId: 'zcode',
        status: 'fail',
        phases: [{ name: 'semantic-snapshot', status: 'fail' }],
      },
      doubao: { agentId: 'doubao', status: 'pass', phases: [] },
    });
    expect(aggregate.exitCode).toBe(2);
    expect(aggregate.summary).toEqual({ total: 3, passed: 2, failed: 1 });
    expect(aggregate.failedAgents).toEqual(['zcode']);
  });

  it('governs exit code from failures only, not drift/partial state', () => {
    const aggregate = aggregateRegression({
      qoderwork: { agentId: 'qoderwork', status: 'pass', phases: [] },
    });
    expect(aggregate.summary.failed).toBe(0);
    expect(aggregate.exitCode).toBe(0);
  });
});
