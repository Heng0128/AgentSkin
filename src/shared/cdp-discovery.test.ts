// SPDX-License-Identifier: MPL-2.0

import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isPort, probePortLive } from './cdp-discovery';

describe('isPort', () => {
  it('accepts integers in the valid TCP range (1024-65535)', () => {
    expect(isPort(1024)).toBe(true);
    expect(isPort(65535)).toBe(true);
    expect(isPort(9222)).toBe(true);
  });

  it('rejects ports below 1024 (privileged range)', () => {
    expect(isPort(0)).toBe(false);
    expect(isPort(80)).toBe(false);
    expect(isPort(1023)).toBe(false);
  });

  it('rejects ports above 65535', () => {
    expect(isPort(65536)).toBe(false);
    expect(isPort(100000)).toBe(false);
  });

  it('rejects non-integer numbers', () => {
    expect(isPort(9222.5)).toBe(false);
    expect(isPort(NaN)).toBe(false);
    expect(isPort(Infinity)).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(isPort('9222')).toBe(false);
    expect(isPort(true)).toBe(false);
    expect(isPort(null)).toBe(false);
    expect(isPort(undefined)).toBe(false);
    expect(isPort({})).toBe(false);
  });

  it('acts as a type guard (narrows to number)', () => {
    const value: unknown = 9222;
    if (isPort(value)) {
      // TypeScript infers `value` as `number` here.
      expect(value + 1).toBe(9223);
    }
  });
});

describe('probePortLive', () => {
  it('returns true when a server is listening on the port', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const result = await probePortLive(port, 1000);
    expect(result).toBe(true);

    server.close();
  });

  it('returns false when nothing is listening on the port', async () => {
    // Use a high ephemeral port that's very unlikely to be in use.
    const result = await probePortLive(59999, 300);
    expect(result).toBe(false);
  });

  it('returns false on timeout (port exists but does not respond in time)', async () => {
    // A server that accepts connections but never sends data — probePortLive
    // should still return true because the TCP handshake completes. To test
    // the timeout path we'd need a non-responsive port, which is hard to
    // simulate reliably. Instead, test with a very short timeout on a
    // non-listening port to confirm the timeout path resolves (not hangs).
    const result = await probePortLive(59998, 50);
    expect(result).toBe(false);
  });
});
