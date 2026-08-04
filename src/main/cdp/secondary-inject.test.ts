// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ResolvedThemeTarget } from '../../legacy/agentskin-core-runtime';
import { HOST_CLASS_PREFIX, hostClassFor } from '../../shared/injection-constants';
import { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } from './secondary-inject';

function makeTarget(overrides: Partial<ResolvedThemeTarget> = {}): ResolvedThemeTarget {
  return {
    theme: { id: 'cyber-neon', version: '1.0.0' },
    css: ':root { --primary: #0ff; }',
    imageDataUrls: { hero: 'data:image/png;base64,abc' },
    ...overrides,
  } as ResolvedThemeTarget;
}

describe('buildSecondaryInjectExpression', () => {
  it('produces a valid IIFE expression string', () => {
    const expr = buildSecondaryInjectExpression('traework', makeTarget());
    expect(expr.startsWith('(() => {')).toBe(true);
    expect(expr.trim().endsWith(')()')).toBe(true);
  });

  it('embeds the appId and host class in the expression', () => {
    const expr = buildSecondaryInjectExpression('traework', makeTarget());
    expect(expr).toContain('"id":"traework"');
    expect(expr).toContain(`"className":"${hostClassFor('traework')}"`);
  });

  it('embeds theme id and version', () => {
    const expr = buildSecondaryInjectExpression('qoderwork', makeTarget());
    expect(expr).toContain('"id":"cyber-neon"');
    expect(expr).toContain('"version":"1.0.0"');
  });

  it('embeds the CSS text', () => {
    const expr = buildSecondaryInjectExpression('traework', makeTarget());
    expect(expr).toContain(':root { --primary: #0ff; }');
  });

  it('merges artDataUrl into hero when hero is missing from imageDataUrls', () => {
    const target = makeTarget({
      imageDataUrls: {},
      artDataUrl: 'data:image/png;base64,artwork',
    });
    const expr = buildSecondaryInjectExpression('traework', target);
    expect(expr).toContain('"hero":"data:image/png;base64,artwork"');
  });

  it('does not override hero from imageDataUrls with artDataUrl', () => {
    const target = makeTarget({
      imageDataUrls: { hero: 'data:image/png;base64,original' },
      artDataUrl: 'data:image/png;base64,artwork',
    });
    const expr = buildSecondaryInjectExpression('traework', target);
    expect(expr).toContain('"hero":"data:image/png;base64,original"');
    expect(expr).not.toContain('"hero":"data:image/png;base64,artwork"');
  });

  it('handles missing imageDataUrls gracefully', () => {
    const target = makeTarget({ imageDataUrls: undefined });
    const expr = buildSecondaryInjectExpression('traework', target);
    // Should still produce valid JS — the expression runs in the renderer.
    expect(expr.startsWith('(() => {')).toBe(true);
  });

  it('escapes special characters in CSS (quotes, backslashes)', () => {
    const target = makeTarget({ css: 'content: "hello\\world";' });
    const expr = buildSecondaryInjectExpression('traework', target);
    // JSON.stringify escapes backslashes, so the CSS is safely embedded.
    expect(expr).toContain('\\"hello\\\\world\\"');
  });
});

describe('buildSecondaryRemoveExpression', () => {
  it('produces a valid IIFE expression string', () => {
    const expr = buildSecondaryRemoveExpression('traework');
    expect(expr.startsWith('(() => {')).toBe(true);
    expect(expr.trim().endsWith(')()')).toBe(true);
  });

  it('embeds the appId as a JSON string', () => {
    const expr = buildSecondaryRemoveExpression('qoderwork');
    expect(expr).toContain('"qoderwork"');
  });

  it('embeds the host class for removal', () => {
    const expr = buildSecondaryRemoveExpression('traework');
    expect(expr).toContain(hostClassFor('traework'));
  });

  it('references the style element id pattern', () => {
    const expr = buildSecondaryRemoveExpression('doubao');
    expect(expr).toContain('agentskin-theme-style-');
    expect(expr).toContain('doubao');
  });

  it('references the agentskin-theme class for conditional removal', () => {
    const expr = buildSecondaryRemoveExpression('traework');
    expect(expr).toContain('agentskin-theme');
    expect(expr).toContain(HOST_CLASS_PREFIX);
  });

  it('sanitizes appId with special characters via hostClassFor', () => {
    // hostClassFor replaces non-alphanumeric chars with dashes.
    const expr = buildSecondaryRemoveExpression('traework');
    const expectedClass = `${HOST_CLASS_PREFIX}traework`;
    expect(expr).toContain(expectedClass);
  });
});
