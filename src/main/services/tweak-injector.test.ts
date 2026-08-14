// SPDX-License-Identifier: MPL-2.0

/**
 * # Tweak Injector Tests
 *
 * Covers the three public APIs (`pushTweak`, `saveTweakAsCustomCss`, `resetTweak`)
 * and the internal `resolveSessionForPort` helper.
 *
 * ## Isolation strategy
 *
 * - `injectCssLayer` (from `cdp/injection/shared`) is mocked to verify layer
 *   name and CSS content without actually evaluating CDP expressions.
 * - `connectCdp` (from `cdp/cdp-client`) is mocked to return a controllable
 *   session — because `resolveSessionForPort` calls `connectCdp` internally,
 * *   we can't mock `resolveSessionForPort` itself (same-module function calls
 *   bypass module export mocking).
 * - `global.fetch` is mocked to control CDP target discovery (`/json/list`).
 * - `SettingsService` is replaced with a minimal fake implementing the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from '../cdp/cdp-client';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockInjectCssLayer = vi.fn<
  (session: CdpSession, layerName: string, css: string) => Promise<boolean>
>();

const mockConnectCdp = vi.fn<(url: string) => Promise<CdpSession>>();

vi.mock('../cdp/injection/shared', () => ({
  injectCssLayer: (...args: unknown[]) =>
    mockInjectCssLayer(...args as [CdpSession, string, string]),
}));

vi.mock('../cdp/cdp-client', () => ({
  connectCdp: (...args: unknown[]) => mockConnectCdp(...args as [string]),
}));

// ---------------------------------------------------------------------------
// Re-import after mocks are declared
// ---------------------------------------------------------------------------

import {
  pushTweak,
  saveTweakAsCustomCss,
  resetTweak,
  type TweakSession,
} from './tweak-injector';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fakeSession: CdpSession = {
  // Cast through unknown to reconcile vi.fn() (returns Promise<unknown>)
  // with the generic send<T> signature on CdpSession.
  send: vi.fn<(m: string, p?: Record<string, unknown>) => Promise<unknown>>() as unknown as CdpSession['send'],
  evaluate: vi.fn<(expr: string) => Promise<string>>(),
  close: vi.fn<() => void>(),
};

function makeSession(overrides: Partial<TweakSession> = {}): TweakSession {
  return {
    agentId: 'traework',
    port: 9336,
    overrides: { radius: '8px', accent: '#3b82f6' },
    dirty: true,
    ...overrides,
  };
}

const mockSettings = {
  customThemeCss: vi.fn<() => string>(),
  setCustomThemeCss: vi.fn<(css: string) => Promise<void>>(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tweak-injector', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    // Default: successful target discovery + CDP session + injection
    globalThis.fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            type: 'page',
            id: 'abc123',
            url: 'https://localhost:3000',
            title: 'traework',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc123',
          },
        ]),
        { status: 200 },
      ),
    );
    mockConnectCdp.mockResolvedValue(fakeSession);
    mockInjectCssLayer.mockResolvedValue(true);
    mockSettings.customThemeCss.mockReturnValue('');
    mockSettings.setCustomThemeCss.mockResolvedValue();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  // ========================================================================
  // pushTweak
  // ========================================================================
  describe('pushTweak', () => {
    it('returns true when CDP session resolves and injection succeeds', async () => {
      const session = makeSession({ overrides: { radius: '12px', spacing: 8 } });
      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9336/json/list',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(mockConnectCdp).toHaveBeenCalledWith(
        'ws://127.0.0.1:9336/devtools/page/abc123',
        2000,
        3000,
      );
      expect(mockInjectCssLayer).toHaveBeenCalledTimes(1);

      const [argSession, argLayer, argCss] = mockInjectCssLayer.mock.calls[0];
      expect(argSession).toBe(fakeSession);
      expect(argLayer).toBe('workspace-tweak');
      expect(argCss).toContain('--as-radius:12px');
      expect(argCss).toContain('--as-spacing:8px');
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns false when CDP target discovery fails (fetch rejects)', async () => {
      globalThis.fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(
        new Error('ECONNREFUSED'),
      );
      const session = makeSession();

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(mockConnectCdp).not.toHaveBeenCalled();
      expect(mockInjectCssLayer).not.toHaveBeenCalled();
    });

    it('returns false when port has no page target', async () => {
      globalThis.fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify([
            { type: 'service_worker', id: 'sw1', url: 'https://localhost/sw.js' },
          ]),
          { status: 200 },
        ),
      );
      const session = makeSession();

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(mockConnectCdp).not.toHaveBeenCalled();
    });

    it('returns false when connectCdp throws', async () => {
      mockConnectCdp.mockRejectedValue(new Error('WebSocket open timeout'));
      const session = makeSession();

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(mockInjectCssLayer).not.toHaveBeenCalled();
    });

    it('returns false when injectCssLayer reports failure', async () => {
      mockInjectCssLayer.mockResolvedValue(false);
      const session = makeSession();

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns false and still closes session when injectCssLayer throws', async () => {
      mockInjectCssLayer.mockRejectedValue(new Error('CDP timeout'));
      const session = makeSession();

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns false early when overrides produce no CSS (skips CDP lookup)', async () => {
      const session = makeSession({ overrides: {} });

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockConnectCdp).not.toHaveBeenCalled();
    });

    it('always uses the workspace-tweak layer name (independent of theme layer)', async () => {
      const session = makeSession();
      await pushTweak(session, { fontSize: 14 });

      expect(mockInjectCssLayer).toHaveBeenCalledTimes(1);
      expect(mockInjectCssLayer.mock.calls[0][1]).toBe('workspace-tweak');
    });
  });

  // ========================================================================
  // saveTweakAsCustomCss
  // ========================================================================
  describe('saveTweakAsCustomCss', () => {
    it('persists overrides as CSS and marks dirty = false', async () => {
      const session = makeSession({
        overrides: { radius: '6px', background: '#1e1e1e', foreground: '#e0e0e0' },
        dirty: true,
      });

      const result = await saveTweakAsCustomCss(session, mockSettings as never);

      expect(result).toBe(true);
      expect(session.dirty).toBe(false);
      expect(mockSettings.customThemeCss).toHaveBeenCalled();
      expect(mockSettings.setCustomThemeCss).toHaveBeenCalledTimes(1);

      const savedCss = mockSettings.setCustomThemeCss.mock.calls[0][0];
      expect(savedCss).toContain('--as-radius:6px');
      expect(savedCss).toContain('--as-bg:#1e1e1e');
      expect(savedCss).toContain('--as-fg:#e0e0e0');
      expect(savedCss).toContain('AgentSkin: workspace tweak');
    });

    it('appends to existing customThemeCss (preserving prior content)', async () => {
      mockSettings.customThemeCss.mockReturnValue('/* prior CSS */ .foo{color:red}');
      const session = makeSession({ overrides: { accent: '#ff0000' } });

      const result = await saveTweakAsCustomCss(session, mockSettings as never);

      expect(result).toBe(true);
      const savedCss = mockSettings.setCustomThemeCss.mock.calls[0][0];
      expect(savedCss).toContain('/* prior CSS */ .foo{color:red}');
      expect(savedCss).toContain('--as-accent:#ff0000');
      // New block is after the existing content
      expect(savedCss.indexOf('/* prior CSS */')).toBeLessThan(
        savedCss.indexOf('AgentSkin: workspace tweak'),
      );
    });

    it('returns false when overrides produce no CSS', async () => {
      const session = makeSession({ overrides: {} });

      const result = await saveTweakAsCustomCss(session, mockSettings as never);

      expect(result).toBe(false);
      expect(mockSettings.setCustomThemeCss).not.toHaveBeenCalled();
    });

    it('does not mutate dirty when save is a no-op (empty CSS)', async () => {
      const session = makeSession({ overrides: {}, dirty: true });

      await saveTweakAsCustomCss(session, mockSettings as never);

      expect(session.dirty).toBe(true);
    });
  });

  // ========================================================================
  // resetTweak
  // ========================================================================
  describe('resetTweak', () => {
    it('clears the workspace-tweak layer by injecting empty CSS', async () => {
      const result = await resetTweak('traework', 9336);

      expect(result).toBe(true);
      expect(mockInjectCssLayer).toHaveBeenCalledTimes(1);
      const [, argLayer, argCss] = mockInjectCssLayer.mock.calls[0];
      expect(argLayer).toBe('workspace-tweak');
      expect(argCss).toBe('');
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns false when CDP session cannot be resolved', async () => {
      globalThis.fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      const result = await resetTweak('traework', 9336);

      expect(result).toBe(false);
      expect(mockInjectCssLayer).not.toHaveBeenCalled();
    });

    it('returns false and still closes session when injectCssLayer throws', async () => {
      mockInjectCssLayer.mockRejectedValue(new Error('socket closed'));

      const result = await resetTweak('traework', 9336);

      expect(result).toBe(false);
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });

    it('returns false when injectCssLayer reports failure', async () => {
      mockInjectCssLayer.mockResolvedValue(false);

      const result = await resetTweak('workbuddy', 9337);

      expect(result).toBe(false);
      expect(fakeSession.close).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // Edge cases — CSS generation
  // ========================================================================
  describe('CSS generation edge cases', () => {
    it('handles all numeric override fields without error', async () => {
      const session = makeSession({
        overrides: {
          spacing: 16,
          blurPx: 4,
          fontSize: 13,
          borderWidth: 1,
          lineHeight: 1.5,
          radius: '2px',
          accent: '#000',
          background: '#fff',
          foreground: '#111',
          surface: '#ccc',
        },
      });

      const result = await pushTweak(session, session.overrides);

      expect(result).toBe(true);
      const css = mockInjectCssLayer.mock.calls[0][2];
      expect(css).toContain('--as-spacing:16px');
      expect(css).toContain('--as-blur:blur(4px)');
      expect(css).toContain('--as-fontsize:13px');
      expect(css).toContain('--as-border:1px');
      expect(css).toContain('--as-lh:1.5');
    });

    it('produces a valid :root{} CSS wrapper', async () => {
      const session = makeSession({ overrides: { radius: '4px' } });

      await pushTweak(session, session.overrides);

      const css = mockInjectCssLayer.mock.calls[0][2];
      expect(css.startsWith(':root{')).toBe(true);
      expect(css.endsWith('}')).toBe(true);
      expect(css).toMatch(/^\:root\{--as\-radius:4px\}$/);
    });

    it('shadowLevel "none" produces no --as-shadow property', async () => {
      const session = makeSession({
        overrides: { shadowLevel: 'none', radius: '2px' },
      });

      await pushTweak(session, session.overrides);

      const css = mockInjectCssLayer.mock.calls[0][2];
      expect(css).not.toContain('--as-shadow');
      expect(css).toContain('--as-radius:2px');
    });

    it('shadowLevel "md" maps to correct shadow value', async () => {
      const session = makeSession({ overrides: { shadowLevel: 'md' } });

      await pushTweak(session, session.overrides);

      const css = mockInjectCssLayer.mock.calls[0][2];
      expect(css).toContain('--as-shadow:0 4px 12px rgba(0,0,0,.22)');
    });

    it('separators: false pushes --as-sep:transparent', async () => {
      const session = makeSession({ overrides: { separators: false } });

      await pushTweak(session, session.overrides);

      const css = mockInjectCssLayer.mock.calls[0][2];
      expect(css).toContain('--as-sep:transparent');
    });

    it('does not inject CSS for preview-only fields (scale, invert, contrast)', async () => {
      const session = makeSession({
        overrides: { scale: 1.2, invert: true, contrast: 1.5, saturate: 0.8 },
      });

      // These fields are intentionally not in the simplified overridesToCss
      const result = await pushTweak(session, session.overrides);

      // All fields produce no CSS → pushTweak returns false early
      expect(result).toBe(false);
    });
  });
});
