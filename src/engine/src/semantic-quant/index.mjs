// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-quant/index.mjs — 语义量化层统一导出
 *
 * 消费方（白名单）：
 *   - runtime/verify-style.mjs（区域聚合报告）
 *   - scripts/check-semantic-contract.mjs（CI 校验）
 *   - 未来 Studio 消费层 / 本地诊断工具
 *
 * 注入执行层（runtime/ 其余模块、adapters/、cdp/）禁止 import。
 */

export {
  TAXONOMY_SCHEMA_VERSION,
  UI_AREA,
  COMPONENT_KIND,
  COMPONENT_LAYER,
  RISK_LEVEL,
  COMPONENT_INDEX,
  COMPONENT_ID_TO_SEMANTIC_NAME,
  SEMANTIC_NAME_TO_COMPONENT_ID,
  DEPRECATED_ALIASES,
  FUTURE_RESERVED_UI_AREA,
  FUTURE_RESERVED_COMPONENT_KIND,
  FUTURE_RESERVED_COMPONENT_LAYER,
  FUTURE_RESERVED_VALUES,
} from './taxonomy.mjs';

export { resolveComponentId, isDeprecated, listDeprecatedIds } from './semantic-resolve.mjs';

export { buildSemanticSnapshot, validateSnapshotCompatibility } from './semantic-snapshot.mjs';
