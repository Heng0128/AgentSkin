// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-snapshot.mjs + taxonomy 不变量单测（RFC 附录 §E #5-#9）
 */

import { describe, expect, it } from 'vitest';
import {
  buildSemanticSnapshot,
  validateSnapshotCompatibility,
} from './semantic-snapshot.mjs';
import {
  COMPONENT_INDEX,
  COMPONENT_ID_TO_SEMANTIC_NAME,
  SEMANTIC_NAME_TO_COMPONENT_ID,
  TAXONOMY_SCHEMA_VERSION,
  UI_AREA,
  COMPONENT_KIND,
  COMPONENT_LAYER,
  RISK_LEVEL,
  FUTURE_RESERVED_UI_AREA,
  FUTURE_RESERVED_COMPONENT_KIND,
  FUTURE_RESERVED_COMPONENT_LAYER,
} from './taxonomy.mjs';

// ---------------------------------------------------------------------------
// taxonomy 结构不变量
// ---------------------------------------------------------------------------

describe('taxonomy 结构不变量', () => {
  it('COMPONENT_INDEX 恰为 6 个 Phase1 组件，bindings 全为空', () => {
    expect(Object.keys(COMPONENT_INDEX)).toEqual([
      'root',
      'sidebar',
      'workspace',
      'composer',
      'toolbar',
      'message-list',
    ]);
    for (const meta of Object.values(COMPONENT_INDEX)) {
      expect(meta.bindings).toEqual([]);
    }
  });

  it('componentId → 语义名 与反向映射互为逆映射', () => {
    for (const [componentId, semanticName] of Object.entries(COMPONENT_ID_TO_SEMANTIC_NAME)) {
      expect(SEMANTIC_NAME_TO_COMPONENT_ID[semanticName]).toBe(componentId);
    }
    expect(Object.keys(COMPONENT_ID_TO_SEMANTIC_NAME)).toHaveLength(6);
  });

  it('COMPONENT_INDEX 元数据全部落入枚举取值', () => {
    const areas = Object.values(UI_AREA);
    const kinds = Object.values(COMPONENT_KIND);
    const layers = Object.values(COMPONENT_LAYER);
    const risks = Object.values(RISK_LEVEL);
    for (const meta of Object.values(COMPONENT_INDEX)) {
      expect(areas).toContain(meta.uiArea);
      expect(kinds).toContain(meta.componentKind);
      expect(layers).toContain(meta.componentLayer);
      expect(risks).toContain(meta.riskLevel);
    }
  });

  it('预留枚举集合非空且值唯一', () => {
    const all = [...FUTURE_RESERVED_UI_AREA, ...FUTURE_RESERVED_COMPONENT_KIND, ...FUTURE_RESERVED_COMPONENT_LAYER];
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// buildSemanticSnapshot
// ---------------------------------------------------------------------------

type SnapshotShape = {
  schemaVersion: number;
  taxonomySchemaVersion: number;
  engineVersion: string;
  agentId: string;
  components: Array<{
    componentId: string;
    resolved: { selectors: string[] } | null;
  }>;
};

function asSnapshot(snapshot: object | null): SnapshotShape {
  expect(snapshot).not.toBeNull();
  return snapshot as unknown as SnapshotShape;
}

describe('buildSemanticSnapshot', () => {
  it('正常 agentId 输出双版本字段 + 6 组件；doubao 的 message-list 必须非空（A-5 回归）', () => {
    const snapshot = asSnapshot(buildSemanticSnapshot('doubao'));
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.taxonomySchemaVersion).toBe(TAXONOMY_SCHEMA_VERSION);
    expect(typeof snapshot.engineVersion).toBe('string');
    expect(snapshot.engineVersion.length).toBeGreaterThan(0);
    expect(snapshot.agentId).toBe('doubao');
    expect(snapshot.components).toHaveLength(6);

    const messageList = snapshot.components.find((c) => c.componentId === 'message-list')!;
    expect(messageList.resolved).not.toBeNull(); // registry.doubao.messageList 存在
    expect(messageList.resolved?.selectors.length ?? 0).toBeGreaterThan(0);
  });

  it('未登记 agentId 返回 null', () => {
    expect(buildSemanticSnapshot('not-an-agent')).toBeNull();
  });

  it('traework 无 messageList 语义名 → 该组件 resolved 为 null（预期，非 bug）', () => {
    const snapshot = asSnapshot(buildSemanticSnapshot('traework'));
    const messageList = snapshot.components.find((c) => c.componentId === 'message-list')!;
    expect(messageList.resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateSnapshotCompatibility（双向判定）
// ---------------------------------------------------------------------------

describe('validateSnapshotCompatibility', () => {
  it('null / undefined → incompatible', () => {
    expect(validateSnapshotCompatibility(null).compatible).toBe(false);
    expect(validateSnapshotCompatibility(undefined).compatible).toBe(false);
  });

  it('非法 schema 版本（非正整数）→ incompatible', () => {
    expect(validateSnapshotCompatibility({ taxonomySchemaVersion: 0 }).compatible).toBe(false);
    expect(validateSnapshotCompatibility({ taxonomySchemaVersion: '1' }).compatible).toBe(false);
    expect(validateSnapshotCompatibility({}).compatible).toBe(false);
  });

  it('版本相等 → compatible', () => {
    expect(
      validateSnapshotCompatibility({ taxonomySchemaVersion: TAXONOMY_SCHEMA_VERSION }).compatible,
    ).toBe(true);
  });

  it('版本高于当前（旧引擎读新快照）→ incompatible，理由含"向前兼容"（P1-2 回归）', () => {
    const result = validateSnapshotCompatibility({ taxonomySchemaVersion: TAXONOMY_SCHEMA_VERSION + 1 });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('向前兼容');
  });

  it('低于当前分支为防御性代码：schema v1 下无可达正整数值（v2 起生效），此处仅验证不误报', () => {
    // current=1 时，快照版本 <1 且 ≥1 的正整数不存在——该分支待 v2 升级后生效
    expect(TAXONOMY_SCHEMA_VERSION).toBe(1);
  });
});
