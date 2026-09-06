// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { OverridesStore } from './overrides-store';

describe('OverridesStore — 白/黑名单（GOV-3）', () => {
  it('whitelists an element the classifier missed (漏报→补)', () => {
    const store = new OverridesStore('traework');
    const added = store.whitelist({ targetRef: 'chat-panel::div', treatment: 'frost' });
    expect(added).toBe(true);
    expect(store.overrideFor('chat-panel::div')?.kind).toBe('whitelist-add');
    // 同 ref 重复加白 → 去重
    expect(store.whitelist({ targetRef: 'chat-panel::div', treatment: 'frost' })).toBe(false);
  });

  it('blacklists a falsely-classified element (误报→剔)', () => {
    const store = new OverridesStore('traework');
    store.blacklist('shell::div', '误报：这是标题栏');
    const override = store.overrideFor('shell::div');
    expect(override?.kind).toBe('blacklist-remove');
    expect(override?.note).toContain('标题栏');
  });

  it('removes an override', () => {
    const store = new OverridesStore('traework');
    store.blacklist('a::div');
    expect(store.removeOverride('a::div')).toBe(true);
    expect(store.listElements()).toHaveLength(0);
    expect(store.removeOverride('a::div')).toBe(false);
  });

  it('persists through JSON round-trip (重启不丢)', () => {
    const store = new OverridesStore('traework');
    store.whitelist({ targetRef: 'composer::div', treatment: 'frost' });
    store.blacklist('banner::div');
    const restored = OverridesStore.fromJson(store.toJson(), 'traework')!;
    expect(restored.listElements()).toHaveLength(2);
    expect(restored.overrideFor('composer::div')?.treatment).toBe('frost');
    expect(restored.overrideFor('banner::div')?.kind).toBe('blacklist-remove');
  });

  it('returns null on corrupt JSON', () => {
    expect(OverridesStore.fromJson('{{{', 'traework')).toBeNull();
  });
});

describe('OverridesStore — 阈值覆盖', () => {
  it('sets and merges per-role thresholds', () => {
    const store = new OverridesStore('traework');
    store.setThreshold('chatlist', { areaRatio: 0.05 });
    store.setThreshold('chatlist', { frostOpacity: 0.8 });
    const t = store.getThreshold('chatlist');
    expect(t.areaRatio).toBe(0.05);
    expect(t.frostOpacity).toBe(0.8);
    expect(store.listThresholds()).toHaveLength(1); // 合并而非追加
  });
});

describe('OverridesStore — 精确率/召回率（阶段 4 指标）', () => {
  it('computes precision/recall from human confirmations', () => {
    const store = new OverridesStore('traework');
    // 真阳：预测 frost，确认 frost
    store.confirm('a::div', 'frost', 'frost');
    store.confirm('b::div', 'transparentize', 'transparentize');
    // 假阳：预测 frost，确认 keep
    store.confirm('c::div', 'frost', 'keep');
    // 假阴：预测 keep，确认 remove
    store.confirm('d::div', 'keep', 'remove');

    const m = store.metrics()!;
    expect(m.truePositive).toBe(2);
    expect(m.falsePositive).toBe(1);
    expect(m.falseNegative).toBe(1);
    expect(m.precision).toBeCloseTo(2 / 3, 5);
    expect(m.recall).toBeCloseTo(2 / 3, 5);
  });

  it('returns null when no confirmations exist', () => {
    expect(new OverridesStore('traework').metrics()).toBeNull();
  });

  it('keeps confirmation history across restarts', () => {
    const store = new OverridesStore('traework');
    store.confirm('a::div', 'frost', 'keep');
    const restored = OverridesStore.fromJson(store.toJson(), 'traework')!;
    expect(restored.listConfirmations()).toHaveLength(1);
    expect(restored.metrics()!.falsePositive).toBe(1);
  });
});
