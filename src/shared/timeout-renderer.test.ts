// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { toMessage } from './errors';
import {
  IpcTimeoutError,
  isIpcTimeoutError,
  type SerializedIpcTimeoutError,
  serializeForIpc,
} from './withTimeout';

describe('isIpcTimeoutError', () => {
  it('identifies serialized timeout cross-IPC', () => {
    const e = serializeForIpc(new IpcTimeoutError('THEME_APPLY', 30000));
    expect(isIpcTimeoutError(e)).toBe(true);
  });

  it('identifies a live IpcTimeoutError instance', () => {
    const e = new IpcTimeoutError('THEME_APPLY', 30000);
    expect(isIpcTimeoutError(e)).toBe(true);
  });

  it('rejects plain errors', () => {
    expect(isIpcTimeoutError(new Error('boom'))).toBe(false);
  });

  it('rejects plain objects without the expected name', () => {
    expect(isIpcTimeoutError({ name: 'OtherError', message: 'nope' })).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isIpcTimeoutError(null)).toBe(false);
    expect(isIpcTimeoutError(undefined)).toBe(false);
  });

  it('rejects strings and numbers', () => {
    expect(isIpcTimeoutError('timeout')).toBe(false);
    expect(isIpcTimeoutError(42)).toBe(false);
  });
});

describe('serializeForIpc', () => {
  it('produces a plain object with all timeout metadata', () => {
    const e = new IpcTimeoutError('THEME_APPLY', 30000);
    const serialized = serializeForIpc(e);

    expect(serialized).toEqual({
      name: 'IpcTimeoutError',
      message: "channel 'THEME_APPLY' timed out after 30000ms",
      code: 'IPC_TIMEOUT',
      channel: 'THEME_APPLY',
      ms: 30000,
    });
  });

  it('produces a structure-free object (no prototype chain)', () => {
    const e = new IpcTimeoutError('WALLPAPER_SET', 15000);
    const serialized = serializeForIpc(e);

    // Simulates Electron structured clone: plain object, no instanceof
    expect(serialized).not.toBeInstanceOf(IpcTimeoutError);
    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
    // But isIpcTimeoutError still identifies it by name
    expect(isIpcTimeoutError(serialized)).toBe(true);
  });
});

describe('toMessage for IpcTimeoutError', () => {
  it('produces a friendly timeout message with channel and seconds', () => {
    const e = serializeForIpc(new IpcTimeoutError('THEME_APPLY', 30000));
    const msg = toMessage(e);
    expect(msg).toContain('THEME_APPLY');
    expect(msg).toContain('30');
  });

  it('does not leak raw "channel ... timed out after" text', () => {
    const e = serializeForIpc(new IpcTimeoutError('WALLPAPER_SET', 15000));
    const msg = toMessage(e);
    expect(msg).not.toContain('timed out after');
    expect(msg).toContain('15');
  });

  it('channel name appears in the output', () => {
    const serialized: SerializedIpcTimeoutError = {
      name: 'IpcTimeoutError',
      message: 'channel X timed out',
      code: 'IPC_TIMEOUT',
      channel: 'WALLPAPER_APPLY',
      ms: 20000,
    };
    const msg = toMessage(serialized);
    expect(msg).toContain('WALLPAPER_APPLY');
  });

  it('prefixes with "Error:" so friendlyMessage strips it and returns the message', () => {
    const e = serializeForIpc(new IpcTimeoutError('THEME_APPLY', 30000));
    const msg = toMessage(e);
    expect(msg).toMatch(/^Error:\s/);
  });
});
