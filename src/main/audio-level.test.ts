// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { parseAudioLevelLine } from './audio-level';

describe('parseAudioLevelLine (PowerShell sampler stdout)', () => {
  it('parses a well-formed level line', () => {
    expect(parseAudioLevelLine('L:0.423')).toBeCloseTo(0.423);
    expect(parseAudioLevelLine('L:1.000')).toBeCloseTo(1);
    expect(parseAudioLevelLine('L:0.000')).toBe(0);
    expect(parseAudioLevelLine('  L:0.500  ')).toBeCloseTo(0.5);
  });

  it('clamps out-of-range positive values into 0..1', () => {
    expect(parseAudioLevelLine('L:1.500')).toBe(1);
  });

  it(
    'rejects negative levels — the L: grammar has no sign token, so a negative' +
      ' line is treated as noise and the previous level is kept',
    () => {
      expect(parseAudioLevelLine('L:-0.200')).toBeNull();
    },
  );

  it('returns null for non-level lines (stderr noise, headers, blank)', () => {
    expect(parseAudioLevelLine('')).toBeNull();
    expect(parseAudioLevelLine('Add-Type : error')).toBeNull();
    expect(parseAudioLevelLine('PS> L:0.5')).toBeNull();
    expect(parseAudioLevelLine('L:abc')).toBeNull();
    expect(parseAudioLevelLine('L:')).toBeNull();
    expect(parseAudioLevelLine('level=0.5')).toBeNull();
  });
});
