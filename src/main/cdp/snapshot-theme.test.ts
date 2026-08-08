// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CssMatchedRule, NodeCascade } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const connectCdp = vi.fn();
const findDomTargets = vi.fn();
const captureDomTree = vi.fn();
const captureNodeCascade = vi.fn();
const compactStylesFromComputed = vi.fn();

vi.mock('./cdp-client', () => ({
  connectCdp: (...args: unknown[]) => connectCdp(...args),
}));
vi.mock('./cdp-targets', () => ({
  findDomTargets: (...args: unknown[]) => findDomTargets(...args),
}));
vi.mock('./dom-tree', () => ({
  captureDomTree: (...args: unknown[]) => captureDomTree(...args),
}));
vi.mock('./node-cascade', () => ({
  captureNodeCascade: (...args: unknown[]) => captureNodeCascade(...args),
  compactStylesFromComputed: (...args: unknown[]) => compactStylesFromComputed(...args),
}));

const { snapshotThemeVisuals } = await import('./snapshot-theme');

// ---------------------------------------------------------------------------
// Fake CDP session
// ---------------------------------------------------------------------------

interface SessionOptions {
  /** Controls the theme-readiness probe (--agentskin-accent). Non-empty breaks the poll. */
  accentValue?: string;
  /** Throw on DOM.enable to force the Runtime.evaluate fallback path. */
  failDomEnable?: boolean;
  /** Per-method custom responses (takes precedence over defaults). */
  sendOverrides?: Record<string, (params: unknown) => unknown>;
}

function makeSession(opts: SessionOptions = {}) {
  const sent: Array<{ method: string; params?: unknown }> = [];
  const session = {
    sent,
    evaluate: vi.fn(async () => opts.accentValue ?? '#ff3b30'),
    send: vi.fn(async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (opts.failDomEnable && method === 'DOM.enable') throw new Error('dom domain blocked');
      const override = opts.sendOverrides?.[method];
      if (override) return override(params);
      switch (method) {
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: 10 };
        case 'DOM.describeNode':
          return { node: { localName: 'div', nodeName: 'DIV' } };
        default:
          return {};
      }
    }),
    close: vi.fn(),
  };
  return session;
}

function makeCascade(display = 'flex'): NodeCascade {
  return {
    computed: [
      { property: 'display', value: display },
      { property: 'opacity', value: '1' },
    ],
    matchedRules: [
      { selector: '.panel', origin: 'regular', source: 'agentskin', declarations: [] },
    ] as CssMatchedRule[],
    platformFonts: [],
    boxModel: { width: 100, height: 50, left: 0, top: 0 },
  };
}

function makeDeps() {
  return {
    adapter: vi.fn().mockReturnValue(null),
    applyTheme: vi.fn().mockResolvedValue({ ok: true }),
    findPortForAgent: vi.fn().mockResolvedValue(9336),
    log: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('snapshotThemeVisuals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectCdp.mockImplementation(async () => makeSession());
    findDomTargets.mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools' }]);
    captureDomTree.mockResolvedValue({
      tag: 'body',
      cls: '',
      style: { display: 'flex' },
      rect: { w: 0, h: 0, x: 0, y: 0 },
      children: [],
    });
    captureNodeCascade.mockResolvedValue(makeCascade());
    compactStylesFromComputed.mockImplementation((computed) => computed);
  });

  it('throws when the agent has no debug port', async () => {
    const deps = makeDeps();
    deps.findPortForAgent.mockResolvedValue(null);
    await expect(snapshotThemeVisuals('traework', undefined, deps as never)).rejects.toThrow(
      /No debug port/,
    );
  });

  it('throws when no DOM-bearing CDP target is available', async () => {
    findDomTargets.mockResolvedValue([]);
    await expect(snapshotThemeVisuals('traework', undefined, makeDeps() as never)).rejects.toThrow(
      /No DOM-bearing CDP targets/,
    );
  });

  it('captures the live interface when no theme is applied (protocol path)', async () => {
    const deps = makeDeps();
    const result = await snapshotThemeVisuals('traework', undefined, deps as never, {
      extraSelectors: ['.custom-pin'],
    });

    expect(deps.applyTheme).not.toHaveBeenCalled();
    expect(captureNodeCascade).toHaveBeenCalled();
    expect(compactStylesFromComputed).toHaveBeenCalled();
    expect(captureDomTree).toHaveBeenCalled();
    expect(result.agentId).toBe('traework');
    expect(result.themeId).toBe('');
    // Default landmarks + the extra pinned selector
    expect(result.summary.totalLandmarks).toBeGreaterThan(0);
    expect(result.landmarks.length).toBeGreaterThan(0);
    expect(result.domTree).toBeTruthy();
    expect(result.summary.boxModelAvailable).toBe(true);
    expect(result.summary.cascadeAvailable).toBe(true);
  });

  it('applies the theme first and waits for the accent token before capturing', async () => {
    const deps = makeDeps();
    const session = makeSession({ accentValue: '#ff3b30' });
    connectCdp.mockResolvedValue(session);

    await snapshotThemeVisuals('traework', 'amber-dusk', deps as never);

    expect(deps.applyTheme).toHaveBeenCalledWith({ themeId: 'amber-dusk', appId: 'traework' });
    expect(session.evaluate).toHaveBeenCalledWith(expect.stringContaining('--agentskin-accent'));
    // 250ms cap applies to live captures; themed captures poll until accent appears.
    expect(findDomTargets).toHaveBeenCalled();
  });

  it('degrades to the Runtime.evaluate fallback when DOM/CSS domains are blocked', async () => {
    const session = makeSession({ failDomEnable: true });
    connectCdp.mockResolvedValue(session);
    session.send.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'DOM.enable') throw new Error('dom domain blocked');
      if (method === 'Runtime.evaluate') {
        const expr = (params as { expression?: string }).expression ?? '';
        if (expr.includes('classList')) {
          return { result: { value: { tag: 'div', classList: 'panel', exists: true } } };
        }
        return {
          result: {
            value: {
              styles: { display: 'flex' },
              boxModel: { width: 100, height: 50, left: 0, top: 0 },
              visible: true,
            },
          },
        };
      }
      return {};
    });
    const deps = makeDeps();

    const result = await snapshotThemeVisuals('traework', undefined, deps as never);

    expect(result.landmarks.length).toBeGreaterThan(0);
    expect(result.landmarks[0]).toMatchObject({ tag: 'div', visible: true });
    expect(result.summary.boxModelAvailable).toBe(false);
    expect(result.summary.cascadeAvailable).toBe(false);
  });

  it('skips landmarks that do not exist in the DOM', async () => {
    const session = makeSession({
      sendOverrides: {
        'DOM.querySelector': () => ({}), // no nodeId → landmark skipped
      },
    });
    connectCdp.mockResolvedValue(session);
    const result = await snapshotThemeVisuals('traework', undefined, makeDeps() as never);
    expect(result.landmarks).toEqual([]);
    expect(result.summary.visibleLandmarks).toBe(0);
  });

  it('captures light/dark scheme variants when requested', async () => {
    const session = makeSession();
    connectCdp.mockResolvedValue(session);
    await snapshotThemeVisuals('traework', undefined, makeDeps() as never, {
      captureSchemes: true,
    });

    const methods = session.sent.map((s) => s.method);
    expect(methods).toContain('Emulation.enable');
    // light + dark capture, then the reset to no emulation
    expect(methods.filter((m) => m === 'Emulation.setEmulatedMedia')).toHaveLength(3);
  });

  it('does not crash when the DOM tree capture fails', async () => {
    captureDomTree.mockRejectedValue(new Error('walk failed'));
    const deps = makeDeps();
    const result = await snapshotThemeVisuals('traework', undefined, deps as never);
    expect(result.domTree).toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('domTree capture failed'));
  });

  it('propagates apply failures with a descriptive log', async () => {
    const deps = makeDeps();
    deps.applyTheme.mockRejectedValue(new Error('apply boom'));
    await expect(snapshotThemeVisuals('traework', 'amber-dusk', deps as never)).rejects.toThrow(
      'apply boom',
    );
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('apply failed'));
  });
});
