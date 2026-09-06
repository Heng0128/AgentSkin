/**
 * 语义过滤层（RFC §2.4 / CV-04 修复）
 *
 * 为 `isNativeThemeControlled = false` 的节点标记 `agentskin-non-controlled`，
 * 并导出排除选择器骨架，使主题生成层可在受控组件选择器上追加
 * `:not(.agentskin-non-controlled)`，令主题色值不再覆盖非受控子节点
 * （如内部 input / button / divider）。
 *
 * 数据来源：`selectivity-registry.mjs` 的 `semantic.nonControlled` 配置。
 *
 * 两个产物：
 *   1. `buildSemanticMarkExpression` — 浏览器端 JS 表达式：扫描所有受控组件，
 *      为其 nonControlled 子选择器命中的元素追加标记 class。
 *   2. `buildExclusionSelectors` — 以 `:not(.agentskin-non-controlled)` 收尾的
 *      排除选择器串，供主题 CSS 生成层直接内嵌，与标记协同实现过滤。
 *
 * 两者都是**纯 builder**（不触达真实 DOM / CDP），可独立单测。
 */

import { collectNonControlledTopology } from "./selectivity-registry.mjs";

/**
 * 默认标记 class 名。主题 CSS 与注入管道以此为过滤器锚点。
 */
export const NON_CONTROLLED_CLASS = "agentskin-non-controlled";

function escapeClass(className) {
	return String(className).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeJsString(value) {
	return JSON.stringify(String(value));
}

/**
 * 收集某平台所有受控组件内部的 nonControlled 选择器（去重、保序）。
 *
 * @param {string} agentId
 * @returns {string[]} 去重后的 nonControlled 选择器列表
 */
export function collectNonControlledSelectors(agentId) {
	const seen = new Set();
	const result = [];
	for (const top of collectNonControlledTopology(agentId)) {
		for (const selector of top.semantic.nonControlled) {
			if (typeof selector !== "string" || !selector.trim()) continue;
			if (!seen.has(selector)) {
				seen.add(selector);
				result.push(selector);
			}
		}
	}
	return result;
}

/**
 * 生成排除选择器骨架：每个 nonControlled 选择器追加 `:not(.agentskin-non-controlled)`。
 *
 * 这是「`:not()` 排除」的真正的生成层契约——主题 CSS 作者/生成器把返回串
 * 作为规则选择器或追加到受控组件选择器后，配合运行时标记（markNonControlled）
 * 使命中标记 class 的节点退出主题渲染。
 *
 * @param {string} agentId
 * @param {{ className?: string }} [opts]
 * @returns {string[]} 排除选择器列表；无可过滤拓扑时返回 []
 */
export function buildExclusionSelectors(agentId, opts = {}) {
	const className = opts.className ?? NON_CONTROLLED_CLASS;
	const classSelector = "." + escapeClass(className);
	return collectNonControlledSelectors(agentId).map((selector) => `${selector}:not(${classSelector})`);
}

/**
 * 构建浏览器端 JS 表达式：为所有 nonControlled 节点追加标记 class。
 *
 * 产物是一个返回标记数量的 IIFE 字符串，可经 `session.evaluate` 执行。
 * 幂等——反复执行不会重复计数、也不会破坏用户 DOM（仅 classList.add）。
 *
 * @param {string} agentId
 * @param {{ className?: string }} [opts]
 * @returns {string} 可直接 evaluate 的 JS 表达式
 */
export function buildSemanticMarkExpression(agentId, opts = {}) {
	const className = opts.className ?? NON_CONTROLLED_CLASS;
	const selectors = collectNonControlledSelectors(agentId);
	if (!selectors.length) {
		return `(() => { return 0; })()`;
	}
	const selectorJson = JSON.stringify(selectors);
	return `(() => {
    const selectors = ${selectorJson};
    const className = ${escapeJsString(className)};
    let marked = 0;
    for (const selector of selectors) {
      let nodes;
      try { nodes = document.querySelectorAll(selector); } catch { nodes = []; }
      for (const node of nodes) {
        const el = node instanceof Element ? node : node;
        if (!el.classList) continue;
        if (!el.classList.contains(className)) { el.classList.add(className); marked += 1; }
      }
    }
    return marked;
  })()`;
}