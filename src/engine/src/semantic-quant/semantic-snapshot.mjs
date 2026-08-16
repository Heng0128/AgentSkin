// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-quant/semantic-snapshot.mjs — 语义快照构建与兼容性校验
 *
 * 定位：**实验性中间产物**——仅供 CLI 调试、诊断报告、编辑器预览。
 * 不保证向后兼容、禁止长期持久存储；按"一次性生成、随版本重跑"使用。
 * 永不进入注入 payload（不参与 L0-L4 注入执行）。
 *
 * 版本策略（双字段，语义严格分离）：
 *   - engineVersion            — 软件构建版本，仅备注，不用于解析判断；
 *   - taxonomySchemaVersion    — 数据结构版本，用于解析判断（与 engine 版本独立）。
 */

import { createRequire } from 'node:module';
import { SELECTOR_REGISTRIES } from '../runtime/selectivity-registry.mjs';
import {
  COMPONENT_INDEX,
  COMPONENT_ID_TO_SEMANTIC_NAME,
  TAXONOMY_SCHEMA_VERSION,
} from './taxonomy.mjs';

const require = createRequire(import.meta.url);

/**
 * 构建语义快照。
 *
 * @param {string} agentId - Agent 标识（如 "traework"）
 * @returns {object | null} 快照对象；agentId 未登记时返回 null
 */
export function buildSemanticSnapshot(agentId) {
  const registry = SELECTOR_REGISTRIES[agentId];
  if (!registry) return null;

  return {
    schemaVersion: 1,
    engineVersion: require('../../package.json').version,
    taxonomySchemaVersion: TAXONOMY_SCHEMA_VERSION,
    agentId,
    capturedAt: new Date().toISOString(),
    components: Object.entries(COMPONENT_INDEX).map(([componentId, meta]) => {
      const semanticName = COMPONENT_ID_TO_SEMANTIC_NAME[componentId];
      return {
        componentId,
        uiArea: meta.uiArea,
        componentKind: meta.componentKind,
        componentLayer: meta.componentLayer,
        riskLevel: meta.riskLevel,
        // derive-by-default 解析：componentId → 语义名 → registry 条目
        resolved: semanticName ? registry[semanticName] ?? null : null,
      };
    }),
  };
}

/**
 * 验证快照是否兼容当前 taxonomy（向前 + 向后双向判定）。
 *
 * 规则（对齐 Zustand/TanStack persist 迁移模式）：
 *   - snapshotVersion < current  → 旧快照，需迁移/重新生成；
 *   - snapshotVersion > current  → 新格式快照被旧引擎加载，旧代码不认识，直接拒绝；
 *   - 相等                         → 兼容。
 *
 * @param {object | null | undefined} snapshot - 待验证的快照
 * @returns {{ compatible: boolean; reason?: string }}
 */
export function validateSnapshotCompatibility(snapshot) {
  if (!snapshot) {
    return { compatible: false, reason: 'snapshot is null/undefined' };
  }

  const snapshotVersion = snapshot.taxonomySchemaVersion;
  if (typeof snapshotVersion !== 'number' || !Number.isInteger(snapshotVersion) || snapshotVersion < 1) {
    return { compatible: false, reason: `invalid taxonomySchemaVersion: ${snapshotVersion}` };
  }

  if (snapshotVersion < TAXONOMY_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `snapshot taxonomySchemaVersion (${snapshotVersion}) < current (${TAXONOMY_SCHEMA_VERSION})，需迁移/重新生成`,
    };
  }

  if (snapshotVersion > TAXONOMY_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `snapshot taxonomySchemaVersion (${snapshotVersion}) > current (${TAXONOMY_SCHEMA_VERSION})，旧引擎不支持向前兼容`,
    };
  }

  return { compatible: true };
}
