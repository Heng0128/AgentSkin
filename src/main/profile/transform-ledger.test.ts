// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { TransformLedger } from './transform-ledger';

function frostEntry(
  over: { targetRef: string; opacity?: number; blurPx?: number } = { targetRef: 'chat-panel::div' },
) {
  return {
    targetRef: over.targetRef,
    action: 'frost' as const,
    params: { opacity: over.opacity ?? 0.65, blurPx: over.blurPx ?? 20 },
    source: 'auto' as const,
    baseline: { background: 'rgb(13, 13, 20)' },
  };
}

describe('TransformLedger', () => {
  it('upserts new entries and dedupes by targetRef+action', () => {
    const ledger = new TransformLedger();
    const first = ledger.upsert(frostEntry({ targetRef: 'a::div' }));
    const second = ledger.upsert(frostEntry({ targetRef: 'a::div', opacity: 0.8 }));
    expect(second.id).toBe(first.id); // 同 ref+action → 更新不新建
    expect(second.params?.opacity).toBe(0.8);
    expect(ledger.all()).toHaveLength(1);
  });

  it('keeps separate entries for different refs', () => {
    const ledger = new TransformLedger();
    ledger.upsert(frostEntry({ targetRef: 'a::div' }));
    ledger.upsert(frostEntry({ targetRef: 'b::div' }));
    expect(ledger.all()).toHaveLength(2);
  });

  it('toggles a single entry off and back on (验收标准 3)', () => {
    const ledger = new TransformLedger();
    const entry = ledger.upsert(frostEntry());
    expect(entry.enabled).toBe(true);
    ledger.toggle(entry.id);
    expect(ledger.get(entry.id)!.enabled).toBe(false);
    ledger.toggle(entry.id, true);
    expect(ledger.get(entry.id)!.enabled).toBe(true);
  });

  it('toggles an entire action class (master switch)', () => {
    const ledger = new TransformLedger();
    ledger.upsert(frostEntry({ targetRef: 'a::div' }));
    ledger.upsert(frostEntry({ targetRef: 'b::div' }));
    ledger.upsert({
      targetRef: 'shell::div',
      action: 'transparentize',
      source: 'auto',
      baseline: {},
    });
    expect(ledger.setActionEnabled('frost', false)).toBe(2);
    expect(ledger.all().filter((e) => e.enabled)).toHaveLength(1); // 只剩 transparentize
  });

  it('toCss emits only enabled entries with escaped refs', () => {
    const ledger = new TransformLedger();
    const on = ledger.upsert(frostEntry({ targetRef: 'chat[0]/panel::div', opacity: 0.7 }));
    ledger.upsert({
      targetRef: 'shell::div',
      action: 'transparentize',
      source: 'auto',
      baseline: {},
    });
    ledger.toggle(on.id, false);
    const css = ledger.toCss();
    // disabled frost 条目不产出；enabled transparentize 保留，ref 转义
    expect(css).not.toContain('chat');
    expect(css).toContain('background: transparent');
    expect(css).toContain('shell\\:\\:div');
  });

  it('round-trips through JSON (持久化)', () => {
    const ledger = new TransformLedger();
    ledger.upsert(frostEntry({ targetRef: 'a::div', opacity: 0.7 }));
    const off = ledger.upsert(frostEntry({ targetRef: 'b::div' }));
    ledger.toggle(off.id, false);
    const restored = TransformLedger.fromJson(ledger.toJson());
    expect(restored.all()).toHaveLength(2);
    const a = restored.findByRef('a::div', 'frost');
    expect(a?.params?.opacity).toBe(0.7);
    const b = restored.findByRef('b::div', 'frost');
    expect(b?.enabled).toBe(false); // 开关状态持久化
  });

  it('survives corrupt JSON with an empty ledger', () => {
    const ledger = TransformLedger.fromJson('{{{not json');
    expect(ledger.all()).toEqual([]);
    expect(TransformLedger.fromJson('{"entries": [{"targetRef": 42}]}').all()).toEqual([]);
  });

  it('keeps existing entries when fromJson is fed corrupt data', () => {
    const ledger = new TransformLedger();
    ledger.upsert(frostEntry());
    TransformLedger.fromJson('garbage', ledger);
    expect(ledger.all()).toHaveLength(1);
  });

  it('summarizes counts by action', () => {
    const ledger = new TransformLedger();
    ledger.upsert(frostEntry());
    ledger.upsert(frostEntry({ targetRef: 'x::div' }));
    ledger.upsert({
      targetRef: 'shell::div',
      action: 'transparentize',
      source: 'auto',
      baseline: {},
    });
    const s = ledger.summary();
    expect(s.total).toBe(3);
    expect(s.enabled).toBe(3);
    expect(s.byAction.frost).toBe(2);
    expect(s.byAction.transparentize).toBe(1);
  });

  it('removes an entry by id', () => {
    const ledger = new TransformLedger();
    const e = ledger.upsert(frostEntry());
    expect(ledger.remove(e.id)).toBe(true);
    expect(ledger.all()).toHaveLength(0);
    expect(ledger.remove('nope')).toBe(false);
  });
});
