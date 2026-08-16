/**
 * verify-style — 样式值对比（RFC §2.7 序5 / CV-05 修复）
 *
 * `buildVerifyExpression` 原先只校验「选择器是否存在」（compatible/installed/
 * stylePresent/themeMatches），无法识别「选择器命中但主题样式未真生效」的语义漂移
 * （drift）。本模块提供纯函数的样式合规判定，并导出一段可内嵌进页面表达式执行的
 * 运行时代码源，配合 renderer-payload 的关键受控节点采样，产出 `styleSampling`
 * 判定并纳入 `result.pass`。
 *
 * 两个产物：
 *   1. 纯函数（Node 可直接单测，无 DOM 依赖）：
 *      `normalizeColor` / `colorDistance` / `assessStyleCompliance`
 *   2. `STYLE_RUNTIME_SOURCE`（浏览器端自包含 IIFE 片段）：与纯函数同逻辑，
 *      `.toString()` 内嵌到注入表达式，随页面执行，无外部依赖。
 *
 * 为避免两套逻辑漂移，纯函数以 `normalizeColor` / `colorDistance` 为单一实现源；
 * `STYLE_RUNTIME_SOURCE` 通过 `FN.toString()` 序列化同名函数嵌入，注释声明一致。
 */

import {
  COMPONENT_INDEX,
  RISK_LEVEL,
  SEMANTIC_NAME_TO_COMPONENT_ID,
} from "../semantic-quant/taxonomy.mjs";

/**
 * 解析 CSS 颜色字符串为 { r, g, b }（0-255）。支持 `rgb(...)` / `rgba(...)` /
 * `#rgb` / `#rrggbb`。无法解析（transparent/currentcolor/var()/none/空串等）返回 null。
 *
 * @param {string} input
 * @returns {{ r: number; g: number; b: number } | null}
 */
export function normalizeColor(input) {
	if (typeof input !== "string") return null;
	const s = input.trim().toLowerCase();
	if (!s) return null;
	if (
		s === "transparent" ||
		s === "currentcolor" ||
		s === "inherit" ||
		s === "initial" ||
		s === "none" ||
		s === "unset" ||
		s.startsWith("var(")
	) {
		return null;
	}
	const rgb = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
	if (rgb) {
		return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
	}
	if (s[0] === "#") {
		let h = s.slice(1);
		if (h.length === 3) {
			h = h
				.split("")
				.map((c) => `${c}${c}`)
				.join("");
		}
		if (/^[0-9a-f]{6}$/.test(h)) {
			return {
				r: parseInt(`${h[0]}${h[1]}`, 16),
				g: parseInt(`${h[2]}${h[3]}`, 16),
				b: parseInt(`${h[4]}${h[5]}`, 16),
			};
		}
	}
	return null;
}

/**
 * 归一化 RGB 距离（0..1，越接近 0 越相似）。无法解析返回 1（视为不可比/极端差）。
 *
 * @param {{ r: number; g: number; b: number } | null} a
 * @param {{ r: number; g: number; b: number } | null} b
 * @returns {number}
 */
export function colorDistance(a, b) {
	if (!a || !b) return 1;
	const dr = (a.r - b.r) / 255;
	const dg = (a.g - b.g) / 255;
	const db = (a.b - b.b) / 255;
	return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 单一属性近似比对。
 *   - expected 无法解析 → 返回 null（无从判定的该属性）
 *   - actual 无法解析（透明/继承/未命中） → 返回 false（视为未命中）
 *   - 否则返回 距离 ≤ tolerance 是否成立。
 *
 * @param {string | undefined} actual
 * @param {string | undefined} expected
 * @param {number} tolerance
 * @returns {boolean | null}
 */
export function matchesToken(actual, expected, tolerance) {
	const te = normalizeColor(expected);
	if (!te) return null;
	const na = normalizeColor(actual);
	if (!na) return false;
	return colorDistance(na, te) <= tolerance;
}

/**
 * 样式合规判定（纯函数，无 DOM）。输入一组已采样的节点样式与期望 token，
 * 输出是否放行 + 命中率 + 未命中明细。
 *
 * 判定规则（对齐 RFC Step6「轻探针校验（含样式值对比）」）：
 *   - 根节点 root：以文字色 vs tokens.text 判定（其背景天然透明，背景归艺术层，
 *     不参与背景比对，避免误伤）。
 *   - 普通受控语义节点：以 color vs tokens.text、背景 vs tokens.surface、
 *     border vs tokens.border 分别判定；任一属性近似命中即视为该节点受控通过。
 *   - 期望 token 缺失/无法解析的属性跳过（无从判定，不计入分子分母）。
 *   - 命中率 = 判定通过节点数 / 参与判定节点数；无参与判定节点时取 1（中性）。
 *
 * @param {{
 *   key: string;
 *   color?: string;
 *   bg?: string;
 *   border?: string;
 * }[]} samples 采样节点
 * @param {{ text?: string; surface?: string; border?: string }} tokens 期望 token（需可解析）
 * @param {{ tolerance?: number; minRatio?: number }} [opts]
 * @returns {{
 *   pass: boolean;
 *   matchRatio: number;
 *   judged: number;
 *   misses: { key: string; props: string[] }[];
 * }}
 */
export function assessStyleCompliance(samples, tokens = {}, opts = {}) {
	const tolerance = opts.tolerance ?? 0.08;
	const minRatio = opts.minRatio ?? 1;
	const misses = [];
	let judged = 0;
	let passing = 0;

	for (const sample of samples) {
		const judgedProps = [];
		if (tokens.text) judgedProps.push({ prop: "color", actual: sample.color, expected: tokens.text });
		if (tokens.surface && sample.key !== "root") {
			judgedProps.push({ prop: "bg", actual: sample.bg, expected: tokens.surface });
		}
		if (tokens.border) judgedProps.push({ prop: "border", actual: sample.border, expected: tokens.border });
		if (!judgedProps.length) continue;

		let usableProps = 0;
		let hit = false;
		const missProps = [];
		for (const p of judgedProps) {
			const r = matchesToken(p.actual, p.expected, tolerance);
			if (r === null) continue;
			usableProps += 1;
			if (r === true) hit = true;
			else missProps.push(p.prop);
		}
		if (usableProps === 0) continue;
		judged += 1;
		if (hit) passing += 1;
		else misses.push({ key: sample.key, props: missProps });
	}

	const matchRatio = judged > 0 ? passing / judged : 1;
	return { pass: matchRatio >= minRatio, matchRatio, judged, misses };
}

/**
 * 按区域（componentId）聚合样式采样结果，产出双通道报告（RFC §4.5）。
 *
 * 主进程侧纯函数——**不进入** `STYLE_RUNTIME_SOURCE`，页面内只执行
 * `assessStyleCompliance`（其 toString 序列化不受本函数影响）。
 *
 * 分级原则：
 *   - hardErrors：来自真实 DOM 采样（assessStyleCompliance）且组件 riskLevel=high
 *     → 阻断 CI；
 *   - semanticWarnings：riskLevel=medium/low，或 COMPONENT_INDEX 未登记组件
 *     （索引人工 curate，落后于 DOM 是预期内状态）→ 仅提示，永不阻断 CI。
 *
 * sample 的 componentId 解析：优先 `sample.componentId`；缺省时经
 * `SEMANTIC_NAME_TO_COMPONENT_ID` 由采样 key（语义名，如 "sidebar"）映射；
 * 均无法映射时回退 key 本身。
 *
 * @param {Array<{
 *   key?: string;
 *   componentId?: string;
 *   color?: string;
 *   bg?: string;
 *   border?: string;
 * }>} samples 采样节点（含语义 key 或 componentId）
 * @param {{ text?: string; surface?: string; border?: string }} tokens 期望 token
 * @param {{ tolerance?: number; minRatio?: number }} [opts]
 * @returns {{
 *   hardErrors: Array<{ componentId: string; riskLevel: string; pass: boolean; matchRatio: number; judged: number; misses: object[] }>;
 *   semanticWarnings: Array<{ componentId: string; riskLevel: string; pass: boolean; matchRatio: number; judged: number; misses: object[] }>;
 * }}
 */
export function aggregateByRegion(samples, tokens = {}, opts = {}) {
	const byComponent = new Map();

	for (const sample of samples) {
		const componentId = sample.componentId ?? SEMANTIC_NAME_TO_COMPONENT_ID[sample.key] ?? sample.key;
		if (componentId === undefined || componentId === null) continue;
		const list = byComponent.get(componentId) ?? [];
		list.push(sample);
		byComponent.set(componentId, list);
	}

	const hardErrors = [];
	const semanticWarnings = [];

	for (const [componentId, componentSamples] of byComponent) {
		const result = assessStyleCompliance(componentSamples, tokens, opts);
		if (result.pass) continue;
		const meta = COMPONENT_INDEX[componentId];
		const riskLevel = meta?.riskLevel ?? RISK_LEVEL.MEDIUM;
		const entry = { componentId, riskLevel, ...result };
		if (riskLevel === RISK_LEVEL.HIGH) {
			hardErrors.push(entry);
		} else {
			semanticWarnings.push(entry);
		}
	}

	return { hardErrors, semanticWarnings };
}

/**
 * 序列化纯函数，供浏览器端表达式内嵌（与 Node 侧逻辑同源，避免漂移）。
 */
const serializeFn = (fn) => fn.toString();

export const STYLE_RUNTIME_SOURCE = `
(() => {
  ${serializeFn(normalizeColor)};
  ${serializeFn(colorDistance)};
  ${serializeFn(matchesToken)};
  ${serializeFn(assessStyleCompliance)};
  return { normalizeColor, colorDistance, matchesToken, assessStyleCompliance };
})()
`;