// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  applyScheme,
  captureScheme,
  resolveSchemeMode,
  restoreScheme,
  type SchemeSnapshot,
} from './agent-scheme';
import type { CdpSession } from './cdp/cdp-client';

/**
 * A CdpSession whose evaluate() drives a tiny in-memory model of the agent
 * page, so the read-back verification loop in `applyScheme` sees its own
 * writes instead of a static scripted sequence.
 *
 * Script entries are consumed in call order and double as both read seeds
 * (the first read response seeds the initial DOM/localStorage state) and
 * write responses (`'ok'` = write applied, `'err'` = write threw, exhausted
 * script = `'null'` so retries exhaust rather than falsely succeeding).
 *
 * Read expressions return the live state, so a successful write is reflected
 * on the next read-back; a failed write leaves the state untouched.
 */
function scriptedSession(script: string[]): { calls: string[]; session: CdpSession } {
  const calls: string[] = [];
  let cursor = 0;
  let dataTheme: string | null = null;
  const storage: Record<string, string | null> = {};
  let stateSeeded = false;
  let pageUnreadable = false;

  const session: CdpSession = {
    send: async <T = unknown>() => undefined as T,
    evaluate: async (expression: string) => {
      calls.push(expression);

      // Write expression: returns 'ok' | 'err' from the script (default
      // 'null' = failure, so retries exhaust instead of falsely succeeding).
      if (expression.includes("return 'ok'")) {
        const response = script[cursor++] ?? 'null';
        if (response === 'ok') {
          const dtMatch = expression.match(/setAttribute\('data-theme',\s*"((?:[^"\\]|\\.)*)"\)/);
          if (dtMatch) dataTheme = dtMatch[1];
          if (/removeAttribute\('data-theme'\)/.test(expression)) dataTheme = null;
          for (const m of expression.matchAll(
            /localStorage\.setItem\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/g,
          )) {
            try {
              storage[JSON.parse(m[1]) as string] = JSON.parse(m[2]) as string;
            } catch {
              /* ignore malformed */
            }
          }
          for (const m of expression.matchAll(
            /localStorage\.removeItem\(\s*("(?:[^"\\]|\\.)*")\s*\)/g,
          )) {
            try {
              delete storage[JSON.parse(m[1]) as string];
            } catch {
              /* ignore malformed */
            }
          }
        }
        return response;
      }

      // Read expression: seed live state from the first scripted read
      // response, then return the live state so read-back reflects writes.
      if (expression.includes('JSON.stringify({')) {
        if (!stateSeeded) {
          stateSeeded = true;
          const seed = script[cursor++] ?? 'null';
          if (!seed || seed === 'null') {
            pageUnreadable = true;
          } else {
            try {
              const parsed = JSON.parse(seed) as {
                dataTheme: string | null;
                storage: Record<string, string | null>;
              };
              dataTheme = parsed.dataTheme ?? null;
              for (const [k, v] of Object.entries(parsed.storage ?? {})) {
                storage[k] = v ?? null;
              }
            } catch {
              pageUnreadable = true;
            }
          }
        }
        if (pageUnreadable) return 'null';
        return JSON.stringify({ dataTheme, storage });
      }

      return 'null';
    },
    close: () => undefined,
  };
  return { calls, session };
}

describe('resolveSchemeMode', () => {
  it('should map explicit light/dark straight through', () => {
    expect(resolveSchemeMode('light')).toBe('light');
    expect(resolveSchemeMode('dark')).toBe('dark');
  });

  it('should map auto to light to match the unified auto fallback (community-color-bridge + buildContext)', () => {
    expect(resolveSchemeMode('auto')).toBe('light');
  });

  it('should return null for missing/unknown modes', () => {
    expect(resolveSchemeMode(undefined)).toBeNull();
    expect(resolveSchemeMode('sepia')).toBeNull();
    expect(resolveSchemeMode(null)).toBeNull();
  });
});

describe('captureScheme', () => {
  it('should read data-theme and tracked localStorage keys', async () => {
    const { calls, session } = scriptedSession([
      JSON.stringify({
        dataTheme: 'light-parchment',
        storage: {
          theme: 'light-parchment',
          'preferences:theme-brightness': '"light"',
          'preferences:theme-color': '"parchment"',
        },
      }),
    ]);
    const snapshot = await captureScheme(session, 'qoderwork');
    expect(snapshot).toEqual({
      agentId: 'qoderwork',
      dataTheme: 'light-parchment',
      storage: {
        theme: 'light-parchment',
        'preferences:theme-brightness': '"light"',
        'preferences:theme-color': '"parchment"',
      },
    });
    // The read expression must query every tracked key.
    expect(calls[0]).toContain('preferences:theme-brightness');
    expect(calls[0]).toContain('preferences:theme-color');
  });

  it('should return null for agents with no renderer scheme (workbuddy)', async () => {
    const { calls, session } = scriptedSession([]);
    expect(await captureScheme(session, 'workbuddy')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('should return null when the page read fails', async () => {
    const { session } = scriptedSession(['null']);
    expect(await captureScheme(session, 'traework')).toBeNull();
  });
});

describe('applyScheme', () => {
  it('should flip qoderwork to dark while preserving the colour variant (mode-first)', async () => {
    const { calls, session } = scriptedSession([
      JSON.stringify({ dataTheme: 'light-parchment', storage: {} }),
      'ok',
    ]);
    expect(await applyScheme(session, 'qoderwork', 'dark')).toBe(true);
    const write = calls[1];
    expect(write).toContain('"dark-parchment"');
    expect(write).toContain('preferences:theme-brightness');
    // The colour variant key must NOT be overwritten on apply.
    expect(write).not.toContain('preferences:theme-color');
  });

  it('should flip qoderwork colour-first variants (classic-light -> classic-dark)', async () => {
    const { calls, session } = scriptedSession([
      JSON.stringify({ dataTheme: 'classic-light', storage: {} }),
      'ok',
    ]);
    expect(await applyScheme(session, 'qoderwork', 'dark')).toBe(true);
    expect(calls[1]).toContain('"classic-dark"');
  });

  it('should fall back to the bare mode when there is no current variant', async () => {
    const { calls, session } = scriptedSession([
      JSON.stringify({ dataTheme: null, storage: {} }),
      'ok',
    ]);
    expect(await applyScheme(session, 'qoderwork', 'light')).toBe(true);
    expect(calls[1]).toContain('setAttribute(\'data-theme\', "light")');
  });

  it('should switch traework and sync body classes + JSON storage format', async () => {
    const { calls, session } = scriptedSession([
      JSON.stringify({ dataTheme: 'dark', storage: {} }),
      'ok',
    ]);
    expect(await applyScheme(session, 'traework', 'light')).toBe(true);
    const write = calls[1];
    expect(write).toContain("classList.add('light', 'vs-light')");
    expect(write).toContain("classList.remove('dark', 'vs-dark')");
    // The fix: Trae keys its mode off <html> too, so the root element must be
    // toggled, not only <body>.
    expect(write).toContain("documentElement.classList.add('light', 'vs-light')");
    expect(write).toContain('documentElement.style.colorScheme = "light"');
    expect(write).toContain('trae-foundation-theme');
    // The app stores the key as a JSON string like {"value":"light"}.
    expect(write).toContain('value');
  });

  it('should be a successful no-op for workbuddy (no evaluate calls)', async () => {
    const { calls, session } = scriptedSession([]);
    expect(await applyScheme(session, 'workbuddy', 'dark')).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('should report failure when the injected write throws', async () => {
    const { session } = scriptedSession([
      JSON.stringify({ dataTheme: 'dark', storage: {} }),
      'err',
    ]);
    expect(await applyScheme(session, 'qoderwork', 'light')).toBe(false);
  });
});

describe('restoreScheme', () => {
  it('should write back the captured attribute and storage, removing absent keys', async () => {
    const snapshot: SchemeSnapshot = {
      agentId: 'qoderwork',
      dataTheme: 'light-parchment',
      storage: {
        theme: 'light-parchment',
        'preferences:theme-brightness': '"light"',
        'preferences:theme-color': null,
      },
    };
    const { calls, session } = scriptedSession(['ok']);
    expect(await restoreScheme(session, snapshot)).toBe(true);
    const write = calls[0];
    expect(write).toContain('"light-parchment"');
    expect(write).toContain('localStorage.setItem("preferences:theme-brightness"');
    expect(write).toContain('localStorage.removeItem("preferences:theme-color")');
  });

  it('should remove the data-theme attribute when it was originally absent', async () => {
    const snapshot: SchemeSnapshot = { agentId: 'traework', dataTheme: null, storage: {} };
    const { calls, session } = scriptedSession(['ok']);
    expect(await restoreScheme(session, snapshot)).toBe(true);
    expect(calls[0]).toContain("removeAttribute('data-theme')");
  });

  it('should be a successful no-op for workbuddy', async () => {
    const { calls, session } = scriptedSession([]);
    const snapshot: SchemeSnapshot = { agentId: 'workbuddy', dataTheme: null, storage: {} };
    expect(await restoreScheme(session, snapshot)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
