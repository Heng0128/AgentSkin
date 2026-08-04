// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import type { EventCdpSession } from './cdp-client';
import {
  CdpWatcher,
  type CdpWatcherDeps,
  defaultShouldInject,
  type WatcherTargetInfo,
} from './cdp-watcher';

// ---------------------------------------------------------------------------
// Mock connectEventCdp — drive events from the test.
// ---------------------------------------------------------------------------

const send = vi.fn().mockResolvedValue({});
const close = vi.fn();

const fakeSession: EventCdpSession = {
  send: send as unknown as EventCdpSession['send'],
  evaluate: vi.fn().mockResolvedValue('ok') as unknown as EventCdpSession['evaluate'],
  close: close as unknown as EventCdpSession['close'],
  on: vi.fn(),
  off: vi.fn(),
};

// Capture the on() handlers per method so tests can fire events.
const eventHandlers = new Map<string, (params: unknown) => void>();

vi.mock('./cdp-client', () => ({
  connectEventCdp: vi.fn(async () => fakeSession),
}));

const { connectEventCdp } = await import('./cdp-client');

beforeEach(() => {
  vi.clearAllMocks();
  eventHandlers.clear();
  (fakeSession.on as ReturnType<typeof vi.fn>).mockImplementation(
    (method: string, handler: (params: unknown) => void) => {
      eventHandlers.set(method, handler);
    },
  );
  (connectEventCdp as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSession);
});

afterEach(() => {
  vi.useRealTimers();
});

function fire(method: string, params: unknown): void {
  const h = eventHandlers.get(method);
  if (h) h(params);
}

/** fire 并等待 onTarget 的异步注入链（inject + seenTargets.add）settle。 */
async function fireAndSettle(method: string, params: unknown): Promise<void> {
  fire(method, params);
  await Promise.resolve();
  await Promise.resolve();
}

function target(over: Partial<WatcherTargetInfo> = {}): WatcherTargetInfo {
  return {
    targetId: 'target-1',
    type: 'page',
    url: 'http://localhost/app',
    title: 'App',
    ...over,
  };
}

function makeDeps(overrides: Partial<CdpWatcherDeps> = {}): CdpWatcherDeps {
  return {
    resolveBrowserWsUrl: async () => 'ws://127.0.0.1:9222/devtools/browser/token',
    shouldInject: defaultShouldInject,
    inject: async () => true,
    currentEpoch: () => 1,
    log: () => undefined,
    ...overrides,
  };
}

describe('defaultShouldInject', () => {
  it('accepts DOM types with app/real URLs', () => {
    expect(defaultShouldInject(target({ type: 'page', url: 'app://codex/' }))).toBe(true);
    expect(defaultShouldInject(target({ type: 'webview', url: 'http://localhost/x' }))).toBe(true);
    expect(defaultShouldInject(target({ type: 'iframe', url: 'file:///x' }))).toBe(true);
  });

  it('rejects workers / devtools panels / loopback targets', () => {
    expect(defaultShouldInject(target({ type: 'worker' }))).toBe(false);
    expect(defaultShouldInject(target({ type: 'page', url: 'chrome-devtools://panel' }))).toBe(
      false,
    );
    // AgentSkin 自己的壁纸 server / 自托管回环 → 跳过。
    expect(defaultShouldInject(target({ type: 'webview', url: 'http://127.0.0.1:9337/' }))).toBe(
      false,
    );
  });
});

describe('CdpWatcher', () => {
  it('connects and subscribes to Target.setDiscoverTargets', async () => {
    const deps = makeDeps();
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    const started = await watcher.start();
    expect(started).toBe(true);
    expect(connectEventCdp).toHaveBeenCalledWith(
      'ws://127.0.0.1:9222/devtools/browser/token',
      4000,
      8000,
    );
    expect(send).toHaveBeenCalledWith('Target.setDiscoverTargets', { discover: true });
    watcher.stop();
  });

  it('auto-injects a new page target (CDP-1)', async () => {
    const inject = vi.fn(async () => true);
    const deps = makeDeps({ inject });
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    await watcher.start();

    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 't1', type: 'page', url: 'app://x/' }),
    });
    expect(inject).toHaveBeenCalledTimes(1);
    expect(deps.inject).toHaveBeenCalledWith(expect.objectContaining({ targetId: 't1' }), 1);
    expect(watcher.getState().targetsSeen).toBe(1);

    // 去重：同一 targetId 不再注入。
    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 't1', type: 'page', url: 'app://x/' }),
    });
    expect(inject).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('skips targets rejected by the probe whitelist', async () => {
    const inject = vi.fn(async () => true);
    const deps = makeDeps({ inject });
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    await watcher.start();

    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 'w1', type: 'worker' }),
    });
    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 'w2', type: 'webview', url: 'http://127.0.0.1:9337/' }),
    });
    expect(inject).not.toHaveBeenCalled();
    expect(watcher.getState().targetsSeen).toBe(0);
    watcher.stop();
  });

  it('re-injects when a seen target navigates (targetInfoChanged)', async () => {
    const inject = vi.fn(async () => true);
    const deps = makeDeps({ inject });
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    await watcher.start();

    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 't1', type: 'page', url: 'app://a/' }),
    });
    expect(inject).toHaveBeenCalledTimes(1);

    await fireAndSettle('Target.targetInfoChanged', {
      targetInfo: target({ targetId: 't1', type: 'page', url: 'app://b/' }),
    });
    expect(inject).toHaveBeenCalledTimes(2); // SPA 导航 → 重新注入
    watcher.stop();
  });

  it('drops a target from the seen set on destroy (can re-inject later)', async () => {
    const inject = vi.fn(async () => true);
    const deps = makeDeps({ inject });
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    await watcher.start();

    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 't1', url: 'app://a/' }),
    });
    await fireAndSettle('Target.targetDestroyed', { targetId: 't1' });
    await fireAndSettle('Target.targetCreated', {
      targetInfo: target({ targetId: 't1', url: 'app://a/' }),
    });
    expect(inject).toHaveBeenCalledTimes(2); // destroy 后重新创建 → 重新注入
    watcher.stop();
  });

  it('degrades when the browser endpoint is unavailable', async () => {
    const deps = makeDeps({ resolveBrowserWsUrl: async () => null });
    const watcher = new CdpWatcher('traework' as AgentId, 9222, deps);
    const started = await watcher.start();
    expect(started).toBe(false);
    expect(watcher.getState().degraded).toBe(true);
    watcher.stop();
  });
});
