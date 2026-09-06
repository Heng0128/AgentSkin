// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for ZcodeConnectionManager — CDP connection state tracking and
 * intelligent reconnection. Covers state transitions, error classification,
 * retry decisions, exponential backoff, PortLeasePool integration, and
 * consecutive failure handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionErrorCategory,
  ConnectionState,
  classifyConnectionError,
  type PortLeaseProvider,
  ZcodeConnectionManager,
} from './zcode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock PortLeaseProvider for testing. */
function createMockPortPool(overrides: Partial<PortLeaseProvider> = {}): PortLeaseProvider {
  return {
    acquire: vi.fn().mockResolvedValue({ port: 9223, leaseId: 'test-lease-1' }),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. State transitions
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — state transitions', () => {
  let manager: ZcodeConnectionManager;

  beforeEach(() => {
    manager = new ZcodeConnectionManager();
  });

  it('starts in DISCONNECTED state', () => {
    expect(manager.state).toBe(ConnectionState.DISCONNECTED);
    expect(manager.isConnected).toBe(false);
  });

  it('transitions DISCONNECTED → CONNECTING on beginConnect()', () => {
    manager.beginConnect();
    expect(manager.state).toBe(ConnectionState.CONNECTING);
  });

  it('transitions CONNECTING → CONNECTED on recordConnected()', () => {
    manager.beginConnect();
    manager.recordConnected(9223);
    expect(manager.state).toBe(ConnectionState.CONNECTED);
    expect(manager.isConnected).toBe(true);
    expect(manager.port).toBe(9223);
  });

  it('transitions CONNECTED → RECONNECTING on recordFailure()', () => {
    manager.beginConnect();
    manager.recordConnected(9223);
    manager.recordFailure(new Error('timeout'));
    expect(manager.state).toBe(ConnectionState.RECONNECTING);
  });

  it('transitions to DISCONNECTED after max consecutive failures', () => {
    const m = new ZcodeConnectionManager(undefined, { maxConsecutiveFailures: 2 });
    m.beginConnect();
    m.recordConnected(9223);
    m.recordFailure(new Error('timeout'));
    expect(m.state).toBe(ConnectionState.RECONNECTING);
    m.recordFailure(new Error('timeout'));
    expect(m.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('records transition history (most recent last)', () => {
    manager.beginConnect();
    manager.recordConnected(9223);
    manager.recordFailure(new Error('timeout'));

    const history = manager.getTransitionHistory();
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({
      from: ConnectionState.DISCONNECTED,
      to: ConnectionState.CONNECTING,
    });
    expect(history[1]).toMatchObject({
      from: ConnectionState.CONNECTING,
      to: ConnectionState.CONNECTED,
    });
    expect(history[2]).toMatchObject({
      from: ConnectionState.CONNECTED,
      to: ConnectionState.RECONNECTING,
    });
  });

  it('caps transition history at historySize (10)', () => {
    const m = new ZcodeConnectionManager(undefined, { historySize: 3 });
    // Generate 5 transitions
    for (let i = 0; i < 5; i++) {
      m.beginConnect();
      m.recordConnected(9223 + i);
    }
    const history = m.getTransitionHistory();
    expect(history.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Error classification
// ---------------------------------------------------------------------------

describe('classifyConnectionError', () => {
  it('classifies timeout errors as NETWORK_TIMEOUT', () => {
    expect(classifyConnectionError(new Error('CDP request timed out: Page.navigate'))).toBe(
      ConnectionErrorCategory.NETWORK_TIMEOUT,
    );
    expect(classifyConnectionError(new Error('connect ETIMEDOUT'))).toBe(
      ConnectionErrorCategory.NETWORK_TIMEOUT,
    );
    expect(classifyConnectionError(new Error('ECONNREFUSED'))).toBe(
      ConnectionErrorCategory.NETWORK_TIMEOUT,
    );
  });

  it('classifies target crash errors as PAGE_CRASHED', () => {
    expect(classifyConnectionError(new Error('Target closed'))).toBe(
      ConnectionErrorCategory.PAGE_CRASHED,
    );
    expect(classifyConnectionError(new Error('Target crashed'))).toBe(
      ConnectionErrorCategory.PAGE_CRASHED,
    );
    expect(classifyConnectionError(new Error('Renderer detached'))).toBe(
      ConnectionErrorCategory.PAGE_CRASHED,
    );
  });

  it('classifies fatal errors as FATAL', () => {
    expect(classifyConnectionError(new Error('CDP session is closed'))).toBe(
      ConnectionErrorCategory.FATAL,
    );
    expect(classifyConnectionError(new Error('CDP reconnect exhausted'))).toBe(
      ConnectionErrorCategory.FATAL,
    );
  });

  it('classifies unknown errors as PROTOCOL_ERROR', () => {
    expect(classifyConnectionError(new Error('Cannot navigate (-32000)'))).toBe(
      ConnectionErrorCategory.PROTOCOL_ERROR,
    );
    expect(classifyConnectionError(new Error('Internal error'))).toBe(
      ConnectionErrorCategory.PROTOCOL_ERROR,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Reconnect decisions by error type
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — reconnect decisions', () => {
  it('returns retry_immediate for network timeout (within retry limit)', () => {
    const m = new ZcodeConnectionManager(undefined, { maxImmediateRetries: 3 });
    m.beginConnect();
    m.recordConnected(9223);
    const decision = m.recordFailure(new Error('timeout'));
    expect(decision.action).toBe('retry_immediate');
    expect(decision.delayMs).toBe(0);
  });

  it('returns retry_with_delay for protocol error', () => {
    const m = new ZcodeConnectionManager(undefined, { baseDelayMs: 1000, jitterFactor: 0 });
    m.beginConnect();
    m.recordConnected(9223);
    const decision = m.recordFailure(new Error('Cannot navigate'));
    expect(decision.action).toBe('retry_with_delay');
    expect(decision.delayMs).toBe(1000);
  });

  it('returns wait_for_recovery for page crash', () => {
    const m = new ZcodeConnectionManager(undefined, {
      baseDelayMs: 1000,
      jitterFactor: 0,
      pageRecoveryTimeoutMs: 5000,
    });
    m.beginConnect();
    m.recordConnected(9223);
    const decision = m.recordFailure(new Error('Target crashed'));
    expect(decision.action).toBe('wait_for_recovery');
    expect(decision.delayMs).toBeLessThanOrEqual(5000);
  });

  it('returns give_up for fatal error', () => {
    const m = new ZcodeConnectionManager();
    m.beginConnect();
    m.recordConnected(9223);
    const decision = m.recordFailure(new Error('CDP session is closed'));
    expect(decision.action).toBe('give_up');
    expect(m.state).toBe(ConnectionState.DISCONNECTED);
  });

  it('returns give_up after max consecutive failures', () => {
    const m = new ZcodeConnectionManager(undefined, { maxConsecutiveFailures: 3 });
    m.beginConnect();
    m.recordConnected(9223);
    m.recordFailure(new Error('timeout')); // 1
    m.recordFailure(new Error('timeout')); // 2
    const decision = m.recordFailure(new Error('timeout')); // 3 → give up
    expect(decision.action).toBe('give_up');
    expect(m.state).toBe(ConnectionState.DISCONNECTED);
  });
});

// ---------------------------------------------------------------------------
// 4. Exponential backoff
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — exponential backoff', () => {
  it('delay increases exponentially with consecutive failures', () => {
    const m = new ZcodeConnectionManager(undefined, {
      baseDelayMs: 500,
      maxDelayMs: 30000,
      jitterFactor: 0,
      maxConsecutiveFailures: 10,
    });
    m.beginConnect();
    m.recordConnected(9223);

    // Record failures without reconnecting — each failure increments the
    // consecutive failure counter, which drives the exponential backoff.
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const decision = m.recordFailure(new Error('protocol error'));
      if (decision.delayMs !== undefined) {
        delays.push(decision.delayMs);
      }
    }

    // Verify exponential growth: each delay should be ~2x the previous
    // Expected: 500, 1000, 2000, 4000, 8000
    expect(delays).toHaveLength(5);
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(1000);
    expect(delays[2]).toBe(2000);
    expect(delays[3]).toBe(4000);
    expect(delays[4]).toBe(8000);
  });

  it('caps backoff delay at maxDelayMs', () => {
    const m = new ZcodeConnectionManager(undefined, {
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterFactor: 0,
      maxConsecutiveFailures: 10,
    });
    m.beginConnect();
    m.recordConnected(9223);

    // After many failures, delay should be capped
    let lastDelay = 0;
    for (let i = 0; i < 8; i++) {
      const decision = m.recordFailure(new Error('protocol error'));
      lastDelay = decision.delayMs ?? 0;
      m.recordConnected(9223);
    }

    expect(lastDelay).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// 5. PortLeasePool integration
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — PortLeasePool integration', () => {
  it('acquires port from pool on acquirePort()', async () => {
    const pool = createMockPortPool();
    const m = new ZcodeConnectionManager(pool);

    const result = await m.acquirePort();
    expect(result).toEqual({ port: 9223, leaseId: 'test-lease-1' });
    expect(pool.acquire).toHaveBeenCalledOnce();
  });

  it('releases port on releasePort()', async () => {
    const pool = createMockPortPool();
    const m = new ZcodeConnectionManager(pool);

    await m.acquirePort();
    await m.releasePort();

    expect(pool.release).toHaveBeenCalledWith('test-lease-1');
    expect(m.port).toBeNull();
    expect(m.leaseId).toBeNull();
  });

  it('releases port on handleDisconnect()', async () => {
    const pool = createMockPortPool();
    const m = new ZcodeConnectionManager(pool);

    await m.acquirePort();
    m.beginConnect();
    m.recordConnected(9223, 'test-lease-1');
    expect(m.isConnected).toBe(true);

    await m.handleDisconnect();
    expect(pool.release).toHaveBeenCalledWith('test-lease-1');
    expect(m.port).toBeNull();
  });

  it('works without a port pool (returns null from acquirePort)', async () => {
    const m = new ZcodeConnectionManager();
    const result = await m.acquirePort();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Quality metrics
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — quality metrics', () => {
  it('reports zero metrics initially', () => {
    const m = new ZcodeConnectionManager();
    const quality = m.getQuality();
    expect(quality.totalAttempts).toBe(0);
    expect(quality.totalSuccesses).toBe(0);
    expect(quality.totalFailures).toBe(0);
    expect(quality.successRate).toBe(0);
    expect(quality.averageLatencyMs).toBe(0);
  });

  it('tracks success and failure counts', () => {
    const m = new ZcodeConnectionManager();
    m.beginConnect();
    m.recordConnected(9223);
    m.recordFailure(new Error('timeout'));
    m.recordConnected(9223);

    const quality = m.getQuality();
    expect(quality.totalAttempts).toBe(3);
    expect(quality.totalSuccesses).toBe(2);
    expect(quality.totalFailures).toBe(1);
    expect(quality.successRate).toBeCloseTo(2 / 3, 5);
  });

  it('resets metrics on reset()', async () => {
    const m = new ZcodeConnectionManager();
    m.beginConnect();
    m.recordConnected(9223);
    m.recordFailure(new Error('timeout'));

    await m.reset();
    const quality = m.getQuality();
    expect(quality.totalAttempts).toBe(0);
    expect(quality.totalSuccesses).toBe(0);
    expect(quality.totalFailures).toBe(0);
    expect(m.state).toBe(ConnectionState.DISCONNECTED);
    expect(m.getTransitionHistory()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Consecutive failure handling
// ---------------------------------------------------------------------------

describe('ZcodeConnectionManager — consecutive failure handling', () => {
  it('resets consecutiveFailures on successful connection', () => {
    const m = new ZcodeConnectionManager(undefined, { maxConsecutiveFailures: 5 });
    m.beginConnect();
    m.recordConnected(9223);
    m.recordFailure(new Error('timeout'));
    m.recordFailure(new Error('timeout'));
    expect(m.failureCount).toBe(2);

    // Successful connection resets the counter
    m.recordConnected(9223);
    expect(m.failureCount).toBe(0);
  });

  it('gives up after exactly maxConsecutiveFailures', () => {
    const m = new ZcodeConnectionManager(undefined, { maxConsecutiveFailures: 5 });
    m.beginConnect();
    m.recordConnected(9223);

    // 4 failures → still reconnecting
    for (let i = 0; i < 4; i++) {
      const decision = m.recordFailure(new Error('timeout'));
      expect(decision.action).not.toBe('give_up');
    }
    expect(m.state).toBe(ConnectionState.RECONNECTING);

    // 5th failure → give up
    const finalDecision = m.recordFailure(new Error('timeout'));
    expect(finalDecision.action).toBe('give_up');
    expect(m.state).toBe(ConnectionState.DISCONNECTED);
  });
});
