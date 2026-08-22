// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { toMessage } from './errors';

describe('toMessage', () => {
  it('extracts .message from Error instances', () => {
    expect(toMessage(new Error('boom'))).toBe('boom');
  });

  it('returns string values as-is', () => {
    expect(toMessage('something went wrong')).toBe('something went wrong');
  });

  it('extracts .message from Error subclasses (TypeError, RangeError, etc.)', () => {
    expect(toMessage(new TypeError('not a function'))).toBe('not a function');
    expect(toMessage(new RangeError('out of bounds'))).toBe('out of bounds');
  });

  it('extracts .message from plain objects with a string message property', () => {
    expect(toMessage({ message: 'custom error' })).toBe('custom error');
  });

  it('falls back to String() for objects without a string message', () => {
    expect(toMessage({ message: 42 })).toBe('[object Object]');
    expect(toMessage({ code: 'ERR_42' })).toBe('[object Object]');
  });

  it('falls back to String() for numbers', () => {
    expect(toMessage(42)).toBe('42');
    expect(toMessage(0)).toBe('0');
  });

  it('falls back to String() for booleans', () => {
    expect(toMessage(true)).toBe('true');
    expect(toMessage(false)).toBe('false');
  });

  it('falls back to String() for null and undefined', () => {
    expect(toMessage(null)).toBe('null');
    expect(toMessage(undefined)).toBe('undefined');
  });

  it('falls back to String() for arrays', () => {
    expect(toMessage([1, 2, 3])).toBe('1,2,3');
  });

  it('handles Error instances with empty message', () => {
    expect(toMessage(new Error())).toBe('');
  });
});
