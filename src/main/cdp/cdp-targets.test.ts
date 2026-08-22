// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpTarget } from '../../legacy/agentskin-core-runtime';

// Mock listCdpTargets so listTargets/findPageTarget/findDomTargets/findSecondaryTargets
// can be tested without a real CDP endpoint.
vi.mock('../../legacy/agentskin-core-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../legacy/agentskin-core-runtime')>();
  return {
    ...actual,
    listCdpTargets: vi.fn(),
  };
});

// Import AFTER mock so the mocked module is in effect.
const { listCdpTargets } = await import('../../legacy/agentskin-core-runtime');
const {
  listTargets,
  findPageTarget,
  pickPageTarget,
  findDomTargets,
  findSecondaryTargets,
  clearTargetsCache,
} = await import('./cdp-targets');

// The per-port target-list cache is module-level — reset it between tests so
// a cached result from one test never bleeds into the next.
beforeEach(() => {
  clearTargetsCache();
  vi.clearAllMocks();
});

function makeTarget(overrides: Partial<CdpTarget> = {}): CdpTarget {
  return {
    id: 'target-1',
    type: 'page',
    url: 'http://localhost',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    title: 'Test',
    ...overrides,
  };
}

describe('pickPageTarget', () => {
  it('returns the first target with type "page" and a webSocketDebuggerUrl', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'worker-1', type: 'service_worker', url: 'sw.js' }),
      makeTarget({ id: 'page-1', type: 'page', url: 'http://localhost' }),
      makeTarget({ id: 'page-2', type: 'page', url: 'http://other' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('page-1');
  });

  it('skips page targets without webSocketDebuggerUrl', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'page-no-ws', type: 'page', webSocketDebuggerUrl: undefined }),
      makeTarget({ id: 'page-ok', type: 'page' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('page-ok');
  });

  it('accepts targets with undefined type when URL has http/https/file scheme', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'devtools', type: undefined, url: 'chrome-devtools://devtools' }),
      makeTarget({ id: 'http-page', type: undefined, url: 'https://app.example.com' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('http-page');
  });

  it('rejects undefined-type targets with non-page URLs (chrome-devtools, ws, devtools)', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'devtools', type: undefined, url: 'devtools://devtools/bundled' }),
      makeTarget({ id: 'ws', type: undefined, url: 'ws://127.0.0.1:9222' }),
      makeTarget({ id: 'chrome', type: undefined, url: 'chrome-devtools://devtools' }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('rejects undefined-type targets with empty or missing URL', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'no-url', type: undefined, url: '' }),
      makeTarget({ id: 'null-url', type: undefined, url: undefined }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('skips webview, iframe, and worker targets', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'shared_worker' }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(pickPageTarget([])).toBeUndefined();
  });

  it('handles null type like undefined type', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'null-type', type: null as unknown as undefined, url: 'http://localhost' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('null-type');
  });
});

describe('listTargets', () => {
  it('returns targets from listCdpTargets on success', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    const result = await listTargets(9222);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('target-1');
  });

  it('returns empty array when listCdpTargets throws', async () => {
    vi.mocked(listCdpTargets).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await listTargets(9222);
    expect(result).toEqual([]);
  });

  it('reuses the cached target list within the TTL window (one fetch)', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    const first = await listTargets(9222);
    const second = await listTargets(9222);
    expect(first).toHaveLength(1);
    expect(second).toBe(first); // same cached array
    expect(listCdpTargets).toHaveBeenCalledTimes(1);
  });

  it('does not cache an empty result (transient not-ready state is re-fetched)', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([]);
    await listTargets(9222);
    await listTargets(9222);
    expect(listCdpTargets).toHaveBeenCalledTimes(2);
  });

  it('clearTargetsCache invalidates the cached list', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    await listTargets(9222);
    clearTargetsCache();
    await listTargets(9222);
    expect(listCdpTargets).toHaveBeenCalledTimes(2);
  });
});

describe('findPageTarget', () => {
  it('returns the first page target', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
      makeTarget({ id: 'page', type: 'page' }),
    ]);
    const result = await findPageTarget(9222);
    expect(result?.id).toBe('page');
  });

  it('returns undefined when no page target exists', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findPageTarget(9222);
    expect(result).toBeUndefined();
  });
});

describe('findDomTargets', () => {
  it('returns page, webview, and iframe targets with webSocketDebuggerUrl', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'page', type: 'page' }),
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'shared_worker' }),
      makeTarget({ id: 'page-no-ws', type: 'page', webSocketDebuggerUrl: undefined }),
    ]);
    const result = await findDomTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['page', 'webview', 'iframe']);
  });

  it('returns empty array when no DOM targets exist', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findDomTargets(9222);
    expect(result).toEqual([]);
  });
});

describe('findSecondaryTargets', () => {
  it('returns only webview and iframe targets (excludes main page)', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'page', type: 'page' }),
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findSecondaryTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['webview', 'iframe']);
  });

  it('filters out webview/iframe targets without webSocketDebuggerUrl', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'webview-no-ws', type: 'webview', webSocketDebuggerUrl: undefined }),
      makeTarget({ id: 'iframe-ok', type: 'iframe' }),
    ]);
    const result = await findSecondaryTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['iframe-ok']);
  });

  it('returns empty array when no secondary targets exist', async () => {
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget({ id: 'page', type: 'page' })]);
    const result = await findSecondaryTargets(9222);
    expect(result).toEqual([]);
  });
});
