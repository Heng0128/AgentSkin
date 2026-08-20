// SPDX-License-Identifier: MPL-2.0

import { nativeDefectFixCss } from '../../../../scripts/native-defect-fixes.mjs';

/**
 * 调用注入引擎的 nativeDefectFixCss()，为指定 agent 生成缺陷修正 CSS。
 * @param agentId agent 标识（如 'traework'）
 * @param hostScope CSS 作用域选择器
 */
export function buildNativeDefectCss(agentId: string, hostScope: string): string {
  return nativeDefectFixCss(agentId as never, hostScope);
}
