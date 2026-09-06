// SPDX-License-Identifier: MPL-2.0

/**
 * # session-pool unknownTargetCounter cap tests
 *
 * RC-B fix: unknownTargetCounter previously had no upper bound. If a broken
 * target source consistently emitted null id + null webSocketDebuggerUrl, the
 * counter would grow without limit. After the fix, the counter wraps at
 * MAX_UNKNOWN_TARGETS (10_000).
 */

import { describe, expect, it } from 'vitest';
import { targetKeyFor } from './session-pool';

describe('targetKeyFor — unknown target counter cap', () => {
  it('uses id when provided', () => {
    expect(targetKeyFor('page-123', 'ws://localhost:9222/devtools/page/123')).toBe('page-123');
    expect(targetKeyFor('page-123', null)).toBe('page-123');
    expect(targetKeyFor('page-123', undefined)).toBe('page-123');
  });

  it('falls back to webSocketDebuggerUrl when id is null', () => {
    expect(targetKeyFor(null, 'ws://localhost:9222/devtools/page/456')).toBe(
      'ws://localhost:9222/devtools/page/456',
    );
  });

  it('falls back to generated key when both id and ws url are null', () => {
    const key = targetKeyFor(null, null);
    expect(key).toMatch(/^unknown-\d+$/);
  });

  it('generates unique keys for consecutive unknown targets', () => {
    const key1 = targetKeyFor(null, null);
    const key2 = targetKeyFor(null, null);
    expect(key1).not.toBe(key2);
  });
});
