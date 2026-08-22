// SPDX-License-Identifier: MPL-2.0

/**
 * CDP-5 — 锁住"primary-target-wins"语义（回归守卫）。
 *
 * `injectAgentWallpaper` 对多个 page target 并行注入时，**整体成败由 primary
 * target（第一个可见主窗口）决定**——secondary（后台页/辅助 webview）的成功
 * 绝不能掩盖主窗口的失败（历史 bug：background page 成功但 visible window
 * 失败 → 假报"注入成功"）。
 *
 * 全链路 mock：waitForTargets 返回 2 个 page target，image 注入器按调用
 * 返回成败，验证 ok 只由 primary 决定。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../shared/types';
import type { WallpaperInjectorDeps } from './wallpaper/injector-types';

vi.mock('./wallpaper-server', () => ({
  wallpaperMediaServer: {
    register: vi.fn().mockResolvedValue(null),
    unregister: vi.fn(),
  },
}));

vi.mock('./wallpaper/target-discovery', () => ({
  waitForTargets: vi.fn(),
  waitForPageReady: vi.fn(async () => undefined),
  resolvePageTargets: vi.fn(async () => []),
  safeFileSize: vi.fn(async () => 100),
  VIDEO_HTTP_THRESHOLD: 20 * 1024 * 1024,
  IMAGE_BLOB_FALLBACK_CAP: 0,
  VIDEO_BLOB_FALLBACK_CAP: 0,
}));

vi.mock('./cdp/cdp-client', () => ({
  connectCdp: vi.fn(),
}));

vi.mock('./cdp/wallpaper/image-injector', () => ({
  injectImageWallpaper: vi.fn(),
  injectImageWallpaperByUrl: vi.fn(),
}));

import { connectCdp } from './cdp/cdp-client';
import { injectImageWallpaper } from './cdp/wallpaper/image-injector';
import { waitForTargets } from './wallpaper/target-discovery';
import { injectAgentWallpaper } from './wallpaper-injector';

const TEST_AGENT: AgentId = 'traework' as AgentId;

function makeMockSession() {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('ok'),
    close: vi.fn(),
  };
}

function makeDeps(): WallpaperInjectorDeps {
  return {
    wallpaperService: {
      videoPathFor: async () => null,
      mediaInfoFor: async () => ({ type: 'image', path: 'C:/fake/bg.png', previewOnly: false }),
      webUrlFor: async () => null,
    },
    isEpochCurrent: () => true,
    bumpEpoch: () => 1,
    resolveAgentWallpaperId: async () => ({ id: null }),
    ensureCdpReady: async () => ({ port: 0, reason: 'test' }),
    resolveLivePort: async () => null,
    inferRestartReason: async () => 'no-cdp' as const,
    findAgentTargets: async () => [],
    setAgentWallpaper: async () => {},
    log: () => undefined,
  } as unknown as WallpaperInjectorDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(connectCdp).mockResolvedValue(makeMockSession() as never);
  vi.mocked(waitForTargets).mockResolvedValue([
    { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/primary' },
    { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/secondary' },
  ] as never);
});

describe('injectAgentWallpaper — primary-target-wins (CDP-5)', () => {
  it('reports FAILURE when the primary target fails even if secondary succeeds', async () => {
    // 按 session 归属区分：primary（URL 含 /page/primary）恒失败，
    // secondary 恒成功 —— 与并发执行顺序无关。
    vi.mocked(connectCdp).mockImplementation(
      async (url: string) => ({ ...makeMockSession(), __wsUrl: url }) as never,
    );
    vi.mocked(injectImageWallpaper).mockImplementation(async (session) => {
      const url = (session as unknown as { __wsUrl?: string }).__wsUrl ?? '';
      if (url.includes('primary')) return { ok: false, verdict: 'loadfail:test' };
      return { ok: true, verdict: 'ok' };
    });

    const result = await injectAgentWallpaper(TEST_AGENT, 9222, 'wp-1', {}, 1, makeDeps());

    expect(result.ok).toBe(false);
    // 整体失败由 primary 决定 —— 不能被 secondary 的成功掩盖。
    expect(result.detail).toContain('loadfail:test');
  });

  it('reports SUCCESS when the primary target succeeds regardless of secondary', async () => {
    // 全部调用成功（含 primary 与 secondary）→ 整体成功。primary 的成功
    // 不被任何下游失败牵连（反之亦然，见上一个用例）。
    vi.mocked(injectImageWallpaper).mockResolvedValue({ ok: true, verdict: 'ok' });

    const result = await injectAgentWallpaper(TEST_AGENT, 9222, 'wp-1', {}, 1, makeDeps());

    expect(result.ok).toBe(true);
    expect(result.detail).toBeUndefined();
  });
});
