// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { getMainMessages } from '../../shared/i18n';
import { AGENT_IDS } from '../../shared/types';
import {
  assertAgentId,
  assertNonEmptyString,
  assertPortOrNull,
  assertSafeThemeId,
  isPortInRange,
} from './ipc-validators';

describe('assertAgentId', () => {
  it('accepts every valid AgentId', () => {
    for (const id of AGENT_IDS) {
      expect(() => assertAgentId(id)).not.toThrow();
    }
  });

  it('throws for non-string values', () => {
    expect(() => assertAgentId(123)).toThrow(getMainMessages().invalidAgentId);
    expect(() => assertAgentId(null)).toThrow(getMainMessages().invalidAgentId);
    expect(() => assertAgentId(undefined)).toThrow(getMainMessages().invalidAgentId);
    expect(() => assertAgentId({})).toThrow(getMainMessages().invalidAgentId);
  });

  it('throws for unknown string ids', () => {
    expect(() => assertAgentId('unknown')).toThrow(getMainMessages().invalidAgentId);
    expect(() => assertAgentId('')).toThrow(getMainMessages().invalidAgentId);
    expect(() => assertAgentId('TRADE')).toThrow(getMainMessages().invalidAgentId);
  });

  it('narrows the type after assertion', () => {
    const value: unknown = 'workbuddy';
    assertAgentId(value);
    // If the assertion worked, value is typed as AgentId here.
    expect(value).toBe('workbuddy');
  });
});

describe('assertSafeThemeId', () => {
  it('accepts a normal theme id', () => {
    expect(() => assertSafeThemeId('dark-cyberpunk')).not.toThrow();
    expect(() => assertSafeThemeId('minimal_light')).not.toThrow();
    expect(() => assertSafeThemeId('a')).not.toThrow();
  });

  it('throws for non-string values', () => {
    expect(() => assertSafeThemeId(42)).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId(null)).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId(undefined)).toThrow(getMainMessages().invalidThemeId);
  });

  it('throws for empty string', () => {
    expect(() => assertSafeThemeId('')).toThrow(getMainMessages().invalidThemeId);
  });

  it('throws for path traversal attempts', () => {
    expect(() => assertSafeThemeId('../etc/passwd')).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId('..')).toThrow(getMainMessages().invalidThemeId);
  });

  it('throws for ids containing forward slash', () => {
    expect(() => assertSafeThemeId('a/b')).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId('/abs/path')).toThrow(getMainMessages().invalidThemeId);
  });

  it('throws for ids containing backslash', () => {
    expect(() => assertSafeThemeId('a\\b')).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId('C:\\Windows')).toThrow(getMainMessages().invalidThemeId);
  });

  it('throws for absolute paths', () => {
    expect(() => assertSafeThemeId('/etc/passwd')).toThrow(getMainMessages().invalidThemeId);
    expect(() => assertSafeThemeId('C:\\Users')).toThrow(getMainMessages().invalidThemeId);
  });
});

describe('assertNonEmptyString', () => {
  it('accepts non-empty strings', () => {
    expect(() => assertNonEmptyString('hello', 'err')).not.toThrow();
    expect(() => assertNonEmptyString('a', 'err')).not.toThrow();
    expect(() => assertNonEmptyString(' with spaces ', 'err')).not.toThrow();
  });

  it('throws for non-string values', () => {
    const msg = 'custom error';
    expect(() => assertNonEmptyString(123, msg)).toThrow(msg);
    expect(() => assertNonEmptyString(null, msg)).toThrow(msg);
    expect(() => assertNonEmptyString(undefined, msg)).toThrow(msg);
    expect(() => assertNonEmptyString(true, msg)).toThrow(msg);
  });

  it('throws for empty string', () => {
    const msg = 'empty not allowed';
    expect(() => assertNonEmptyString('', msg)).toThrow(msg);
  });

  it('uses the provided message verbatim', () => {
    const msg = getMainMessages().invalidPath;
    expect(() => assertNonEmptyString(0, msg)).toThrow(msg);
  });
});

describe('assertPortOrNull', () => {
  it('accepts null (means "clear override")', () => {
    expect(() => assertPortOrNull(null)).not.toThrow();
  });

  it('accepts valid port numbers in range [1024, 65535]', () => {
    expect(() => assertPortOrNull(1024)).not.toThrow();
    expect(() => assertPortOrNull(8080)).not.toThrow();
    expect(() => assertPortOrNull(65535)).not.toThrow();
  });

  it('throws for ports below 1024', () => {
    expect(() => assertPortOrNull(0)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(80)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(1023)).toThrow(getMainMessages().invalidPort);
  });

  it('throws for ports above 65535', () => {
    expect(() => assertPortOrNull(65536)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(100000)).toThrow(getMainMessages().invalidPort);
  });

  it('throws for non-integer numbers', () => {
    expect(() => assertPortOrNull(8080.5)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(NaN)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(Infinity)).toThrow(getMainMessages().invalidPort);
  });

  it('throws for non-number types', () => {
    expect(() => assertPortOrNull('8080')).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull(undefined)).toThrow(getMainMessages().invalidPort);
    expect(() => assertPortOrNull({})).toThrow(getMainMessages().invalidPort);
  });
});

describe('isPortInRange', () => {
  it('returns true for valid ports in [1024, 65535]', () => {
    expect(isPortInRange(1024)).toBe(true);
    expect(isPortInRange(8080)).toBe(true);
    expect(isPortInRange(65535)).toBe(true);
  });

  it('returns false for ports below 1024', () => {
    expect(isPortInRange(0)).toBe(false);
    expect(isPortInRange(80)).toBe(false);
    expect(isPortInRange(1023)).toBe(false);
  });

  it('returns false for ports above 65535', () => {
    expect(isPortInRange(65536)).toBe(false);
    expect(isPortInRange(100000)).toBe(false);
  });

  it('returns false for non-integer numbers', () => {
    expect(isPortInRange(8080.5)).toBe(false);
    expect(isPortInRange(NaN)).toBe(false);
    expect(isPortInRange(Infinity)).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isPortInRange('8080')).toBe(false);
    expect(isPortInRange(null)).toBe(false);
    expect(isPortInRange(undefined)).toBe(false);
    expect(isPortInRange({})).toBe(false);
  });
});
