// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { WALLPAPER_DATA_URL_GLOBAL } from '../../shared/injection-constants';
import type { CdpSession } from './cdp-client';
import {
  bypassPageCsp,
  evaluateWithRetry,
  injectVideoWallpaperByBase64,
} from './cdp-wallpaper-inject';

// ---------------------------------------------------------------------------
// Mock CdpSession factory — creates a session whose `evaluate` can be
// programmed to fail N times before succeeding, or to always fail.
// ---------------------------------------------------------------------------

interface MockSessionOptions {
  /** Number of times evaluate should fail before succeeding (0 = always succeed). */
  failCount?: number;
  /** Error message to throw on failure. */
  errorMessage?: string;
  /** Whether the error is a renderer exception (should NOT be retried). */
  isRendererError?: boolean;
}

function createMockSession(opts: MockSessionOptions = {}): CdpSession & {
  evaluateCalls: number;
} {
  let calls = 0;
  const failCount = opts.failCount ?? 0;
  const errorMessage = opts.errorMessage ?? 'CDP request timed out: Runtime.evaluate';
  const isRenderer = opts.isRendererError ?? false;

  const session: CdpSession & { evaluateCalls: number } = {
    evaluateCalls: 0,
    send: (async () => ({})) as CdpSession['send'],
    evaluate: async () => {
      calls++;
      session.evaluateCalls = calls;
      if (calls <= failCount) {
        if (isRenderer) {
          throw new Error(`Renderer evaluation failed: ${errorMessage}`);
        }
        throw new Error(errorMessage);
      }
      return 'ok';
    },
    close: () => {},
  };
  return session;
}

// ---------------------------------------------------------------------------
// Mock CdpSession for bypassPageCsp — allows programming send/evaluate
// failures independently to test each CSP bypass layer.
// ---------------------------------------------------------------------------

interface BypassMockOptions {
  /** If true, session.send throws (simulates Page.setBypassCSP unsupported). */
  sendFails?: boolean;
  /** If true, session.evaluate throws (simulates detached session). */
  evaluateFails?: boolean;
  /** Value returned by evaluate for the Layer 3 CSP probe. */
  probeResult?: string;
}

function createBypassMockSession(opts: BypassMockOptions = {}): CdpSession & {
  sendCalls: string[];
  evaluateCalls: number;
} {
  const sendCalls: string[] = [];
  let evaluateCalls = 0;

  const session: CdpSession & { sendCalls: string[]; evaluateCalls: number } = {
    sendCalls,
    evaluateCalls: 0,
    send: async <T = unknown>(method: string): Promise<T> => {
      sendCalls.push(method);
      if (opts.sendFails) throw new Error('Not supported on this target');
      return {} as T;
    },
    evaluate: async () => {
      evaluateCalls++;
      session.evaluateCalls = evaluateCalls;
      if (opts.evaluateFails) throw new Error('evaluate failed');
      // First evaluate call is Layer 2 (CSP meta removal) → returns 'csp-meta-removed'
      // Second evaluate call is Layer 3 (CSP probe) → returns probeResult
      if (evaluateCalls === 1) return 'csp-meta-removed';
      return opts.probeResult ?? 'no-meta-csp';
    },
    close: () => {},
  };
  return session;
}

// ---------------------------------------------------------------------------
// evaluateWithRetry — retry behavior
// ---------------------------------------------------------------------------

describe('evaluateWithRetry', () => {
  it('succeeds on first attempt without retry', async () => {
    const session = createMockSession({ failCount: 0 });
    const result = await evaluateWithRetry(session, '1+1', 'test');
    expect(result).toBe('ok');
    expect(session.evaluateCalls).toBe(1);
  });

  it('retries on timeout error and succeeds', async () => {
    // Fail once with a timeout error, then succeed
    const session = createMockSession({
      failCount: 1,
      errorMessage: 'CDP request timed out: Runtime.evaluate',
    });
    const result = await evaluateWithRetry(session, '1+1', 'test');
    expect(result).toBe('ok');
    // 1 failed attempt + 1 successful attempt = 2 calls
    expect(session.evaluateCalls).toBe(2);
  });

  it('retries on WebSocket closed error and succeeds', async () => {
    const session = createMockSession({
      failCount: 1,
      errorMessage: 'CDP WebSocket closed unexpectedly',
    });
    const result = await evaluateWithRetry(session, '1+1', 'test');
    expect(result).toBe('ok');
    expect(session.evaluateCalls).toBe(2);
  });

  it('does NOT retry on renderer exceptions (rethrows immediately)', async () => {
    const session = createMockSession({
      failCount: 1,
      errorMessage: 'TypeError: Cannot read properties of undefined',
      isRendererError: true,
    });
    await expect(evaluateWithRetry(session, '1+1', 'test')).rejects.toThrow(
      'Renderer evaluation failed',
    );
    // Should have been called exactly once — no retry
    expect(session.evaluateCalls).toBe(1);
  });

  it('throws after exhausting all retries on persistent timeout', async () => {
    // Fail more times than max retries (2 retries = 3 total attempts)
    const session = createMockSession({
      failCount: 99,
      errorMessage: 'CDP request timed out: Runtime.evaluate',
    });
    await expect(evaluateWithRetry(session, '1+1', 'test')).rejects.toThrow(
      'CDP request timed out',
    );
    // 1 initial + 2 retries = 3 total attempts
    expect(session.evaluateCalls).toBe(3);
  });

  it('respects CHUNK_EVAL_MAX_RETRIES (3 total attempts for 2 retries)', async () => {
    // Fail exactly 2 times (within retry budget), succeed on 3rd
    const session = createMockSession({
      failCount: 2,
      errorMessage: 'CDP request timed out: Runtime.evaluate',
    });
    const result = await evaluateWithRetry(session, '1+1', 'test');
    expect(result).toBe('ok');
    // 2 failed + 1 success = 3 calls
    expect(session.evaluateCalls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// bypassPageCsp — three-layer CSP bypass behavior
// ---------------------------------------------------------------------------

describe('bypassPageCsp', () => {
  it('returns true when Layer 1 (Page.setBypassCSP) succeeds', async () => {
    const session = createBypassMockSession({ sendFails: false });
    const result = await bypassPageCsp(session);
    expect(result).toBe(true);
    // Layer 1 sends Page.enable + Page.setBypassCSP
    expect(session.sendCalls).toContain('Page.enable');
    expect(session.sendCalls).toContain('Page.setBypassCSP');
  });

  it('returns true when Layer 1 fails but Layer 2 (evaluate) succeeds', async () => {
    const session = createBypassMockSession({
      sendFails: true,
      evaluateFails: false,
    });
    const result = await bypassPageCsp(session);
    expect(result).toBe(true);
    // Layer 1 send failed, but Layer 2 evaluate succeeded → anySucceeded
    expect(session.evaluateCalls).toBeGreaterThanOrEqual(1);
  });

  it('returns false when ALL layers fail (send + evaluate both throw)', async () => {
    // This is the critical regression test: previously, Layer 3 falsely set
    // anySucceeded=true, causing bypassPageCsp to return true even when no
    // real bypass was applied. The fix removes that false flag, so when all
    // real bypass layers fail, the function correctly returns false.
    const session = createBypassMockSession({
      sendFails: true,
      evaluateFails: true,
    });
    const result = await bypassPageCsp(session);
    expect(result).toBe(false);
  });

  it('does NOT set anySucceeded from Layer 3 diagnostic probe', async () => {
    // Layer 3 is a diagnostic probe only — it must not affect the return
    // value. When Layer 1 fails and Layer 2 fails but Layer 3 probe
    // succeeds, the function should still return false because no real
    // bypass was applied.
    // To test this: Layer 1 fails (sendFails), Layer 2 fails (first
    // evaluate throws), but we need Layer 3 to succeed. We need a custom
    // mock where the first evaluate fails but the second succeeds.
    let evalCalls = 0;
    const session: CdpSession & { sendCalls: string[] } = {
      sendCalls: [],
      send: async <T = unknown>(method: string): Promise<T> => {
        (session as { sendCalls: string[] }).sendCalls.push(method);
        throw new Error('Not supported');
      },
      evaluate: async () => {
        evalCalls++;
        if (evalCalls === 1) throw new Error('Layer 2 failed');
        // Layer 3 probe succeeds
        return 'no-meta-csp';
      },
      close: () => {},
    };
    const result = await bypassPageCsp(session);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// injectVideoWallpaperByBase64 — chunked base64 transfer + engine mount
// ---------------------------------------------------------------------------
//
// The base64 path reads the file in Node, then transfers the base64 in 512KB
// chunks via CDP evaluate (each chunk pushed to `window.__agentskinChunks`).
// Once all chunks arrive, an evaluate call joins them into `data:...` and
// stashes the result on WALLPAPER_DATA_URL_GLOBAL. The final mount call is a
// single `window.__agentskin__.wallpaper.applyVideo(...)` evaluate that hands
// the URL to the unified page engine — dramatically smaller than the old
// ~200-line inline JS expression, and reusing one mount routine for every
// wallpaper type (image/video/web).

describe('injectVideoWallpaperByBase64 — chunked transfer + engine mount', () => {
  it('transfers in chunks, assembles on global, then calls NS.wallpaper.applyVideo', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'wp-b64-'));
    const file = join(dir, 'clip.mp4');
    await writeFile(file, Buffer.from('fake-video-bytes-for-base64-transfer'));
    try {
      const expressions: string[] = [];
      const session: CdpSession = {
        send: (async () => ({})) as CdpSession['send'],
        evaluate: async (expression: string) => {
          expressions.push(expression);
          if (expression.includes('Content-Security-Policy')) return 'no-meta-csp';
          if (expression.includes(`window.${WALLPAPER_DATA_URL_GLOBAL} = 'data:`))
            return 'assembled';
          if (expression.includes('__agentskin__.wallpaper.applyVideo')) return 'ok';
          if (expression.includes('.push(')) return 'push';
          return 'ok';
        },
        close: () => {},
      };

      const result = await injectVideoWallpaperByBase64(session, { videoPath: file });
      expect(result.ok).toBe(true);

      // Must contain at least one chunk push, one assembly, and one
      // NS.wallpaper.applyVideo call (the new unified mount boundary).
      const pushes = expressions.filter((e) => e.includes('.push('));
      expect(pushes.length).toBeGreaterThan(0);
      const assembly = expressions.find((e) =>
        e.includes(`window.${WALLPAPER_DATA_URL_GLOBAL} = 'data:`),
      );
      expect(assembly).toBeDefined();
      expect(assembly!).not.toContain("return 'data:video/mp4");
      const mount = expressions.find((e) => e.includes('__agentskin__.wallpaper.applyVideo'));
      expect(mount).toBeDefined();
      expect(mount!).toContain('__agentskinWpDataUrl');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
