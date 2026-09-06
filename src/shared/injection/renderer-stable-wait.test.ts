// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import {
  type CdpTargetMinimal,
  RendererStableWaitTimeoutError,
  waitForRendererStable,
} from './renderer-stable-wait';

function makeTarget(id: string, url = 'http://localhost:3000/chat'): CdpTargetMinimal {
  return { id, type: 'page', url, webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}` };
}

describe('waitForRendererStable', () => {
  it('returns renderer info when ID stays stable past threshold', async () => {
    const listTargets = vi.fn().mockResolvedValue([makeTarget('STABLE')]);
    const result = await waitForRendererStable(listTargets, {
      stableThreshold: 50,
      pollInterval: 10,
      maxWait: 5000,
    });
    expect(result.id).toBe('STABLE');
    expect(result.url).toBe('http://localhost:3000/chat');
    expect(result.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9222/devtools/page/STABLE');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(45);
    // Should poll at least twice (once to set lastId, once to confirm stability)
    expect(listTargets.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('resets stability timer when ID changes', async () => {
    let callCount = 0;
    const ids = ['A', 'B', 'C', 'STABLE'];
    const listTargets = vi.fn().mockImplementation(() => {
      const id = ids[Math.min(callCount, ids.length - 1)];
      callCount++;
      return Promise.resolve([makeTarget(id)]);
    });
    const result = await waitForRendererStable(listTargets, {
      stableThreshold: 30,
      pollInterval: 10,
      maxWait: 5000,
    });
    expect(result.id).toBe('STABLE');
  });

  it('times out when ID never stabilizes', async () => {
    let n = 0;
    const listTargets = vi.fn().mockImplementation(() => Promise.resolve([makeTarget(`D${++n}`)]));
    await expect(
      waitForRendererStable(listTargets, {
        stableThreshold: 500,
        pollInterval: 10,
        maxWait: 200,
      }),
    ).rejects.toThrow(RendererStableWaitTimeoutError);
  });

  it('times out when no page target exists', async () => {
    const listTargets = vi
      .fn()
      .mockResolvedValue([
        { id: 'worker-1', type: 'service_worker', url: 'chrome-extension://...' },
      ]);
    await expect(
      waitForRendererStable(listTargets, {
        stableThreshold: 50,
        pollInterval: 10,
        maxWait: 100,
      }),
    ).rejects.toThrow(RendererStableWaitTimeoutError);
  });

  it('includes lastSeenId and config in timeout error', async () => {
    let n = 0;
    const listTargets = vi.fn().mockImplementation(() => Promise.resolve([makeTarget(`X${++n}`)]));
    try {
      await waitForRendererStable(listTargets, {
        stableThreshold: 200,
        pollInterval: 10,
        maxWait: 150,
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RendererStableWaitTimeoutError);
      const err = e as RendererStableWaitTimeoutError;
      expect(err.maxWait).toBe(150);
      expect(err.stableThreshold).toBe(200);
      expect(err.lastSeenId).toBeDefined();
      expect(err.code).toBe('RENDERER_STABLE_WAIT_TIMEOUT');
    }
  });

  it('respects pollInterval (does not poll faster than configured)', async () => {
    const timestamps: number[] = [];
    const listTargets = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now());
      return Promise.resolve([makeTarget('IDLE')]);
    });
    await waitForRendererStable(listTargets, {
      stableThreshold: 30,
      pollInterval: 50,
      maxWait: 5000,
    });
    // Check that consecutive polls are at least pollInterval apart
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(45); // allow small timing drift
    }
  });

  it('accepts default options', async () => {
    const listTargets = vi.fn().mockResolvedValue([makeTarget('DEFAULT')]);
    // Using all defaults: stableThreshold=750, pollInterval=100, maxWait=10000
    const result = await waitForRendererStable(listTargets);
    expect(result.id).toBe('DEFAULT');
  });

  it('uses pickPageTarget logic: prefers type=page', async () => {
    const listTargets = vi.fn().mockResolvedValue([
      { id: 'worker-1', type: 'service_worker', url: 'chrome-extension://...' },
      { id: 'page-1', type: 'page', url: 'http://localhost:3000/' },
    ]);
    const result = await waitForRendererStable(listTargets, {
      stableThreshold: 30,
      pollInterval: 10,
      maxWait: 5000,
    });
    expect(result.id).toBe('page-1');
  });

  it('accepts page-like target with missing type but http URL', async () => {
    const listTargets = vi
      .fn()
      .mockResolvedValue([{ id: 'no-type', url: 'http://localhost:8080/app' }]);
    const result = await waitForRendererStable(listTargets, {
      stableThreshold: 30,
      pollInterval: 10,
      maxWait: 5000,
    });
    expect(result.id).toBe('no-type');
  });
});
