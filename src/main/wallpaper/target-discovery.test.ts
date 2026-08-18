// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/target-discovery
 *
 * RFC A2 P1 — 锁住「rendererHints 定主 renderer」在壁纸目标解析上的语义：
 *
 *   - `resolvePageTarget`：有 hints 时用 `partitionRenderers` 选主（排除
 *     secondary、按 preferredUrlPatterns/score 判定）；无 hints 时退化到历史
 *     「优先 page type」行为。空集合返回 undefined。
 *   - `resolvePageTargets`：有 hints 时保持全量返回但把主 renderer 排到首位；
 *     无 hints 时不做任何重排（行为与现状完全一致）。
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import type { WallpaperInjectorDeps } from './injector-types';
import { resolvePageTarget, resolvePageTargets } from './target-discovery';

const TEST_AGENT: AgentId = 'doubao' as AgentId;
const PORT = 9222;

function page(id: string, url: string): any {
  return {
    id,
    type: 'page',
    url,
    title: id,
    webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/${id}`,
  };
}

function depsWithTargets(targets: unknown[], hints?: unknown): WallpaperInjectorDeps {
  return {
    wallpaperService: null,
    isEpochCurrent: () => true,
    bumpEpoch: () => 1,
    resolveAgentWallpaperId: async () => ({ id: null }),
    ensureCdpReady: async () => ({ port: 0, reason: 'test' }),
    resolveLivePort: async () => null,
    inferRestartReason: async () => 'no-cdp' as const,
    findAgentTargets: vi.fn(async () => targets),
    setAgentWallpaper: async () => {},
    rendererHints: hints === undefined ? undefined : ((() => hints) as any),
    log: () => undefined,
  } as unknown as WallpaperInjectorDeps;
}

describe('resolvePageTarget (RFC A2 P1)', () => {
  it('无 hints 时退化：优先 page type，其次第一个已批准 target', async () => {
    const webview = page('w', 'http://app/webview');
    webview.type = 'webview';
    const targets = [webview, page('m', 'http://app/main')];
    const deps = depsWithTargets(targets);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    expect(primary?.id).toBe('m');
  });

  it('无 hints 且无 page 时回退第一个已批准 target（WorkBuddy webview 场景）', async () => {
    const webview = page('w', 'http://app/webview');
    webview.type = 'webview';
    const deps = depsWithTargets([webview]);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    expect(primary?.id).toBe('w');
  });

  it('有 hints 时按 preferredUrlPatterns 选主，忽略列表顺序', async () => {
    const targets = [
      page('boot', 'http://app/?initialRoute=boot'),
      page('main', 'http://app/chat'),
    ];
    const hints = { preferredUrlPatterns: ['chat|main-window'] };
    const deps = depsWithTargets(targets, hints);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    expect(primary?.id).toBe('main');
  });

  it('有 hints 时 secondaryPatterns 命中的 target 不会成为主', async () => {
    const targets = [
      page('ovl', 'http://app/?initialRoute=avatar-overlay'),
      page('main', 'http://app/chat'),
    ];
    const hints = { secondaryPatterns: ['avatar-overlay|boot'] };
    const deps = depsWithTargets(targets, hints);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    expect(primary?.id).toBe('main');
  });

  it('有 hints 但全部被 secondary 排除时兜底优先 page', async () => {
    const targets = [page('boot', 'http://app/?initialRoute=boot')];
    const hints = { secondaryPatterns: ['boot'] };
    const deps = depsWithTargets(targets, hints);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    // partitionRenderers 全部排除 → primary undefined → 兜底 find(page)
    expect(primary?.id).toBe('boot');
  });

  it('空集合返回 undefined', async () => {
    const deps = depsWithTargets([]);
    const primary = await resolvePageTarget(deps, TEST_AGENT, PORT);
    expect(primary).toBeUndefined();
  });
});

describe('resolvePageTargets (RFC A2 P1)', () => {
  it('无 hints 时保持原顺序（不重排）', async () => {
    const targets = [
      page('boot', 'http://app/?initialRoute=boot'),
      page('main', 'http://app/chat'),
    ];
    const deps = depsWithTargets(targets);
    const resolved = await resolvePageTargets(deps, TEST_AGENT, PORT);
    expect(resolved.map((t) => t.id)).toEqual(['boot', 'main']);
  });

  it('有 hints 时全量返回但主 renderer 排首位', async () => {
    const targets = [
      page('boot', 'http://app/?initialRoute=boot'),
      page('main', 'http://app/chat'),
      page('ovl', 'http://app/?initialRoute=avatar-overlay'),
    ];
    const hints = {
      preferredUrlPatterns: ['chat|main-window'],
      secondaryPatterns: ['avatar-overlay|boot'],
    };
    const deps = depsWithTargets(targets, hints);
    const resolved = await resolvePageTargets(deps, TEST_AGENT, PORT);
    // 主排首；secondaries 也保留（壁纸仍铺所有表面：CDP-5 由主决定成败）
    expect(resolved[0].id).toBe('main');
    expect(resolved.map((t) => t.id).sort()).toEqual(['boot', 'main', 'ovl']);
  });

  it('无 connectable target 时返回空数组', async () => {
    // 缺少 webSocketDebuggerUrl 的 target 被 filterForCdpConnectivity 过滤
    const noWs = page('x', 'http://app/x');
    delete noWs.webSocketDebuggerUrl;
    const deps = depsWithTargets([noWs]);
    const resolved = await resolvePageTargets(deps, TEST_AGENT, PORT);
    expect(resolved).toEqual([]);
  });
});
