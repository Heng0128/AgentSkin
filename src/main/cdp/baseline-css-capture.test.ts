// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  captureBaselineCss,
  definesVar,
  extractVarDependencies,
  findStylesheetDefiningVar,
} from './baseline-css-capture';
import type { CdpSession } from './cdp-client';

/** Build a mock CdpSession driven by a map of responses per (method, params). */
function makeSession(
  docs: {
    matched?: Record<string, unknown[]>; // nodeId -> matchedCSSRules
    texts?: Record<string, string>; // styleSheetId -> text
    queryResult?: (selector: string) => number | null;
  } = {},
): { session: CdpSession; calls: string[] } {
  const calls: string[] = [];
  const session: CdpSession = {
    async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push(method);
      switch (method) {
        case 'DOM.enable':
        case 'CSS.enable':
          return {} as T;
        case 'Debugger.setJavaScriptEnabled':
          return {} as T;
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } } as T;
        case 'DOM.querySelector': {
          const selector = String(params.selector ?? '');
          const nodeId = docs.queryResult?.(selector) ?? (selector === ':root' ? 99 : 2);
          return { nodeId } as T;
        }
        case 'CSS.getMatchedStylesForNode': {
          const nodeId = Number(params.nodeId);
          return { matchedCSSRules: docs.matched?.[nodeId] ?? [] } as T;
        }
        case 'CSS.getStyleSheetText': {
          const id = String(params.styleSheetId);
          return { text: docs.texts?.[id] ?? null } as T;
        }
        default:
          return {} as T;
      }
    },
    async evaluate(): Promise<string> {
      return 'null';
    },
    close(): void {
      /* noop */
    },
  };
  return { session, calls };
}

/** 构造一个匹配规则外包。 */
function rule(styleSheetId: string, origin = 'regular'): unknown {
  return { rule: { styleSheetId, origin } };
}

describe('baseline-css-capture pure helpers', () => {
  it('extracts var() custom-property names', () => {
    const css = `:root { --p: #fff; color: var(--text-a); background: var(--text-a, red) var(--b); }`;
    expect(extractVarDependencies(css)).toEqual(expect.arrayContaining(['--text-a', '--b']));
    // 去重
    const single = extractVarDependencies('a{color:var(--x)} b{color:var(--x)}');
    expect(single).toEqual(['--x']);
  });

  it('detects var definitions (definesVar)', () => {
    expect(definesVar(':root{--brand:#0ff;} *{color:var(--brand)}', '--brand')).toBe(true);
    expect(definesVar(':root{--brand:#0ff;}', '--missing')).toBe(false);
    expect(definesVar('a{color:red}', '--x')).toBe(false);
  });

  it('findStylesheetDefiningVar locates the defining sheet', () => {
    const sheets = [
      {
        styleSheetId: 'a',
        firstMatchedFor: 'x',
        cssText: '.c{color:var(--p)}',
        matchedSelectors: ['.c'],
      },
      {
        styleSheetId: 'b',
        firstMatchedFor: 'x',
        cssText: ':root{--p:#000}',
        matchedSelectors: [':root'],
      },
    ];
    expect(findStylesheetDefiningVar(sheets, '--p')?.styleSheetId).toBe('b');
    expect(findStylesheetDefiningVar(sheets, '--nope')).toBeNull();
  });
});

describe('captureBaselineCss (mock CDP)', () => {
  it('collects only regular-origin stylesheets & dedupes by id', async () => {
    const { session } = makeSession({
      matched: {
        2: [
          rule('sheet-main'),
          rule('sheet-main'), // 同表重复命中
          rule('sheet-ua', 'user-agent'),
        ],
      },
      texts: { 'sheet-main': ':root{--bg:#000} .panel{background:var(--bg)}' },
    });
    const cap = await captureBaselineCss(session, 'traework', {
      componentSelectors: ['.panel-container'],
    });
    expect(cap.stylesheets).toHaveLength(1);
    expect(cap.stylesheets[0].styleSheetId).toBe('sheet-main');
    expect(cap.stylesheets[0].cssText).toContain('--bg');
    // user-agent 被过滤
    expect(cap.stylesheets.map((s) => s.styleSheetId)).not.toContain('sheet-ua');
    expect(cap.complete).toBe(true);
    expect(cap.jsFrozen).toBe(true);
    expect(cap.varDependencies).toContain('--bg');
  });

  it('does NOT freeze JS when freezeJs=false', async () => {
    const { calls } = makeSession({ texts: {} });
    await captureBaselineCss(makeSession({ texts: {} }).session, 'zcode', { freezeJs: false });
    expect(calls).not.toContain('Debugger.setJavaScriptEnabled');
  });

  it('marks jsFrozen=false and degrades gracefully when Debugger freeze throws', async () => {
    const { session } = makeSession({ texts: {} });
    // 覆盖 freeze 抛错：重新构造一个抛错的 send
    const throwing: CdpSession = {
      send: async (method: string) => {
        if (method === 'Debugger.setJavaScriptEnabled') throw new Error('freeze fail');
        return session.send(method);
      },
      evaluate: session.evaluate,
      close: () => {},
    };
    const cap = await captureBaselineCss(throwing, 'traework');
    expect(cap.jsFrozen).toBe(false);
    expect(cap.stylesheets).toBeDefined();
  });

  it('marks complete=false when a hit stylesheet text cannot be fetched', async () => {
    const { session } = makeSession({
      matched: { 2: [rule('sheet-missing')] },
      texts: {}, // sheet-missing 无原文
    });
    const cap = await captureBaselineCss(session, 'doubao', {
      componentSelectors: ['#root'],
    });
    expect(cap.complete).toBe(false);
    expect(cap.stylesheets).toHaveLength(0);
  });

  it('returns empty (not throw) when getDocument yields no root', async () => {
    const session: CdpSession = {
      send: async <T = unknown>(method: string): Promise<T> => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 0 } } as T;
        return {} as T;
      },
      evaluate: async () => 'null',
      close: () => {},
    };
    const cap = await captureBaselineCss(session, 'codex');
    expect(cap.stylesheets).toHaveLength(0);
  });

  it('uses :root by default and dedupes var deps from repeated sheets', async () => {
    const { session, calls } = makeSession({
      matched: { 99: [rule('root-sheet')] },
      texts: { 'root-sheet': ':root{--a:#1;--b:#2} x{color:var(--a) var(--b) var(--a)}' },
    });
    const cap = await captureBaselineCss(session, 'workbuddy');
    expect(calls).toContain('CSS.getStyleSheetText');
    expect(cap.stylesheets).toHaveLength(1);
    // --a 去重
    expect(cap.varDependencies.filter((v) => v === '--a')).toHaveLength(1);
    expect(cap.varDependencies).toContain('--b');
  });
});
