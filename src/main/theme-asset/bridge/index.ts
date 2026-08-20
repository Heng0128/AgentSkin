// SPDX-License-Identifier: MPL-2.0

/**
 * # bridge/index.ts — 桥接层统一 re-export
 *
 * 封装所有注入引擎调用。职责划分：
 * - verify/ = "它好不好"（校验 + 报告产出；主要只读）
 * - bridge/ = "把它弄好"（副作用操作：CSS 拼接 + 模板提取）
 */

export { buildNativeDefectCss } from './native-defect';
export { extractStructuralTemplate, hasStructuralTemplate } from './structural-template';
