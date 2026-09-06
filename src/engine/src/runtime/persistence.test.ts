// SPDX-License-Identifier: MPL-2.0

/**
 * injector.mjs 持久化脚本标识符追踪单测（RFC 2026-08-17 P1）
 *
 * 验证 P1 audit #8 语义（对照主进程 engine-strategy.ts）：
 *   1. registerPersistenceScript 记录 CDP 返回的标识符；
 *   2. 连续 apply 不会在 target 上累积脚本（旧标识符先被显式移除）；
 *   3. removePersistenceScripts 逐个移除追踪的标识符并清空集合；
 *   4. 旧 target 的失效标识符移除失败时静默容忍、不中断流程。
 *
 * 注意：`Page.addScriptToEvaluateOnNewDocument` 注册是**会话级**的（2026-08-17
 * 实证），因此生产代码把注册/移除都路由到专用长生命周期会话（persistenceSessions）。
 * 本单测用 FakeSession 替代真实 CDP WebSocket，只验证 send/evaluate 调用契约，
 * 会话存活问题由 live-reload-persistence.manual.test.ts 实测覆盖。
 */

import { describe, expect, it } from 'vitest';
import {
  listPersistenceScriptIds,
  persistenceKeyFor,
  registerPersistenceScript,
  removePersistenceScripts,
} from './injector.mjs';

/** Minimal stand-in for CdpSession that records CDP calls (no WebSocket). */
class FakeSession {
  sent: Array<{ method: string; params: Record<string, unknown> }>;
  failRemove: boolean;
  #identifiers: string[];

  constructor(identifiers: string[] = []) {
    this.sent = [];
    this.failRemove = false;
    this.#identifiers = [...identifiers];
  }

  async send(method: string, params: Record<string, unknown> = {}) {
    this.sent.push({ method, params });
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      return { identifier: this.#identifiers.shift() ?? `auto-${this.sent.length}` };
    }
    if (method === 'Page.removeScriptToEvaluateOnNewDocument' && this.failRemove) {
      throw new Error('Identifier may be from a previous target');
    }
    return {};
  }

  async evaluate() {
    return 'ok';
  }
}

describe('persistenceKeyFor', () => {
  it('composes port:targetId', () => {
    expect(persistenceKeyFor(9222, 't1')).toBe('9222:t1');
    expect(persistenceKeyFor(0, 'abc')).toBe('0:abc');
  });
});

describe('registerPersistenceScript', () => {
  it('records the returned identifier and passes runImmediately:false', async () => {
    const session = new FakeSession(['script-1']);
    const key = persistenceKeyFor(9222, 't1');
    const id = await registerPersistenceScript(session, key, 'SRC');
    expect(id).toBe('script-1');
    expect(listPersistenceScriptIds(key)).toEqual(['script-1']);
    expect(session.sent.at(-1)).toMatchObject({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: { source: 'SRC', runImmediately: false },
    });
  });

  it('replaces old scripts before registering — no accumulation across applies', async () => {
    const session = new FakeSession(['script-1', 'script-2']);
    const key = persistenceKeyFor(9222, 't1');
    await registerPersistenceScript(session, key, 'SRC-1');
    await registerPersistenceScript(session, key, 'SRC-2');
    // Only the newest script stays tracked.
    expect(listPersistenceScriptIds(key)).toEqual(['script-2']);
    // The old identifier was explicitly removed from the target.
    expect(session.sent).toContainEqual({
      method: 'Page.removeScriptToEvaluateOnNewDocument',
      params: { identifier: 'script-1' },
    });
  });

  it('tracks one identifier per distinct target key', async () => {
    const session = new FakeSession(['a', 'b']);
    await registerPersistenceScript(session, persistenceKeyFor(9222, 't1'), 'S1');
    await registerPersistenceScript(session, persistenceKeyFor(9222, 't2'), 'S2');
    expect(listPersistenceScriptIds('9222:t1')).toEqual(['a']);
    expect(listPersistenceScriptIds('9222:t2')).toEqual(['b']);
  });
});

describe('removePersistenceScripts', () => {
  it('removes every tracked identifier and clears the set', async () => {
    const session = new FakeSession(['a', 'b']);
    const key = persistenceKeyFor(9222, 't1');
    await registerPersistenceScript(session, key, 'SRC-1');
    await registerPersistenceScript(session, key, 'SRC-2');
    await removePersistenceScripts(session, key);
    expect(listPersistenceScriptIds(key)).toEqual([]);
    const removed = session.sent
      .filter((c) => c.method === 'Page.removeScriptToEvaluateOnNewDocument')
      .map((c) => c.params.identifier);
    expect(removed).toContain('a');
    expect(removed).toContain('b');
  });

  it('tolerates send() failures from a previous target and still clears tracking', async () => {
    const session = new FakeSession(['stale']);
    session.failRemove = true;
    const key = persistenceKeyFor(9222, 't1');
    await registerPersistenceScript(session, key, 'SRC');
    await removePersistenceScripts(session, key);
    expect(listPersistenceScriptIds(key)).toEqual([]);
  });

  it('is a no-op when nothing is tracked for the key', async () => {
    const session = new FakeSession([]);
    await removePersistenceScripts(session, persistenceKeyFor(9222, 'nope'));
    expect(session.sent).toEqual([]);
  });
});
