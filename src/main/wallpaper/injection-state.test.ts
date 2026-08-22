// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it, vi } from 'vitest';
import { wallpaperMediaServer } from '../wallpaper-server';
import {
  _clearActiveMediaTokensForTest,
  _getActiveMediaTokenForTest,
  setActiveMediaToken,
} from './injection-state';

const TEST_AGENT = 'traework' as const;

afterEach(() => {
  _clearActiveMediaTokensForTest();
  wallpaperMediaServer.stop();
  vi.restoreAllMocks();
});

describe('setActiveMediaToken (atomic replace)', () => {
  it('replaces the old token with the new one', () => {
    setActiveMediaToken(TEST_AGENT, 'token-1');
    expect(_getActiveMediaTokenForTest(TEST_AGENT)).toBe('token-1');
    setActiveMediaToken(TEST_AGENT, 'token-2');
    expect(_getActiveMediaTokenForTest(TEST_AGENT)).toBe('token-2');
  });

  it('unregisters the previous token when replacing', () => {
    setActiveMediaToken(TEST_AGENT, 'token-1');
    const spy = vi.spyOn(wallpaperMediaServer, 'unregister');
    setActiveMediaToken(TEST_AGENT, 'token-2');
    expect(spy).toHaveBeenCalledWith('token-1');
    expect(_getActiveMediaTokenForTest(TEST_AGENT)).toBe('token-2');
  });

  it('keeps the new token tracked even when unregister throws', async () => {
    // A throw inside unregister (server hiccup) must NOT lose the new token:
    // the agent would otherwise sit in a "no active token" state where the
    // next apply thinks there is nothing to clean up.
    setActiveMediaToken(TEST_AGENT, 'token-1');
    const spy = vi.spyOn(wallpaperMediaServer, 'unregister');
    spy.mockImplementationOnce(() => {
      throw new Error('server hiccup');
    });
    expect(() => setActiveMediaToken(TEST_AGENT, 'token-2')).not.toThrow();
    expect(_getActiveMediaTokenForTest(TEST_AGENT)).toBe('token-2');
  });

  it('clears the tracking when passed null', () => {
    setActiveMediaToken(TEST_AGENT, 'token-1');
    setActiveMediaToken(TEST_AGENT, null);
    expect(_getActiveMediaTokenForTest(TEST_AGENT)).toBeUndefined();
  });
});
