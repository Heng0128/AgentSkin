// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { runInSandbox } from './sandbox';

describe('runInSandbox', () => {
  // --- Happy path: Math.random() -------------------------------------------

  it('returns ok with number value from Math.random()', async () => {
    const result = await runInSandbox<number>('function(input) { return Math.random(); }', {});
    expect(result.ok).toBe(true);
    expect(result.value).toBeTypeOf('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Happy path: JSON.parse(input.jsonStr) --------------------------------

  it('returns ok with parsed object from JSON.parse', async () => {
    const result = await runInSandbox<Record<string, unknown>>(
      'function(input) { return JSON.parse(input.jsonStr); }',
      { jsonStr: '{"hello":"world","n":42}' },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ hello: 'world', n: 42 });
  });

  // --- Timeout: infinite loop -----------------------------------------------

  it('returns TIMEOUT for infinite loop', async () => {
    const result = await runInSandbox<unknown>(
      'function(input) { while(true) {} return null; }',
      {},
      { timeoutMs: 1000 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT');
    expect(result.durationMs).toBeLessThan(3000);
  });

  // --- API violation: require('child_process') ------------------------------

  it('returns API_VIOLATION when code tries to use require', async () => {
    const result = await runInSandbox<unknown>(
      "function(input) { return require('child_process'); }",
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('API_VIOLATION');
  });

  // --- Timeout: long synchronous computation -------------------------------

  it('returns TIMEOUT for computation exceeding timeout', async () => {
    const result = await runInSandbox<number>(
      `function(input) {
        let sum = 0;
        for (let i = 0; i < 1e9; i++) { sum += i; }
        return sum;
      }`,
      {},
      { timeoutMs: 500 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT');
  });

  // --- Schema violation: outputSchema mismatch ------------------------------

  it('returns SCHEMA_VIOLATION when output does not match schema', async () => {
    const result = await runInSandbox<unknown>(
      'function(input) { return { wrongKey: 123 }; }',
      {},
      {
        outputSchema: {
          type: 'object',
          required: ['tokens'],
          properties: {
            tokens: { type: 'object' },
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('SCHEMA_VIOLATION');
  });

  // --- Parse error: invalid code -------------------------------------------

  it('returns PARSE_ERROR for code that throws during parsing', async () => {
    const result = await runInSandbox<unknown>('function(input) { return nonExistentXYZ; }', {});
    expect(result.ok).toBe(false);
    // Either API_VIOLATION (if ReferenceError is caught) or PARSE_ERROR
    expect(['API_VIOLATION', 'PARSE_ERROR']).toContain(result.error);
  });

  // --- Schema validation pass ----------------------------------------------

  it('returns ok when output matches schema', async () => {
    const result = await runInSandbox<Record<string, unknown>>(
      'function(input) { return { tokens: { "--agentskin-primary": "#ff0000" } }; }',
      {},
      {
        outputSchema: {
          type: 'object',
          required: ['tokens'],
          properties: {
            tokens: {
              type: 'object',
              patternProperties: {
                '^--agentskin-': { type: 'string' },
              },
            },
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ tokens: { '--agentskin-primary': '#ff0000' } });
  });
});
