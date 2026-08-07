// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { MAX_CSS_LENGTH, MAX_DECL_COUNT, sanitizeCSS } from './safe-css';

// ---------------------------------------------------------------------------
// Legacy-safe describe.each (Vitest supports it since 0.25).
// ---------------------------------------------------------------------------

describe('sanitizeCSS — passthrough', () => {
  it('empty string returns clean empty', () => {
    const r = sanitizeCSS('');
    expect(r.clean).toBe('');
    expect(r.blocked).toBe(false);
  });

  it('whitespace-only returns clean empty', () => {
    const r = sanitizeCSS('   \n\t  ');
    expect(r.clean).toBe('');
  });

  it('preserves safe custom properties', () => {
    const input = '--agentskin-accent:#FF453A;--agentskin-bg:#0E1116;--agentskin-text:#E5E7EB';
    const r = sanitizeCSS(input);
    expect(r.clean).toBe(input);
    expect(r.blocked).toBe(false);
  });

  it('preserves px/em/rem units and rgba values', () => {
    const input = 'font-size:14px;border-radius:8px;background:rgba(0,0,0,.5)';
    const r = sanitizeCSS(input);
    expect(r.clean.replace(/\s/g, '')).toBe(input);
    expect(r.blocked).toBe(false);
  });

  it('preserves CSS comments with benign content', () => {
    const input = '/* theme accent */color:#FF453A';
    const r = sanitizeCSS(input);
    expect(r.clean).toContain('color:#FF453A');
    expect(r.blocked).toBe(false);
  });
});

describe('sanitizeCSS — dangerous URL payloads', () => {
  it('blocks javascript: URL', () => {
    const r = sanitizeCSS("background:url('javascript:alert(1)')");
    expect(r.blocked).toBe(true);
    expect(r.clean).not.toContain('javascript');
    expect(r.reasons.some((x) => x.includes('Blocked value'))).toBe(true);
  });

  it('blocks vbscript: URL', () => {
    const r = sanitizeCSS("behavior:url('vbscript:msgbox')");
    expect(r.blocked).toBe(true);
  });

  it('blocks data:text/html payload in url()', () => {
    const r = sanitizeCSS("background:url('data:text/html,<script>alert(1)</script>')");
    expect(r.blocked).toBe(true);
  });

  it('allows data:image (safer)', () => {
    const r = sanitizeCSS("background:url('data:image/svg+xml,<svg></svg>')");
    expect(r.blocked).toBe(false);
  });

  it('blocks http:// external url in background', () => {
    const r = sanitizeCSS("background:url('https://evil.com/exfil')");
    expect(r.blocked).toBe(true);
  });

  it('blocks https:// with mixed case', () => {
    const r = sanitizeCSS("background:url('HTTPS://evil.com/x')");
    expect(r.blocked).toBe(true);
  });
});

describe('sanitizeCSS — dangerous properties', () => {
  it('blocks expression() in IE', () => {
    const r = sanitizeCSS('width:expression(alert(1))');
    expect(r.blocked).toBe(true);
    expect(r.clean).toBe('');
  });

  it('blocks -ms-behavior (IE8 hack)', () => {
    const r = sanitizeCSS('behavior:url(#default#userData)');
    expect(r.blocked).toBe(true);
  });

  it('blocks -webkit-app-region (Electron title-bar hijack)', () => {
    const r = sanitizeCSS('-webkit-app-region:drag');
    expect(r.blocked).toBe(true);
    expect(r.reasons.some((x) => x.includes('app-region'))).toBe(true);
  });

  it('blocks binding (Firefox XBL)', () => {
    const r = sanitizeCSS('-moz-binding:url(evil.xml#xss)');
    expect(r.blocked).toBe(true);
  });
});

describe('sanitizeCSS — @rule threats', () => {
  it('blocks @import of external CSS', () => {
    const r = sanitizeCSS("@import url('https://evil.com/theme.css');");
    expect(r.blocked).toBe(true);
    expect(r.clean).not.toContain('@import');
  });

  it('blocks @font-face (external font load)', () => {
    const r = sanitizeCSS("@font-face{font-family:'evil';src:url('https://evil.com/f.woff')}");
    expect(r.blocked).toBe(true);
    expect(r.clean).not.toContain('@font-face');
  });

  it('blocks @charset (UTF-7 XSS)', () => {
    const r = sanitizeCSS('@charset "UTF-7";');
    expect(r.blocked).toBe(true);
  });

  it('preserves benign @media blocks', () => {
    const input = '@media (prefers-color-scheme:dark){color:#FFF}';
    const r = sanitizeCSS(input);
    // Doesn't need to preserve the block verbatim — just not block on
    // false-positive. Here the @media wrapper getsDECL-splitted.
    expect(r.blocked).toBe(false);
  });
});

describe('sanitizeCSS — structural limits', () => {
  it('rejects input over MAX_CSS_LENGTH', () => {
    const huge = `color:red;`.repeat(Math.ceil(MAX_CSS_LENGTH / 10) + 1);
    const r = sanitizeCSS(huge);
    expect(r.blocked).toBe(true);
    expect(r.clean).toBe('');
  });

  it('rejects input over MAX_DECL_COUNT', () => {
    // Bypass length count: use short declarations at high decl count.
    const input = Array(MAX_DECL_COUNT + 5)
      .fill('a:1')
      .join(';');
    const r = sanitizeCSS(input);
    expect(r.blocked).toBe(true);
  });

  it('accepts input under the limit', () => {
    const input = 'color:red;background:blue;font-size:14px';
    const r = sanitizeCSS(input);
    expect(r.blocked).toBe(false);
  });
});

describe('sanitizeCSS — quote escaping & style-tag close', () => {
  it('blocks </style> breakout attempt', () => {
    const r = sanitizeCSS('</style><script>alert(1)</script><style>');
    expect(r.blocked).toBe(true);
  });

  it('sanitizes input with balanced quotes in url()', () => {
    const r = sanitizeCSS("background:url('safe.png')");
    // Local (relative) URL — benign, should not be flagged.
    expect(r.blocked).toBe(false);
    expect(r.clean).toContain('background');
    // The key point is: no crash, no throw.
  });

  it('does not flag url() with a bare data:svg (no exfil threat)', () => {
    const r = sanitizeCSS(
      'background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E")',
    );
    expect(r.blocked).toBe(false);
  });

  it('does not throw on empty-colon declarations', () => {
    expect(() => sanitizeCSS(':;:;:')).not.toThrow();
  });

  it('preserves escapes in CSS', () => {
    const input = "content:'\\2014'"; // em-dash escape
    const r = sanitizeCSS(input);
    expect(r.clean).toContain('content');
  });
});

describe('sanitizeCSS — Pure function guarantee', () => {
  it('does not mutate its input', () => {
    const input = 'color:#FF453A;background:blue';
    const before = input;
    sanitizeCSS(input);
    expect(input).toBe(before);
  });
});

describe('sanitizeCSS — reasons deduplication', () => {
  it('deduplicates identical reasons', () => {
    const input = ["background:url('javascript:1')", "background:url('javascript:2')"].join(';');
    const r = sanitizeCSS(input);
    const uniqueReasons = new Set(r.reasons);
    expect(uniqueReasons.size).toBe(r.reasons.length);
  });
});
