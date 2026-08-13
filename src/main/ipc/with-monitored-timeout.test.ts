// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import { IpcTimeoutError } from '../../shared/withTimeout';
import { performanceLogger } from '../services/performance';
import { withMonitoredTimeout } from './with-monitored-timeout';

beforeEach(() => {
  performanceLogger.clear();
  performanceLogger.clearTimeouts();
});

describe('withMonitoredTimeout', () => {
  it('records an IPC timeout event to performanceLogger on timeout', async () => {
    const channel = 'THEME_APPLY';
    const ms = 10;

    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 100);
    });

    await expect(withMonitoredTimeout(channel, ms, promise)).rejects.toBeInstanceOf(
      IpcTimeoutError,
    );

    const timeouts = performanceLogger.getAllTimeouts();
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]!.channel).toBe(channel);
    expect(timeouts[0]!.ms).toBe(ms);
    expect(typeof timeouts[0]!.timestamp).toBe('number');
  });

  it('does NOT record a timeout event when the promise rejects for a non-timeout reason', async () => {
    const promise = Promise.reject(new Error('boom'));

    await expect(withMonitoredTimeout('THEME_RESTORE', 1000, promise)).rejects.toThrow('boom');

    expect(performanceLogger.getAllTimeouts()).toHaveLength(0);
  });

  it('does NOT record a timeout event when the promise resolves normally', async () => {
    await expect(withMonitoredTimeout('THEME_APPLY', 1000, Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );

    expect(performanceLogger.getAllTimeouts()).toHaveLength(0);
  });

  it('propagates the original timeout reason after recording', async () => {
    const promise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 50);
    });

    let caught: unknown;
    try {
      await withMonitoredTimeout('THEME_APPLY', 5, promise);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IpcTimeoutError);
    expect((caught as IpcTimeoutError).channel).toBe('THEME_APPLY');
    expect(performanceLogger.getAllTimeouts()).toHaveLength(1);
  });
});
