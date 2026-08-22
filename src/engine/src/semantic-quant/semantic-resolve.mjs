// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-quant/semantic-resolve.mjs — componentId 解析与弃用别名消费
 *
 * 与 DEPRECATED_ALIASES 成对的最小消费代码：未来 componentId 改名时，
 * 在 taxonomy.mjs 填弃用表即可，消费方逻辑无需再改。
 */

import { DEPRECATED_ALIASES } from './taxonomy.mjs';

/**
 * 解析 componentId，处理弃用别名。
 *
 * @param {string} componentId - 待解析的 componentId
 * @returns {{ id: string; deprecated: boolean; replacedBy?: string }}
 */
export function resolveComponentId(componentId) {
  const alias = DEPRECATED_ALIASES[componentId];

  if (alias) {
    console.warn(
      `[semantic-quant] componentId "${componentId}" is deprecated, use "${alias.replacedBy}" instead`,
    );
    return {
      id: alias.replacedBy,
      deprecated: true,
      replacedBy: alias.replacedBy,
    };
  }

  return { id: componentId, deprecated: false };
}

/**
 * 检查 componentId 是否已弃用。
 *
 * @param {string} componentId
 * @returns {boolean}
 */
export function isDeprecated(componentId) {
  return componentId in DEPRECATED_ALIASES;
}

/**
 * 获取所有已弃用的 componentId 列表。
 *
 * @returns {string[]}
 */
export function listDeprecatedIds() {
  return Object.keys(DEPRECATED_ALIASES);
}
