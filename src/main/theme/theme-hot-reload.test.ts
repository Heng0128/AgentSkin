// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-hot-reload.test
 *
 * Unit tests for the theme hot-reload engine.
 *
 * Covers:
 *   - parseVariables (CSS variable extraction)
 *   - diffVariables (variable-level diff)
 *   - buildVariableApplyExpression (CDP expression generation)
 *   - readPaletteVariables (file read helper)
 *   - createDebouncer (debounce timing)
 *   - ThemeHotReloader class (integration: start/stop, reload, rollback)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from '../cdp/cdp-client';
import {
  buildVariableApplyExpression,
  createDebouncer,
  diffVariables,
  parseVariables,
  readPaletteVariables,
  ThemeHotReloader,
} from './theme-hot-reload';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock CDP session that records evaluate calls. */
function makeMockSession(evaluateResult = 'ok'): {
  session: CdpSession;
  evaluateCalls: string[];
} {
  const evaluateCalls: string[] = [];
  const session: CdpSession = {
    async send<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async evaluate(expression: string): Promise<string> {
      evaluateCalls.push(expression);
      if (typeof evaluateResult === 'function') {
        return (evaluateResult as (expr: string) => string)(expression);
      }
      return evaluateResult;
    },
    close(): void {
      /* noop */
    },
  };
  return { session, evaluateCalls };
}

/** Create a temporary palette CSS file and return its path. */
function createTempPalette(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-hotreload-'));
  const filePath = path.join(tmpDir, 'palette.css');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// parseVariables
// ---------------------------------------------------------------------------

describe('parseVariables', () => {
  it('extracts --agentskin-* variables from CSS text', () => {
    const css = `
      :root {
        --agentskin-accent: #4f8cff;
        --agentskin-background: #f8fafc;
        --agentskin-foreground: #1f2937;
      }
    `;
    const result = parseVariables(css);
    expect(result['agentskin-accent']).toBe('#4f8cff');
    expect(result['agentskin-background']).toBe('#f8fafc');
    expect(result['agentskin-foreground']).toBe('#1f2937');
  });

  it('handles hyphenated variable names', () => {
    const css = '--agentskin-surface-elevated: #f8fafc;';
    const result = parseVariables(css);
    expect(result['agentskin-surface-elevated']).toBe('#f8fafc');
  });

  it('returns empty object for CSS with no agentskin variables', () => {
    const css = '--other-var: red; color: blue;';
    expect(parseVariables(css)).toEqual({});
  });

  it('returns empty object for empty input', () => {
    expect(parseVariables('')).toEqual({});
  });

  it('trims whitespace from values', () => {
    const css = '--agentskin-accent:   #4f8cff   ;';
    const result = parseVariables(css);
    expect(result['agentskin-accent']).toBe('#4f8cff');
  });
});

// ---------------------------------------------------------------------------
// diffVariables
// ---------------------------------------------------------------------------

describe('diffVariables', () => {
  it('detects changed variables', () => {
    const prev = { 'agentskin-accent': '#000000', 'agentskin-background': '#ffffff' };
    const next = { 'agentskin-accent': '#ff0000', 'agentskin-background': '#ffffff' };
    const { diff, changedKeys } = diffVariables(prev, next);
    expect(changedKeys).toEqual(['agentskin-accent']);
    expect(diff['agentskin-accent']).toBe('#ff0000');
    expect(diff['agentskin-background']).toBeUndefined();
  });

  it('detects added variables', () => {
    const prev = { 'agentskin-accent': '#000000' };
    const next = { 'agentskin-accent': '#000000', 'agentskin-border': '#cccccc' };
    const { diff, changedKeys } = diffVariables(prev, next);
    expect(changedKeys).toEqual(['agentskin-border']);
    expect(diff['agentskin-border']).toBe('#cccccc');
  });

  it('detects removed variables with empty value', () => {
    const prev = { 'agentskin-accent': '#000000', 'agentskin-border': '#cccccc' };
    const next = { 'agentskin-accent': '#000000' };
    const { diff, changedKeys } = diffVariables(prev, next);
    expect(changedKeys).toContain('agentskin-border');
    expect(diff['agentskin-border']).toBe('');
  });

  it('returns empty diff when snapshots are identical', () => {
    const snap = { 'agentskin-accent': '#4f8cff' };
    const { diff, changedKeys } = diffVariables(snap, { ...snap });
    expect(changedKeys).toEqual([]);
    expect(diff).toEqual({});
  });

  it('handles empty prev snapshot (all new)', () => {
    const next = { 'agentskin-accent': '#4f8cff', 'agentskin-bg': '#fff' };
    const { diff, changedKeys } = diffVariables({}, next);
    expect(changedKeys.sort()).toEqual(['agentskin-accent', 'agentskin-bg']);
    expect(diff).toEqual(next);
  });
});

// ---------------------------------------------------------------------------
// buildVariableApplyExpression
// ---------------------------------------------------------------------------

describe('buildVariableApplyExpression', () => {
  it('builds a valid IIFE that calls setProperty', () => {
    const diff = { 'agentskin-accent': '#ff0000' };
    const expr = buildVariableApplyExpression(diff);
    expect(expr).toContain('document.documentElement');
    expect(expr).toContain("setProperty('agentskin-accent', '#ff0000')");
    expect(expr).toContain("return 'ok'");
  });

  it('generates removeProperty for empty values', () => {
    const diff = { 'agentskin-border': '' };
    const expr = buildVariableApplyExpression(diff);
    expect(expr).toContain("removeProperty('agentskin-border')");
  });

  it('escapes single quotes in values', () => {
    const diff = { 'agentskin-font': "JetBrains Mono, 'monospace'" };
    const expr = buildVariableApplyExpression(diff);
    expect(expr).toContain("JetBrains Mono, \\'monospace\\'");
  });

  it('handles mixed set and remove operations', () => {
    const diff = { 'agentskin-accent': '#4f8cff', 'agentskin-old': '' };
    const expr = buildVariableApplyExpression(diff);
    expect(expr).toContain("setProperty('agentskin-accent'");
    expect(expr).toContain("removeProperty('agentskin-old')");
  });
});

// ---------------------------------------------------------------------------
// readPaletteVariables
// ---------------------------------------------------------------------------

describe('readPaletteVariables', () => {
  let tmpFile: string;

  afterEach(() => {
    if (tmpFile) {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    }
  });

  it('reads variables from an existing file', () => {
    tmpFile = createTempPalette('--agentskin-accent: #4f8cff;');
    const result = readPaletteVariables(tmpFile);
    expect(result['agentskin-accent']).toBe('#4f8cff');
  });

  it('returns empty snapshot for non-existent file', () => {
    const result = readPaletteVariables('/nonexistent/palette.css');
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// createDebouncer
// ---------------------------------------------------------------------------

describe('createDebouncer', () => {
  it('debounces rapid calls into a single invocation', async () => {
    const fn = vi.fn();
    const debouncer = createDebouncer(fn, 50);

    debouncer();
    debouncer();
    debouncer();

    expect(fn).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents the deferred call', async () => {
    const fn = vi.fn();
    const debouncer = createDebouncer(fn, 50);

    debouncer();
    debouncer.cancel();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires after the specified delay', async () => {
    const fn = vi.fn();
    const debouncer = createDebouncer(fn, 30);

    debouncer();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ThemeHotReloader (integration)
// ---------------------------------------------------------------------------

describe('ThemeHotReloader', () => {
  let tmpFile: string;
  const baseCss = '--agentskin-accent: #4f8cff;\n--agentskin-background: #ffffff;\n';

  beforeEach(() => {
    tmpFile = createTempPalette(baseCss);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it('start() establishes baseline from file', () => {
    const { session } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });

    reloader.start();
    expect(reloader.isActive()).toBe(true);
    expect(reloader.getSnapshot()).toEqual({
      'agentskin-accent': '#4f8cff',
      'agentskin-background': '#ffffff',
    });
    reloader.dispose();
  });

  it('dispose() stops the watcher and cancels debounce', () => {
    const { session } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });

    reloader.start();
    expect(reloader.isActive()).toBe(true);
    reloader.dispose();
    expect(reloader.isActive()).toBe(false);
  });

  it('reloadNow() applies variable changes via CDP', async () => {
    const { session, evaluateCalls } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });
    reloader.start();

    // Modify the file.
    fs.writeFileSync(
      tmpFile,
      '--agentskin-accent: #ff0000;\n--agentskin-background: #ffffff;\n',
      'utf8',
    );

    const result = await reloader.reloadNow();

    expect(result.success).toBe(true);
    expect(result.changedCount).toBe(1);
    expect(result.changedKeys).toEqual(['agentskin-accent']);
    expect(result.noOp).toBe(false);
    expect(evaluateCalls.length).toBe(1);
    expect(evaluateCalls[0]).toContain("setProperty('agentskin-accent', '#ff0000')");
    reloader.dispose();
  });

  it('reloadNow() returns noOp when nothing changed', async () => {
    const { session, evaluateCalls } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });
    reloader.start();

    const result = await reloader.reloadNow();

    expect(result.noOp).toBe(true);
    expect(result.success).toBe(true);
    expect(result.changedCount).toBe(0);
    expect(evaluateCalls.length).toBe(0);
    reloader.dispose();
  });

  it('reloadNow() triggers rollback on CDP failure', async () => {
    const { session, evaluateCalls } = makeMockSession('err:simulated-failure');
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });
    reloader.start();

    // Modify the file.
    fs.writeFileSync(
      tmpFile,
      '--agentskin-accent: #ff0000;\n--agentskin-background: #000000;\n',
      'utf8',
    );

    const result = await reloader.reloadNow();

    expect(result.success).toBe(false);
    expect(result.error).toContain('err:simulated-failure');
    // Should have: 1 failed apply + 1 rollback call = 2 evaluate calls.
    expect(evaluateCalls.length).toBe(2);
    // The rollback call should restore the original accent value.
    expect(evaluateCalls[1]).toContain("setProperty('agentskin-accent', '#4f8cff')");
    reloader.dispose();
  });

  it('reloadNow() handles CDP evaluate throwing', async () => {
    const session: CdpSession = {
      async send<T = unknown>(): Promise<T> {
        return {} as T;
      },
      async evaluate(): Promise<string> {
        throw new Error('WebSocket closed');
      },
      close(): void {
        /* noop */
      },
    };
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });
    reloader.start();

    fs.writeFileSync(tmpFile, '--agentskin-accent: #ff0000;\n', 'utf8');

    const result = await reloader.reloadNow();

    expect(result.success).toBe(false);
    expect(result.error).toContain('WebSocket closed');
    reloader.dispose();
  });

  it('start() is idempotent (calling twice does not create two watchers)', () => {
    const { session } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });

    reloader.start();
    reloader.start();
    expect(reloader.isActive()).toBe(true);
    reloader.dispose();
  });

  it('stop() transitions isActive to false', () => {
    const { session } = makeMockSession();
    const reloader = new ThemeHotReloader({ palettePath: tmpFile, session });

    reloader.start();
    reloader.stop();
    expect(reloader.isActive()).toBe(false);
    reloader.dispose();
  });

  it('accepts an initialSnapshot to skip baseline file read', async () => {
    const { session, evaluateCalls } = makeMockSession();
    const initial = { 'agentskin-accent': '#000000' };
    const reloader = new ThemeHotReloader({
      palettePath: tmpFile,
      session,
      initialSnapshot: initial,
    });
    reloader.start();

    // File has different values, but initialSnapshot overrides baseline.
    // Modify the file with a DIFFERENT value from initialSnapshot.
    fs.writeFileSync(tmpFile, '--agentskin-accent: #123456;\n', 'utf8');

    const result = await reloader.reloadNow();

    // Should detect change from initialSnapshot (#000000) → file (#123456).
    expect(result.success).toBe(true);
    expect(result.changedKeys).toContain('agentskin-accent');
    expect(evaluateCalls.length).toBe(1);
    reloader.dispose();
  });
});
