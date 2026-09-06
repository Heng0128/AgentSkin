// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { safeClose, safeJsonParse } from './safe-operations';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('returns fallback on invalid JSON', () => {
    const fallback = { default: true };
    const result = safeJsonParse('not json', fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback on null input', () => {
    const fallback = { empty: true };
    const result = safeJsonParse(null, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback on undefined input', () => {
    const fallback = { empty: true };
    const result = safeJsonParse(undefined, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback on non-string input', () => {
    const fallback = { wrong: 'type' };
    const result = safeJsonParse(123 as unknown as string, fallback);
    expect(result).toBe(fallback);
  });

  it('logs error when label and log provided', () => {
    const log = vi.fn();
    safeJsonParse('invalid', {}, 'test-label', log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[test-label] JSON.parse failed'));
  });

  it('logs type mismatch when non-string input', () => {
    const log = vi.fn();
    safeJsonParse(null, {}, 'test-label', log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[test-label] expected string'));
  });

  it('does not log when no label provided', () => {
    const log = vi.fn();
    safeJsonParse('invalid', {}, undefined, log);
    expect(log).not.toHaveBeenCalled();
  });

  it('handles empty string as invalid', () => {
    const fallback = { empty: true };
    const result = safeJsonParse('', fallback);
    expect(result).toBe(fallback);
  });
});

describe('safeClose', () => {
  it('calls close function', () => {
    const close = vi.fn();
    safeClose(close);
    expect(close).toHaveBeenCalled();
  });

  it('swallows errors from close', () => {
    const close = vi.fn(() => {
      throw new Error('close failed');
    });
    expect(() => safeClose(close)).not.toThrow();
  });

  it('logs error when label and log provided', () => {
    const log = vi.fn();
    const close = vi.fn(() => {
      throw new Error('close failed');
    });
    safeClose(close, 'test-label', log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[test-label] close error'));
  });

  it('does not log when no label provided', () => {
    const log = vi.fn();
    const close = vi.fn(() => {
      throw new Error('close failed');
    });
    safeClose(close, undefined, log);
    expect(log).not.toHaveBeenCalled();
  });

  it('handles undefined close function', () => {
    expect(() => safeClose(undefined)).not.toThrow();
  });
});
