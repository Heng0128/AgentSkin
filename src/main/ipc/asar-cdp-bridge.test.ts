// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR CDP bridge tests
 *
 * The bridge is the only module in the joint-analysis path that touches the
 * network, so it is the only one that can hang a report on a dead endpoint.
 * These tests pin the behavior that keeps that bounded: probe the adapter's
 * preferred port first, never trust a port that answers TCP but serves no CDP
 * targets, and cap the walk so "app not running" costs milliseconds rather
 * than a scan of the whole 9222–9357 band.
 *
 * Sockets are mocked out entirely — no test here opens a connection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const probePortLive = vi.fn();
const listTargets = vi.fn();
const connectWithRetry = vi.fn();

vi.mock('../../shared/cdp-discovery', () => ({
  probePortLive: (...args: unknown[]) => probePortLive(...args),
}));

vi.mock('../cdp/cdp-targets', () => ({
  listTargets: (...args: unknown[]) => listTargets(...args),
}));

vi.mock('../cdp/cdp-fanout', () => ({
  connectWithRetry: (...args: unknown[]) => connectWithRetry(...args),
}));

const { createDefaultCdpBridge } = await import('./asar-cdp-bridge');

/** Make `livePorts` answer TCP and every other port refuse. */
function onlyLive(livePorts: readonly number[]): void {
  probePortLive.mockImplementation((port: number) => Promise.resolve(livePorts.includes(port)));
}

beforeEach(() => {
  vi.clearAllMocks();
  probePortLive.mockResolvedValue(false);
  listTargets.mockResolvedValue([]);
  connectWithRetry.mockResolvedValue(null);
});

describe('createDefaultCdpBridge — port resolution', () => {
  it('returns null when no port is listening', async () => {
    const bridge = createDefaultCdpBridge();
    await expect(bridge.resolvePort('workbuddy')).resolves.toBeNull();
  });

  it('returns the adapter preferred port when it serves CDP targets', async () => {
    // workbuddy's home port is 9224 (port-config DEFAULT_PORT_CONFIGS).
    onlyLive([9224]);
    listTargets.mockResolvedValue([{ id: 'target-1', type: 'page' }]);

    const bridge = createDefaultCdpBridge();
    await expect(bridge.resolvePort('workbuddy')).resolves.toBe(9224);
    expect(listTargets).toHaveBeenCalledWith(9224);
  });

  it('probes the adapter preferred port first', async () => {
    onlyLive([]);
    const bridge = createDefaultCdpBridge();

    await bridge.resolvePort('workbuddy');
    expect(probePortLive.mock.calls[0]?.[0]).toBe(9224);

    probePortLive.mockClear();
    await bridge.resolvePort('traework');
    expect(probePortLive.mock.calls[0]?.[0]).toBe(9222);
  });

  it('rejects a port that answers TCP but serves no CDP targets', async () => {
    // A stale DevToolsActivePort file or an unrelated service listening on the
    // band must not be mistaken for a CDP endpoint.
    onlyLive([9224]);
    listTargets.mockResolvedValue([]);

    const bridge = createDefaultCdpBridge();
    await expect(bridge.resolvePort('workbuddy')).resolves.toBeNull();
  });

  it('walks the fallback band when the preferred port is dead', async () => {
    onlyLive([9230]);
    listTargets.mockResolvedValue([{ id: 'target-2', type: 'page' }]);

    const bridge = createDefaultCdpBridge();
    await expect(bridge.resolvePort('workbuddy')).resolves.toBe(9230);
  });

  it('caps the walk so an absent app fails fast', async () => {
    onlyLive([]);
    const bridge = createDefaultCdpBridge();

    await bridge.resolvePort('workbuddy');

    // MAX_PORT_PROBES = 24 candidates, each probed once.
    expect(probePortLive).toHaveBeenCalledTimes(24);
    expect(listTargets).not.toHaveBeenCalled();
  });

  it('uses a short per-port probe budget', async () => {
    onlyLive([]);
    const bridge = createDefaultCdpBridge();
    await bridge.resolvePort('workbuddy');

    expect(probePortLive.mock.calls[0]?.[1]).toBe(200);
  });

  it('does not probe the same candidate twice', async () => {
    onlyLive([]);
    const bridge = createDefaultCdpBridge();
    await bridge.resolvePort('workbuddy');

    const probed = probePortLive.mock.calls.map((c) => c[0]);
    expect(new Set(probed).size).toBe(probed.length);
  });
});

describe('createDefaultCdpBridge — targets and connections', () => {
  it('lists targets on a port', async () => {
    const targets = [{ id: 'a', type: 'page' }];
    listTargets.mockResolvedValue(targets);

    const bridge = createDefaultCdpBridge();
    await expect(bridge.listTargets(9222)).resolves.toBe(targets);
    expect(listTargets).toHaveBeenCalledWith(9222);
  });

  it('connects with a bounded retry budget', async () => {
    const session = { send: vi.fn(), evaluate: vi.fn(), close: vi.fn() };
    connectWithRetry.mockResolvedValue(session);

    const bridge = createDefaultCdpBridge();
    await expect(bridge.connect('ws://127.0.0.1:9224/devtools/page/a')).resolves.toBe(session);

    // Analysis is interactive — 2 attempts, not the apply path's 3.
    expect(connectWithRetry).toHaveBeenCalledWith(
      'ws://127.0.0.1:9224/devtools/page/a',
      4000,
      2,
      [500],
    );
  });

  it('surfaces a failed connect as null rather than throwing', async () => {
    connectWithRetry.mockResolvedValue(null);
    const bridge = createDefaultCdpBridge();
    await expect(bridge.connect('ws://dead')).resolves.toBeNull();
  });
});
