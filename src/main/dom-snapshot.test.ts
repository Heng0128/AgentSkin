// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const connectCdp = vi.fn();
const findDomTargets = vi.fn();

vi.mock('./cdp/cdp-client', () => ({
  connectCdp: (...args: unknown[]) => connectCdp(...args),
}));
vi.mock('./cdp/cdp-targets', () => ({
  findDomTargets: (...args: unknown[]) => findDomTargets(...args),
}));

const { snapshotDom } = await import('./dom-snapshot');

// ---------------------------------------------------------------------------
// Fake CDP session
// ---------------------------------------------------------------------------

interface FakeSessionConfig {
  /** Controls the DOM walk result. */
  walkResult?: string | null;
  /** Controls the URL result. */
  urlResult?: string;
  /** Throw on connect. */
  failConnect?: boolean;
  /** Throw on walk evaluate. */
  failWalk?: boolean;
}

function makeFakeSession(config: FakeSessionConfig = {}) {
  const sent: Array<{ method: string; params?: unknown }> = [];

  const session = {
    sent,
    send: vi.fn(async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const expr = (params as { expression?: string })?.expression ?? '';
        // URL probe
        if (expr.includes('window.location.href')) {
          return { result: { value: config.urlResult ?? 'https://app.example.com/chat' } };
        }
        // Walk expression (contains 'buildCandidates' or 'walk')
        if (expr.includes('walk') && expr.includes('buildCandidates')) {
          if (config.failWalk) throw new Error('walk failed');
          return { result: { value: config.walkResult ?? null } };
        }
        // Landmark probe (contains 'querySelectorAll')
        if (expr.includes('querySelectorAll')) {
          return {
            result: {
              value: JSON.stringify([
                {
                  selector: '.panel-container',
                  matched: true,
                  count: 1,
                  boundingBox: { x: 0, y: 0, width: 100, height: 50 },
                },
                { selector: '.nonexistent', matched: false, count: 0 },
              ]),
            },
          };
        }
      }
      return {};
    }),
    close: vi.fn(),
  };
  return session;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('snapshotDom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no DOM targets are found', async () => {
    findDomTargets.mockResolvedValue([]);

    const result = await snapshotDom('traework', 9336);

    expect(result).toBeNull();
    expect(connectCdp).not.toHaveBeenCalled();
  });

  it('returns null when target has no webSocketDebuggerUrl', async () => {
    findDomTargets.mockResolvedValue([{ type: 'page', webSocketDebuggerUrl: null }]);

    const result = await snapshotDom('traework', 9336);

    expect(result).toBeNull();
    expect(connectCdp).not.toHaveBeenCalled();
  });

  it('returns null when connect fails', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockRejectedValue(new Error('connection refused'));

    const result = await snapshotDom('traework', 9336);

    expect(result).toBeNull();
  });

  it('captures a valid DOM snapshot with elements and landmarks', async () => {
    const walkData = {
      elements: [
        {
          selector: '#app',
          tagName: 'div',
          classNames: ['app-root'],
          boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
          computedStyle: { display: 'flex', 'background-color': 'rgb(255, 255, 255)' },
          isVisible: true,
          selectorCandidates: [
            { selector: '#app', kind: 'id', unique: true },
            { selector: '.app-root', kind: 'class', unique: false },
          ],
          depth: 0,
          childCount: 3,
        },
        {
          selector: '.chat-input',
          tagName: 'textarea',
          classNames: ['chat-input'],
          boundingBox: { x: 100, y: 900, width: 800, height: 40 },
          computedStyle: { display: 'block', color: 'rgb(0, 0, 0)' },
          isVisible: true,
          selectorCandidates: [{ selector: '.chat-input', kind: 'class', unique: false }],
          depth: 1,
          childCount: 0,
        },
      ],
      totalWalked: 2,
    };

    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: JSON.stringify(walkData),
        urlResult: 'https://app.example.com/chat?session=abc#section',
      }),
    );

    const result = await snapshotDom('traework', 9336);

    expect(result).not.toBeNull();
    expect(result?.adapter).toBe('traework');
    expect(result?.elements).toHaveLength(2);
    expect(result?.totalWalked).toBe(2);
    expect(result?.url).toBe('https://app.example.com/chat'); // query + hash stripped
    expect(result?.elements[0].tagName).toBe('div');
    expect(result?.elements[0].selector).toBe('#app');
    expect(result?.elements[0].isVisible).toBe(true);
    expect(result?.elements[0].selectorCandidates).toHaveLength(2);
    expect(result?.elements[0].depth).toBe(0);
    expect(result?.elements[1].childCount).toBe(0);
    expect(result?.landmarks.length).toBeGreaterThan(0);
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result?.timestamp).toBeGreaterThan(0);
  });

  it('strips query and hash from URL', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
        urlResult: 'https://app.example.com/path?key=value#hash',
      }),
    );

    const result = await snapshotDom('doubao', 9336);

    expect(result?.url).toBe('https://app.example.com/path');
  });

  it('handles walk failure gracefully (returns empty elements)', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        failWalk: true,
      }),
    );

    const result = await snapshotDom('traework', 9336);

    // Walk failed but the function should still return a snapshot (with empty elements)
    // because the walk error is caught inside the try block
    expect(result).not.toBeNull();
  });

  it('respects maxElements option', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({
      walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
    });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('traework', 9336, { maxElements: 500 });

    // Verify the walk expression includes the custom maxElements
    const walkCall = session.sent.find(
      (s) =>
        s.method === 'Runtime.evaluate' &&
        (s.params as { expression?: string })?.expression?.includes('MAX_EL = 500'),
    );
    expect(walkCall).toBeDefined();
  });

  it('respects maxDepth option', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({
      walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
    });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('traework', 9336, { maxDepth: 6 });

    const walkCall = session.sent.find(
      (s) =>
        s.method === 'Runtime.evaluate' &&
        (s.params as { expression?: string })?.expression?.includes('MAX_DEPTH = 6'),
    );
    expect(walkCall).toBeDefined();
  });

  it('closes session in finally block', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({
      walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
    });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('traework', 9336);

    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes session even on walk error', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({ failWalk: true });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('traework', 9336);

    expect(session.close).toHaveBeenCalledOnce();
  });

  it('includes extra landmarks in probe', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({
      walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
    });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('traework', 9336, { extraLandmarks: ['.custom-landmark'] });

    // The landmark expression should include the extra selector
    const lmCall = session.sent.find(
      (s) =>
        s.method === 'Runtime.evaluate' &&
        (s.params as { expression?: string })?.expression?.includes('.custom-landmark'),
    );
    expect(lmCall).toBeDefined();
  });

  it('uses adapter-specific landmark selectors', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    const session = makeFakeSession({
      walkResult: JSON.stringify({ elements: [], totalWalked: 0 }),
    });
    connectCdp.mockResolvedValue(session);

    await snapshotDom('doubao', 9336);

    // The landmark expression should include doubao-specific selectors
    const lmCall = session.sent.find(
      (s) =>
        s.method === 'Runtime.evaluate' &&
        (s.params as { expression?: string })?.expression?.includes('.main-container'),
    );
    expect(lmCall).toBeDefined();
  });

  it('handles malformed walk result gracefully', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: 'not-valid-json',
      }),
    );

    const result = await snapshotDom('traework', 9336);

    // Should still return a snapshot with empty elements
    expect(result).not.toBeNull();
    expect(result?.elements).toEqual([]);
  });

  it('handles null walk result gracefully', async () => {
    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: null,
      }),
    );

    const result = await snapshotDom('traework', 9336);

    expect(result).not.toBeNull();
    expect(result?.elements).toEqual([]);
  });

  it('captures computed style subset correctly', async () => {
    const walkData = {
      elements: [
        {
          selector: '.panel',
          tagName: 'div',
          classNames: ['panel'],
          boundingBox: { x: 10, y: 20, width: 300, height: 400 },
          computedStyle: {
            display: 'flex',
            'background-color': 'rgb(30, 30, 30)',
            'border-radius': '8px',
            'flex-direction': 'column',
          },
          isVisible: true,
          selectorCandidates: [{ selector: '.panel', kind: 'class', unique: false }],
          depth: 0,
          childCount: 2,
        },
      ],
      totalWalked: 1,
    };

    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: JSON.stringify(walkData),
      }),
    );

    const result = await snapshotDom('traework', 9336);

    expect(result?.elements[0].computedStyle.display).toBe('flex');
    expect(result?.elements[0].computedStyle['background-color']).toBe('rgb(30, 30, 30)');
    expect(result?.elements[0].computedStyle['border-radius']).toBe('8px');
  });

  it('marks elements with display:none as not visible', async () => {
    const walkData = {
      elements: [
        {
          selector: '.hidden',
          tagName: 'div',
          classNames: ['hidden'],
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          computedStyle: { display: 'none' },
          isVisible: false,
          selectorCandidates: [{ selector: '.hidden', kind: 'class', unique: false }],
          depth: 0,
          childCount: 0,
        },
      ],
      totalWalked: 1,
    };

    findDomTargets.mockResolvedValue([
      { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/abc' },
    ]);
    connectCdp.mockResolvedValue(
      makeFakeSession({
        walkResult: JSON.stringify(walkData),
      }),
    );

    const result = await snapshotDom('traework', 9336);

    expect(result?.elements[0].isVisible).toBe(false);
  });
});
