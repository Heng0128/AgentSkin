// SPDX-License-Identifier: MPL-2.0

/**
 * preflight.mjs 单测（RFC §5 S5 / 批 F —— 双轨 preflight + fallback 重绑定）
 *
 * 纯逻辑，DOM 以轻量 fake 注入：`querySelector` 按 选择器→元素 查表返回。
 * 使用 codex 真实的 root fallback 链（main.main-surface → main → #root → body > div）
 * 保证判定确定性：
 *   primary=index0，fallback=index>0，miss=全链未命中。
 */

import { describe, expect, it } from 'vitest';
import {
  classifyTrack,
  decideBaselineTrack,
  probeSemanticTracks,
  rebindSnapshot,
  resolveBindingIndex,
} from './preflight.mjs';

const CODE = 'codex';
// codex.root 的真实 fallback 链（selectivity-registry.mjs:100-110）
const ROOT_PRIMARY = 'main.main-surface';
const ROOT_FALLBACK = 'main';

function makeNode() {
  // 非零尺寸且无 getComputedStyle → isVisible 判可见
  return { getBoundingClientRect: () => ({ width: 10, height: 10 }) };
}

/** 构造按「选择器→元素」查表的 fake document；未登记的返回 null。 */
function makeDoc(entries: Record<string, unknown>): { querySelector(selector: string): unknown } {
  const map = new Map(Object.entries(entries ?? {}));
  return {
    querySelector(selector: string) {
      return map.has(selector) ? map.get(selector) : null;
    },
  };
}

function makeKey(overrides = {}) {
  return { appId: CODE, appVersion: '2.10.0', themeMode: 'dark', schema: '1', ...overrides };
}

interface RebindResult {
  snapshot: { nodes: Array<{ semantic?: string; selector: string }> };
  rebound: number;
  stale: string[];
  map: Record<string, string>;
}

function makeSnapshot(key = makeKey(), overrides = {}) {
  return {
    schemaVersion: 1,
    appId: key.appId,
    appVersion: key.appVersion,
    themeMode: key.themeMode,
    route: '/home',
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    nodes: [
      { semantic: 'root', selector: ROOT_FALLBACK, tag: 'main', depth: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, styles: {}, customProperties: {} },
    ],
    rootCustomProperties: {},
    capturedAt: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

// ---- classifyTrack / resolveBindingIndex ----

describe('classifyTrack', () => {
  it('maps null / 0 / >0 to miss / primary / fallback', () => {
    expect(classifyTrack(null)).toBe('miss');
    expect(classifyTrack(0)).toBe('primary');
    expect(classifyTrack(1)).toBe('fallback');
    expect(classifyTrack(3)).toBe('fallback');
  });
});

describe('resolveBindingIndex', () => {
  it('returns index 0 when the primary selector resolves', () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: makeNode() });
    expect(resolveBindingIndex(CODE, 'root', doc)).toEqual({ index: 0, selector: ROOT_PRIMARY });
  });

  it('walks the fallback chain and returns the first visible hit', () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: null, [ROOT_FALLBACK]: makeNode() });
    expect(resolveBindingIndex(CODE, 'root', doc)).toEqual({ index: 1, selector: ROOT_FALLBACK });
  });

  it('returns null when every fallback misses', () => {
    expect(resolveBindingIndex(CODE, 'root', makeDoc({}))).toEqual({ index: null, selector: null });
  });

  it('returns null for unknown platform / semantic name / no doc', () => {
    expect(resolveBindingIndex('nope', 'root', makeDoc({}))).toEqual({ index: null, selector: null });
    expect(resolveBindingIndex(CODE, 'nope', makeDoc({}))).toEqual({ index: null, selector: null });
    expect(resolveBindingIndex(CODE, 'root', null)).toEqual({ index: null, selector: null });
  });

  it('skips selectors that throw (invalid syntax) and continues', () => {
    const throwing = { querySelector: () => { throw new Error('bad selector'); } };
    expect(resolveBindingIndex(CODE, 'root', throwing)).toEqual({ index: null, selector: null });
  });
});

// ---- probeSemanticTracks ----

describe('probeSemanticTracks', () => {
  it('projects binding info per requested name', () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: makeNode() });
    const out = probeSemanticTracks(CODE, ['root'], doc);
    expect(Object.keys(out)).toEqual(['root']);
    expect(out.root).toMatchObject({ bound: true, index: 0, track: 'primary', selector: ROOT_PRIMARY });
  });
});

// ---- decideBaselineTrack（双轨判定） ----

describe('decideBaselineTrack', () => {
  it("track=recapture when the baseline is missing", () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: makeNode() });
    const verdict = decideBaselineTrack({ snapshot: null, key: makeKey(), semanticNames: ['root'], doc });
    expect(verdict.track).toBe('recapture');
    expect(verdict.reason).toBe('missing-baseline');
  });

  it("track=recapture when lifecycle invalid (version bumped)", () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: makeNode() });
    const key = makeKey({ appVersion: '2.11.0' });
    const verdict = decideBaselineTrack({ snapshot: makeSnapshot(makeKey()), key, semanticNames: ['root'], doc });
    expect(verdict.track).toBe('recapture');
    expect(verdict.reason).toBe('invalid-baseline');
  });

  it("track=recapture when a required semantic node misses the whole chain", () => {
    const verdict = decideBaselineTrack({
      snapshot: makeSnapshot(makeKey()),
      key: makeKey(),
      semanticNames: ['root'],
      doc: makeDoc({}),
    });
    expect(verdict.track).toBe('recapture');
    expect(verdict.reason).toBe('semantic-miss');
    expect(verdict.misses).toContain('root');
  });

  it("track=reuse/rebound=false when all resolve on primary", () => {
    const verdict = decideBaselineTrack({
      snapshot: makeSnapshot(makeKey()),
      key: makeKey(),
      semanticNames: ['root'],
      doc: makeDoc({ [ROOT_PRIMARY]: makeNode() }),
      now: Date.now(),
    });
    expect(verdict.track).toBe('reuse');
    expect(verdict.rebound).toBe(false);
    expect(verdict.reason).toBe('primary');
  });

  it("track=reuse/rebound=true when a node binds via fallback (S5 rebind)", () => {
    // primary 失效、fallback 命中 → 复用并标记需重绑定
    const verdict = decideBaselineTrack({
      snapshot: makeSnapshot(makeKey()),
      key: makeKey(),
      semanticNames: ['root'],
      doc: makeDoc({ [ROOT_PRIMARY]: null, [ROOT_FALLBACK]: makeNode() }),
      now: Date.now(),
    });
    expect(verdict.track).toBe('reuse');
    expect(verdict.rebound).toBe(true);
    expect(verdict.reason).toBe('fallback-rebind');
  });
});

// ---- rebindSnapshot ----

describe('rebindSnapshot', () => {
  it('rebinds node selectors to the currently-resolving fallback', () => {
    // S5 场景：快照记录的是旧版本选择器（primary）；live 更新后 primary 失效、
    // fallback 命中 → 把节点重绑到 fallback 选择器
    const doc = makeDoc({ [ROOT_PRIMARY]: null, [ROOT_FALLBACK]: makeNode() });
    const snapshot = makeSnapshot(makeKey(), {
      nodes: [{ semantic: 'root', selector: ROOT_PRIMARY, tag: 'main', depth: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, styles: {}, customProperties: {} }],
    });
    const result = rebindSnapshot(snapshot, CODE, doc) as RebindResult;
    expect(result.rebound).toBe(1);
    expect(result.snapshot.nodes[0].selector).toBe(ROOT_FALLBACK);
    expect(result.stale).toEqual([]);
    expect(result.map.root).toBe(ROOT_FALLBACK);
  });

  it('does not mutate the original snapshot (copy-on-rebind)', () => {
    const doc = makeDoc({ [ROOT_PRIMARY]: makeNode() });
    const snapshot = makeSnapshot(makeKey());
    const before = snapshot.nodes[0].selector;
    rebindSnapshot(snapshot, CODE, doc);
    expect(snapshot.nodes[0].selector).toBe(before);
  });

  it('marks stale nodes that miss the whole chain and keeps their selector', () => {
    const result = rebindSnapshot(makeSnapshot(makeKey()), CODE, makeDoc({})) as RebindResult;
    expect(result.rebound).toBe(0);
    expect(result.stale).toContain('root');
    expect(result.snapshot.nodes[0].selector).toBe(ROOT_FALLBACK);
  });
});