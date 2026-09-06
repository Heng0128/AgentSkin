/**
 * preflight — 双轨 preflight + fallback 重绑定（RFC §5 S5 / 批 F）
 *
 * 场景：第三方 Agent 更新导致 hash 类名（如 `_container_a1b2c3d4_5`）变化，
 * 使缓存的基准快照语义选择器失效。§3.1 的 registry 已为每个语义名维护 fallback
 * 链（`getSelectors`），但缺乏「如何应对版本更新」的判定 —— 现状要么全未命中
 * 直接重采（贵），要么直接复用（可能漂移）。本模块补上双轨判定：
 *
 *   轨 A（reuse，可含 rebind）：preflight 探测 live DOM 的 fallback 链。
 *       - 全部 required 语义节点仍在首位（primary）命中 → 快照直用，零成本。
 *       - 全部命中但落在 fallback（index>0）→ 快照可复用，但需把语义节点的
 *         selector **重绑定**到当前命中项（避免用失效的旧选择器再注入）。
 *   轨 B（recapture）：任一 required 语义节点整条 fallback 链全未命中，或
 *       基础生命周期（版本/themeMode/schema/expired）失效 → 快照不可用，必须重采。
 *
 * 本模块仅处理**状态与判定**（纯逻辑，不触达 CDP），DOM 通过参数注入以便单测。
 * 上层（编排层/真值缓存消费方）据返回值决定走轨 A 复用还是轨 B 重采。
 */

import { getSelectors, isVisible } from './selectivity-registry.mjs';
import { isBaselineValid } from './baseline-snapshot.mjs';

/**
 * 取得目标文档；未显式传入时回退到全局 document（Node/测试环境中可能不存在）。
 * @param {object | null | undefined} doc
 * @returns {object | null} 可用的文档对象，否则 null
 */
function resolveDoc(doc = null) {
	if (doc) return doc;
	// 仅在浏览器环境可用；Node 单测下无 document → 返回 null（命中为空）。
	return typeof globalThis.document !== 'undefined' ? globalThis.document : null;
}

/**
 * 返回语义名在 fallback 链中的「首个可见命中」索引。
 *
 * 与 `resolveSelector` 等价，但额外暴露命中的**索引**与**选择器原文**，供双轨
 * 判定（primary/fallback/miss）与重绑定使用。
 *
 * @param {string} agentId - 平台 ID
 * @param {string} semanticName - 语义别名
 * @param {object | null} [doc] - 目标文档；缺省取全局 document
 * @returns {{ index: number | null; selector: string | null }}
 *   index：首个可见命中的 fallback 下标；全未命中为 null。
 *   selector：命中项的选择器原文；未命中为 null。
 */
export function resolveBindingIndex(agentId, semanticName, doc = null) {
	const selectors = getSelectors(agentId, semanticName);
	const target = resolveDoc(doc);
	if (!selectors || !target) return { index: null, selector: null };
	for (let i = 0; i < selectors.length; i += 1) {
		try {
			// 非法选择器（目标引擎不支持的语法）在 querySelector 抛错时跳过
			const element = target.querySelector(selectors[i]);
			if (element && isVisible(element)) {
				return { index: i, selector: selectors[i] };
			}
		} catch {
			// 跳过，继续下一个 fallback
		}
	}
	return { index: null, selector: null };
}

/**
 * 将命中索引归一为三态轨道标签。
 * @param {number | null} index
 * @returns {'primary' | 'fallback' | 'miss'}
 */
export function classifyTrack(index) {
	if (index === null) return 'miss';
	return index === 0 ? 'primary' : 'fallback';
}

/**
 * 探测一组语义名的 fallback 绑定。
 *
 * @param {string} agentId
 * @param {string[]} semanticNames
 * @param {object | null} [doc]
 * @returns {Record<string, {
 *   bound: boolean; index: number | null; track: 'primary' | 'fallback' | 'miss'; selector: string | null;
 * }>}
 */
export function probeSemanticTracks(agentId, semanticNames, doc = null) {
	/** @type {Record<string, any>} */
	const result = {};
	for (const name of semanticNames) {
		const { index, selector } = resolveBindingIndex(agentId, name, doc);
		result[name] = {
			bound: index !== null,
			index,
			track: classifyTrack(index),
			selector,
		};
	}
	return result;
}

/**
 * 双轨 preflight 判定（RFC §5 S5 版本更新应对）。
 *
 * 结合生命周期（版本/themeMode/schema/时间）与 live DOM 探测，输出轨道决策：
 *   - track='reuse'   → 走轨 A，可复用缓存快照；`rebound` 指示是否需重绑定。
 *   - track='recapture' → 走轨 B，快照不可用，必须重采。
 *
 * @param {{
 *   snapshot: object | null | undefined;
 *   key: { appId: string; appVersion: string; themeMode: string; schema?: string };
 *   semanticNames: string[];
 *   doc?: object | null;
 *   now?: number;
 * }} ctx
 * @returns {{
 *   track: 'reuse' | 'recapture';
 *   rebound: boolean;
 *   reason: 'invalid-baseline' | 'semantic-miss' | 'fallback-rebind' | 'primary' | 'missing-baseline';
 *   misses: string[];
 *   probe: Record<string, any>;
 * }}
 */
export function decideBaselineTrack({ snapshot, key, semanticNames, doc = null, now }) {
	const timestamp = now ?? Date.now();
	const lifecycleValid = isBaselineValid(snapshot, key, timestamp);
	const probe = probeSemanticTracks(key.appId, semanticNames, doc);
	const misses = semanticNames.filter((name) => probe[name]?.bound === false);
	const anyFallback = semanticNames.some((name) => probe[name]?.track === 'fallback');

	if (!snapshot) {
		return { track: 'recapture', rebound: false, reason: 'missing-baseline', misses, probe };
	}
	if (!lifecycleValid) {
		return { track: 'recapture', rebound: false, reason: 'invalid-baseline', misses, probe };
	}
	if (misses.length > 0) {
		return { track: 'recapture', rebound: false, reason: 'semantic-miss', misses, probe };
	}
	if (anyFallback) {
		return { track: 'reuse', rebound: true, reason: 'fallback-rebind', misses, probe };
	}
	return { track: 'reuse', rebound: false, reason: 'primary', misses, probe };
}

/**
 * 按当前 fallback 解析把快照节点的 selector 重绑定到 live DOM。
 *
 * 节点通过 `node.semantic`（语义名）定位 fallback 链；对能命中的节点更新
 * selector 为当前命中项。全未命中的 required 语义节点保持原样，并在返回值中
 * 标记 `stale`（调用方应据 `decideBaselineTrack` 判定是否整体重采）。
 *
 * @param {object} snapshot
 * @param {string} agentId
 * @param {object | null} [doc]
 * @returns {{ snapshot: object; rebound: number; stale: string[]; map: Record<string, string> }}
 *   snapshot：打置于副本上；仅重绑可命中的节点。
 *   rebound：成功重绑的节点数。
 *   stale：未能命中、保持原选择器的语义名列表。
 *   map：语义名 → 当前命中选择器。
 */
export function rebindSnapshot(snapshot, agentId, doc = null) {
	// 收集节点携带的语义名（去重、保序）
	/** @type {string[]} */
	const names = [];
	for (const node of snapshot.nodes ?? []) {
		if (node.semantic && !names.includes(node.semantic)) names.push(node.semantic);
	}
	const probe = probeSemanticTracks(agentId, names, doc);
	/** @type {Record<string, string>} */
	const map = {};
	const stale = [];
	let rebound = 0;

	const reboundNodes = (snapshot.nodes ?? []).map((node) => {
		if (!node.semantic) return node;
		const binding = probe[node.semantic];
		if (!binding?.bound) {
			stale.push(node.semantic);
			return node;
		}
		map[node.semantic] = binding.selector;
		if (node.selector !== binding.selector) rebound += 1;
		return { ...node, selector: binding.selector };
	});

	return { snapshot: { ...snapshot, nodes: reboundNodes }, rebound, stale, map };
}