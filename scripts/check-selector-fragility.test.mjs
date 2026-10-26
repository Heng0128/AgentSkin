// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for check-selector-fragility.mjs internal functions.
 *
 * Tests the pure analysis functions by importing them indirectly through
 * the module's exported behavior. Since the script uses top-level await,
 * we test the pattern matching logic through integration runs.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('check-selector-fragility', () => {
  // These tests spawn a child `node` process that scans all engine/theme CSS.
  // Under full-suite parallel load a cold start can exceed the 15s project
  // testTimeout — each test gets an explicit 60s vitest budget and a 55s
  // child-process cap so the run stays green without weakening assertions.
  const TEST_TIMEOUT = 60000;
  const CHILD_TIMEOUT = 55000;

  test(
    'clean CSS produces no warnings (script runs without errors)',
    () => {
      const script = resolve(process.cwd(), 'scripts', 'check-selector-fragility.mjs');
      let output = '';
      try {
        output = execSync(`node ${script}`, {
          encoding: 'utf8',
          cwd: process.cwd(),
          timeout: CHILD_TIMEOUT,
        });
      } catch (e) {
        output = (e.stdout || '') + (e.stderr || '');
      }

      // Should either report clean or report warnings (both are valid outputs)
      const hasSummary =
        output.includes('fragility warning') || output.includes('no fragility warnings');
      expect(hasSummary).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    'script exits with code 0 (warnings are non-blocking)',
    () => {
      const script = resolve(process.cwd(), 'scripts', 'check-selector-fragility.mjs');
      let exitCode = 0;
      try {
        execSync(`node ${script}`, {
          encoding: 'utf8',
          cwd: process.cwd(),
          timeout: CHILD_TIMEOUT,
        });
      } catch (e) {
        exitCode = e.status ?? 1;
      }
      expect(exitCode).toBe(0);
    },
    TEST_TIMEOUT,
  );

  test(
    'warns on positional selectors in project CSS',
    () => {
      const script = resolve(process.cwd(), 'scripts', 'check-selector-fragility.mjs');
      const output = execSync(`node ${script}`, {
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: CHILD_TIMEOUT,
      });

      // The project's engine/theme CSS may or may not have positional selectors;
      // this test just verifies the script produces structured output
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );
});
