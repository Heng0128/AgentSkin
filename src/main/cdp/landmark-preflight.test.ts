// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { getDefaultLandmarks, type LandmarkDefinition, runLandmarkPreflight } from './preflight';

// ---------------------------------------------------------------------------
// Mock session factory
// ---------------------------------------------------------------------------

/**
 * 创建一个 mock CdpSession，其 evaluate 方法返回指定的原始 JSON。
 * 这模拟了 CDP IIFE 在页面中执行后返回 JSON 字符串的行为。
 */
function createMockSession(rawJson: string): CdpSession {
  return {
    evaluate: vi.fn().mockResolvedValue(rawJson),
    send: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  };
}

/**
 * 创建一个 mock CdpSession，其 evaluate 方法根据 landmarks 定义
 * 模拟真实的 IIFE 行为（用于集成风格测试）。
 */
function createSimulatedSession(
  /** 模拟页面中存在的选择器集合 */
  existingSelectors: Set<string>,
): CdpSession {
  return {
    evaluate: vi.fn().mockImplementation((expr: string) => {
      // 从表达式中提取 landmarks JSON（简单解析）
      const match = expr.match(/const landmarks = (\[.*?\]);/s);
      if (!match) return Promise.resolve('[]');
      const landmarks = JSON.parse(match[1]) as LandmarkDefinition[];
      const results = landmarks.map((lm) => {
        for (const sel of lm.selectors) {
          if (existingSelectors.has(sel)) {
            return { name: lm.name, found: true, matchedSelector: sel, count: 1 };
          }
        }
        return { name: lm.name, found: false, count: 0 };
      });
      return Promise.resolve(JSON.stringify(results));
    }),
    send: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 测试固件
// ---------------------------------------------------------------------------

const allHitLandmarks: LandmarkDefinition[] = [
  { name: 'chat-surface', selectors: ['.chat-surface'], required: true },
  { name: 'prompt-composer', selectors: ['.prompt-composer'], required: true },
];

const mixedLandmarks: LandmarkDefinition[] = [
  { name: 'chat-surface', selectors: ['.chat-surface'], required: true },
  { name: 'sidebar', selectors: ['.sidebar', '.side-panel'], required: false, routeHint: '/chat' },
];

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('runLandmarkPreflight', () => {
  // 1. 全部 landmarks 命中 → passed=true
  it('returns passed=true when all landmarks hit', async () => {
    const session = createMockSession(
      JSON.stringify([
        { name: 'chat-surface', found: true, matchedSelector: '.chat-surface', count: 1 },
        { name: 'prompt-composer', found: true, matchedSelector: '.prompt-composer', count: 1 },
      ]),
    );

    const result = await runLandmarkPreflight(session, allHitLandmarks);

    expect(result.passed).toBe(true);
    expect(result.hits).toHaveLength(2);
    expect(result.misses).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.hits[0]).toEqual({
      name: 'chat-surface',
      matchedSelector: '.chat-surface',
      count: 1,
    });
  });

  // 2. 单个 required 缺失 → passed=false
  it('returns passed=false when a required landmark is missing', async () => {
    const session = createMockSession(
      JSON.stringify([
        { name: 'chat-surface', found: true, matchedSelector: '.chat-surface', count: 1 },
        { name: 'prompt-composer', found: false, count: 0 },
      ]),
    );

    const result = await runLandmarkPreflight(session, allHitLandmarks);

    expect(result.passed).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].name).toBe('prompt-composer');
  });

  // 3. 非 required 缺失 → passed=true, warnings 包含该项
  it('returns passed=true with warning when a non-required landmark is missing', async () => {
    const session = createMockSession(
      JSON.stringify([
        { name: 'chat-surface', found: true, matchedSelector: '.chat-surface', count: 1 },
        { name: 'sidebar', found: false, count: 0 },
      ]),
    );

    const result = await runLandmarkPreflight(session, mixedLandmarks);

    expect(result.passed).toBe(true);
    expect(result.hits).toHaveLength(1);
    expect(result.misses).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe('sidebar');
    expect(result.warnings[0].routeHint).toBe('/chat');
  });

  // 4. 空 landmarks 数组 → passed=true
  it('returns passed=true for empty landmarks array', async () => {
    const session = createMockSession('[]');

    const result = await runLandmarkPreflight(session, []);

    expect(result.passed).toBe(true);
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    // 空数组时不应调用 evaluate（快速路径）
    expect(session.evaluate).not.toHaveBeenCalled();
  });

  // 5. 无效 CSS 选择器 → 不抛错，标记为未命中
  it('does not throw for invalid CSS selectors — marks as miss', async () => {
    // IIFE 内部捕获无效选择器异常，返回 found: false
    const session = createMockSession(JSON.stringify([{ name: 'bad', found: false, count: 0 }]));

    const landmarks: LandmarkDefinition[] = [
      { name: 'bad', selectors: ['[[invalid'], required: true },
    ];

    // 不应抛错
    await expect(runLandmarkPreflight(session, landmarks)).resolves.toBeDefined();

    const result = await runLandmarkPreflight(session, landmarks);
    expect(result.passed).toBe(false);
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].name).toBe('bad');
  });

  // 6. 并发安全（多个 session 同时调用）
  it('handles concurrent preflight calls across multiple sessions', async () => {
    const sessionA = createSimulatedSession(new Set(['.chat-surface', '.prompt-composer']));
    const sessionB = createSimulatedSession(new Set(['.chat-surface'])); // 缺 prompt-composer

    const [resultA, resultB] = await Promise.all([
      runLandmarkPreflight(sessionA, allHitLandmarks),
      runLandmarkPreflight(sessionB, allHitLandmarks),
    ]);

    expect(resultA.passed).toBe(true);
    expect(resultB.passed).toBe(false);
    expect(resultA.hits).toHaveLength(2);
    expect(resultB.hits).toHaveLength(1);
    expect(resultB.misses).toHaveLength(1);
  });

  // 7. 多选择器候选 — 第一个命中即停
  it('uses the first matching selector when multiple candidates exist', async () => {
    const session = createMockSession(
      JSON.stringify([{ name: 'sidebar', found: true, matchedSelector: '.side-panel', count: 3 }]),
    );

    const landmarks: LandmarkDefinition[] = [
      { name: 'sidebar', selectors: ['.sidebar', '.side-panel'], required: true },
    ];

    const result = await runLandmarkPreflight(session, landmarks);

    expect(result.passed).toBe(true);
    expect(result.hits[0].matchedSelector).toBe('.side-panel');
    expect(result.hits[0].count).toBe(3);
  });

  // 8. 畸形 JSON 响应 → 保守降级（required 标记为缺失）
  it('degrades gracefully when CDP returns malformed JSON', async () => {
    const session = createMockSession('not valid json {{{');

    const result = await runLandmarkPreflight(session, allHitLandmarks);

    expect(result.passed).toBe(false);
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(2);
  });

  // 9. 畸形 JSON 响应 — 非 required 全部进 warnings
  it('puts all landmarks in warnings when malformed JSON and none are required', async () => {
    const session = createMockSession('not valid json {{{');

    const landmarks: LandmarkDefinition[] = [
      { name: 'opt-a', selectors: ['.a'], required: false },
      { name: 'opt-b', selectors: ['.b'], required: false },
    ];

    const result = await runLandmarkPreflight(session, landmarks);

    expect(result.passed).toBe(true);
    expect(result.misses).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });

  // 10. 使用模拟 session 验证完整 IIFE 行为
  it('integrates with simulated DOM via IIFE expression', async () => {
    const session = createSimulatedSession(new Set(['.chat-surface', '.prompt-composer']));

    const result = await runLandmarkPreflight(session, allHitLandmarks);

    expect(result.passed).toBe(true);
    expect(result.hits).toHaveLength(2);
    // 确认 evaluate 被调用且传入了 IIFE 表达式
    expect(session.evaluate).toHaveBeenCalledTimes(1);
    const callArg = (session.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toContain('document.querySelectorAll');
    expect(callArg).toContain('.chat-surface');
  });

  // 11. 全部 required 缺失 → passed=false, misses 包含全部
  it('returns all required landmarks in misses when none are found', async () => {
    const session = createMockSession(
      JSON.stringify([
        { name: 'chat-surface', found: false, count: 0 },
        { name: 'prompt-composer', found: false, count: 0 },
      ]),
    );

    const result = await runLandmarkPreflight(session, allHitLandmarks);

    expect(result.passed).toBe(false);
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(2);
    expect(result.misses.map((m) => m.name)).toEqual(['chat-surface', 'prompt-composer']);
  });

  // 12. routeHint 在 miss/warning 中保留
  it('preserves routeHint in miss and warning entries', async () => {
    const session = createMockSession(
      JSON.stringify([
        { name: 'req-ok', found: true, matchedSelector: '.ok', count: 1 },
        { name: 'req-fail', found: false, count: 0 },
        { name: 'opt-fail', found: false, count: 0 },
      ]),
    );

    const landmarks: LandmarkDefinition[] = [
      { name: 'req-ok', selectors: ['.ok'], required: true },
      { name: 'req-fail', selectors: ['.fail'], required: true, routeHint: '/home' },
      { name: 'opt-fail', selectors: ['.opt'], required: false, routeHint: '/settings' },
    ];

    const result = await runLandmarkPreflight(session, landmarks);

    expect(result.passed).toBe(false);
    expect(result.misses[0].routeHint).toBe('/home');
    expect(result.warnings[0].routeHint).toBe('/settings');
  });
});

describe('getDefaultLandmarks', () => {
  // 13. 所有 6 个适配器都有默认定义
  it('provides default landmarks for all 6 adapters', () => {
    const agents = ['codex', 'workbuddy', 'qoderwork', 'traework', 'doubao', 'zcode'] as const;
    for (const agentId of agents) {
      const landmarks = getDefaultLandmarks(agentId);
      expect(landmarks.length).toBeGreaterThan(0);
      // 每个 landmark 必须有 name 和至少一个 selector
      for (const lm of landmarks) {
        expect(lm.name).toBeTruthy();
        expect(lm.selectors.length).toBeGreaterThan(0);
      }
    }
  });

  // 14. 默认定义中包含 required 和可选 landmark
  it('includes both required and optional landmarks in defaults', () => {
    const codex = getDefaultLandmarks('codex');
    expect(codex.some((lm) => lm.required)).toBe(true);

    // CodeDrobe 原则：composer 是 recommended 级（次级路由/弹出窗会隐藏输入面板）
    expect(codex.find((lm) => lm.name === 'composer')?.required).toBe(false);

    // qoderwork 有可选的 qoder-sidebar
    const qoderwork = getDefaultLandmarks('qoderwork');
    expect(qoderwork.some((lm) => !lm.required)).toBe(true);
    expect(qoderwork.find((lm) => lm.name === 'qoder-sidebar')?.required).toBe(false);
  });
});
