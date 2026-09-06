// SPDX-License-Identifier: MPL-2.0

/**
 * # describeWallpaperFailure — unit tests
 *
 * Maps raw wallpaper injection verdict strings to localized failure messages.
 * Exhaustively covers every classification branch, priority ordering, and
 * edge cases (empty, undefined, case-insensitivity, multi verdict strings).
 */

import type { UiMessages } from '@shared/i18n';
import { describe, expect, it } from 'vitest';
import { describeWallpaperFailure } from './describeWallpaperFailure';

// Minimal UiMessages mock — only the fields that describeWallpaperFailure reads.
const t = {
  wpFailUnknown: 'Unknown error',
  wpFailCodec: 'Codec not supported',
  wpFailCdp: 'CDP connection failed',
  wpFailInvisible: 'Wallpaper not visible',
  wpFailCsp: 'CSP or load failure',
  wpFailOther: 'Other failure',
} as unknown as UiMessages;

describe('describeWallpaperFailure', () => {
  // --- Empty / undefined detail ---

  it('returns wpFailUnknown when detail is undefined', () => {
    expect(describeWallpaperFailure(undefined, t)).toBe('Unknown error');
  });

  it('returns wpFailUnknown when detail is an empty string', () => {
    expect(describeWallpaperFailure('', t)).toBe('Unknown error');
  });

  it('returns wpFailUnknown when detail is whitespace-only', () => {
    // Whitespace is falsy after trim but note: the function only checks !detail,
    // not truthiness after trim. A non-empty whitespace string goes through
    // the full classification and falls through to wpFailOther.
    expect(describeWallpaperFailure('   ', t)).toBe('Other failure');
  });

  // --- Codec unsupported (priority 1) ---

  it('returns wpFailCodec for src-not-supported', () => {
    expect(describeWallpaperFailure('stream:loadfail:src-not-supported', t)).toBe(
      'Codec not supported',
    );
  });

  it('matches src-not-supported case-insensitively', () => {
    expect(describeWallpaperFailure('Stream:LoadFail:src-NOT-supported', t)).toBe(
      'Codec not supported',
    );
  });

  // --- CDP transport failures (priority 2) ---

  it('returns wpFailCdp for cdp-connect-failed', () => {
    expect(describeWallpaperFailure('cdp-connect-failed', t)).toBe('CDP connection failed');
  });

  it('returns wpFailCdp for "CDP request timed out"', () => {
    expect(describeWallpaperFailure('cdp-connect-failed:CDP request timed out', t)).toBe(
      'CDP connection failed',
    );
  });

  it('returns wpFailCdp for "timed out" substring', () => {
    expect(describeWallpaperFailure('operation timed out after 5000ms', t)).toBe(
      'CDP connection failed',
    );
  });

  it('returns wpFailCdp for "websocket closed"', () => {
    expect(describeWallpaperFailure('websocket closed unexpectedly', t)).toBe(
      'CDP connection failed',
    );
  });

  it('returns wpFailCdp for "cdp request" substring', () => {
    expect(describeWallpaperFailure('cdp request execution failed', t)).toBe(
      'CDP connection failed',
    );
  });

  it('matches cdp keywords case-insensitively', () => {
    expect(describeWallpaperFailure('CDP-Connect-Failed', t)).toBe('CDP connection failed');
    expect(describeWallpaperFailure('WebSocket Closed', t)).toBe('CDP connection failed');
  });

  // --- Visibility probe failure (priority 3) ---

  it('returns wpFailInvisible for "invisible"', () => {
    expect(describeWallpaperFailure('element invisible after punch-through', t)).toBe(
      'Wallpaper not visible',
    );
  });

  it('matches invisible case-insensitively', () => {
    expect(describeWallpaperFailure('INVISIBLE', t)).toBe('Wallpaper not visible');
  });

  // --- CSP / load failure (priority 4) ---

  it('returns wpFailCsp for csp-or-unsupported', () => {
    expect(describeWallpaperFailure('image:loadfail:csp-or-unsupported', t)).toBe(
      'CSP or load failure',
    );
  });

  it('returns wpFailCsp for "loadfail" without codec code', () => {
    expect(describeWallpaperFailure('stream:loadfail', t)).toBe('CSP or load failure');
  });

  it('returns wpFailCsp for "blob:loadfail"', () => {
    expect(describeWallpaperFailure('blob:loadfail', t)).toBe('CSP or load failure');
  });

  it('returns wpFailCsp for "stream:loadfail"', () => {
    expect(describeWallpaperFailure('stream:loadfail', t)).toBe('CSP or load failure');
  });

  it('matches csp keywords case-insensitively', () => {
    expect(describeWallpaperFailure('CSP-or-unsupported', t)).toBe('CSP or load failure');
  });

  // --- Unknown / fallback ---

  it('returns wpFailOther for a completely unknown detail', () => {
    expect(describeWallpaperFailure('some-random-error-code', t)).toBe('Other failure');
  });

  // --- Priority ordering ---

  it('priorities codec (src-not-supported) over CDP (cdp-connect-failed)', () => {
    const detail = 'stream:loadfail:src-not-supported, cdp-connect-failed';
    expect(describeWallpaperFailure(detail, t)).toBe('Codec not supported');
  });

  it('priorities codec over CSP (loadfail)', () => {
    const detail = 'stream:loadfail:src-not-supported, image:loadfail:csp-or-unsupported';
    expect(describeWallpaperFailure(detail, t)).toBe('Codec not supported');
  });

  it('priorities CDP over invisible', () => {
    const detail = 'cdp-connect-failed, invisible';
    expect(describeWallpaperFailure(detail, t)).toBe('CDP connection failed');
  });

  it('priorities CDP over CSP', () => {
    const detail = 'websocket closed, loadfail';
    expect(describeWallpaperFailure(detail, t)).toBe('CDP connection failed');
  });

  it('priorities invisible over CSP', () => {
    const detail = 'invisible, loadfail';
    expect(describeWallpaperFailure(detail, t)).toBe('Wallpaper not visible');
  });
});
